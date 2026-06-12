import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { mkdtempSync, existsSync, mkdirSync, readdirSync, statSync, lstatSync, renameSync, copyFileSync, rmSync, accessSync, symlinkSync, readlinkSync, constants as fsConstants } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { db, schema } from '../db/connection.js';
import { enqueueTask, taskEvents, cancelTask } from '../queue/task-queue.js';
import { buildRestoreCommand } from '../restic/commands.js';
import type { RestoreJobInput, ConflictStrategy, ServerMessage } from '@restful-backup/shared';

export async function startRestore(
  repoId: string,
  userId: string,
  input: RestoreJobInput,
): Promise<{ jobId: string; taskId: string }> {
  const repo = db.select().from(schema.repos).where(eq(schema.repos.id, repoId)).get();
  if (!repo) throw new Error('Repository not found');

  // --- Pre-restore verification ---
  // Check target path is writable
  const targetDir = input.targetPath;
  try {
    if (existsSync(targetDir)) {
      accessSync(targetDir, fsConstants.W_OK);
    } else {
      // Check parent is writable
      const parent = dirname(targetDir);
      if (!existsSync(parent)) {
        throw new Error(`Parent directory does not exist: ${parent}`);
      }
      accessSync(parent, fsConstants.W_OK);
    }
  } catch (err: any) {
    throw new Error(`Target path not writable: ${err.message}`);
  }

  // Check available disk space at target
  const diskError = checkDiskSpace(targetDir);
  if (diskError) {
    throw new Error(diskError);
  }

  const jobId = nanoid();
  const taskId = nanoid();
  const context = JSON.stringify({ restoreJobId: jobId });

  // For rename/skip strategies, restore to temp dir first
  const needsTempDir = input.conflictStrategy !== 'overwrite';
  const tempDir = needsTempDir ? mkdtempSync(join(tmpdir(), 'restic-restore-')) : null;
  const effectiveTarget = tempDir || targetDir;

  db.insert(schema.restoreJobs).values({
    id: jobId,
    repoId,
    userId,
    taskId,
    snapshotId: input.snapshotId,
    sourcePaths: JSON.stringify(input.sourcePaths),
    targetPath: input.targetPath,
    conflictStrategy: input.conflictStrategy,
    includePatterns: input.includePatterns ? JSON.stringify(input.includePatterns) : null,
    excludePatterns: input.excludePatterns ? JSON.stringify(input.excludePatterns) : null,
    verifyAfter: input.verifyAfter ?? true,
    status: 'pending',
    createdAt: new Date(),
  }).run();

  db.insert(schema.tasks).values({
    id: taskId,
    repoId,
    userId,
    operation: 'restore',
    status: 'queued',
    context,
    createdAt: new Date(),
  }).run();

  const command = buildRestoreCommand({
    snapshotId: input.snapshotId,
    targetPath: effectiveTarget,
    includePaths: input.sourcePaths.length > 0 ? input.sourcePaths : undefined,
    excludePaths: input.excludePatterns,
  });

  taskEvents.emit('message', {
    type: 'restore:started',
    jobId,
    taskId,
  } satisfies ServerMessage);

  db.update(schema.restoreJobs)
    .set({ status: 'running', startedAt: new Date() })
    .where(eq(schema.restoreJobs.id, jobId))
    .run();

  const completionHandler = (msg: ServerMessage) => {
    if (!('taskId' in msg) || msg.taskId !== taskId) return;

    if (msg.type === 'task:completed') {
      taskEvents.removeListener('message', completionHandler);
      handleRestoreCompleted(jobId, taskId, input.conflictStrategy, tempDir, targetDir, input.verifyAfter ?? true);
    } else if (msg.type === 'task:failed') {
      taskEvents.removeListener('message', completionHandler);
      handleRestoreFailed(jobId, msg.error, msg.durationMs, tempDir);
    } else if (msg.type === 'task:cancelled') {
      taskEvents.removeListener('message', completionHandler);
      db.update(schema.restoreJobs)
        .set({ status: 'cancelled', completedAt: new Date() })
        .where(eq(schema.restoreJobs.id, jobId))
        .run();
      cleanupTempDir(tempDir);
    }
  };
  taskEvents.on('message', completionHandler);

  await enqueueTask(taskId, repoId, userId, 'restore', command, context);

  return { jobId, taskId };
}

function handleRestoreCompleted(
  jobId: string,
  taskId: string,
  conflictStrategy: ConflictStrategy,
  tempDir: string | null,
  finalTarget: string,
  verifyAfter: boolean,
): void {
  const task = db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
  let filesRestored = 0;
  let bytesRestored = 0;

  if (task?.log) {
    const filesMatch = task.log.match(/restoring.*?(\d+)\s+files/i);
    if (filesMatch) filesRestored = parseInt(filesMatch[1], 10);
    const bytesMatch = task.log.match(/(\d+)\s+bytes/i);
    if (bytesMatch) bytesRestored = parseInt(bytesMatch[1], 10);
  }

  // Apply conflict strategy if we used a temp dir
  if (tempDir) {
    try {
      const result = applyConflictStrategy(tempDir, finalTarget, conflictStrategy);
      filesRestored = result.copiedFiles;
      bytesRestored = result.copiedBytes;
    } catch (err: any) {
      // Rollback: clean temp dir and mark failed
      cleanupTempDir(tempDir);
      db.update(schema.restoreJobs)
        .set({
          status: 'failed',
          errorMessage: `Conflict resolution failed: ${err.message}. Rolled back.`,
          durationMs: task?.durationMs ?? null,
          completedAt: new Date(),
        })
        .where(eq(schema.restoreJobs.id, jobId))
        .run();
      taskEvents.emit('message', { type: 'restore:failed', jobId, error: `Conflict resolution failed: ${err.message}` } satisfies ServerMessage);
      return;
    }
    cleanupTempDir(tempDir);
  }

  // Post-restore verification: check file counts match
  if (verifyAfter && filesRestored > 0) {
    const verifyError = verifyRestoredFiles(finalTarget, filesRestored);
    if (verifyError) {
      db.update(schema.restoreJobs)
        .set({
          status: 'completed',
          filesRestored,
          bytesRestored,
          durationMs: task?.durationMs ?? null,
          errorMessage: `Verification warning: ${verifyError}`,
          completedAt: new Date(),
        })
        .where(eq(schema.restoreJobs.id, jobId))
        .run();
      taskEvents.emit('message', {
        type: 'restore:completed',
        jobId,
        filesRestored,
        bytesRestored,
        durationMs: task?.durationMs ?? 0,
      } satisfies ServerMessage);
      return;
    }
  }

  db.update(schema.restoreJobs)
    .set({
      status: 'completed',
      filesRestored,
      bytesRestored,
      durationMs: task?.durationMs ?? null,
      completedAt: new Date(),
    })
    .where(eq(schema.restoreJobs.id, jobId))
    .run();

  taskEvents.emit('message', {
    type: 'restore:completed',
    jobId,
    filesRestored,
    bytesRestored,
    durationMs: task?.durationMs ?? 0,
  } satisfies ServerMessage);
}

function handleRestoreFailed(jobId: string, error: string, durationMs: number, tempDir: string | null): void {
  // Rollback: clean temp dir on failure
  cleanupTempDir(tempDir);

  db.update(schema.restoreJobs)
    .set({
      status: 'failed',
      errorMessage: error,
      durationMs,
      completedAt: new Date(),
    })
    .where(eq(schema.restoreJobs.id, jobId))
    .run();

  taskEvents.emit('message', {
    type: 'restore:failed',
    jobId,
    error,
  } satisfies ServerMessage);
}

// --- Conflict strategy implementation ---

interface ConflictResult {
  copiedFiles: number;
  copiedBytes: number;
  skippedFiles: number;
  renamedFiles: number;
}

function applyConflictStrategy(sourceDir: string, targetDir: string, strategy: ConflictStrategy): ConflictResult {
  const result: ConflictResult = { copiedFiles: 0, copiedBytes: 0, skippedFiles: 0, renamedFiles: 0 };

  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  walkAndCopy(sourceDir, sourceDir, targetDir, strategy, result);
  return result;
}

function walkAndCopy(
  baseDir: string,
  currentDir: string,
  targetBase: string,
  strategy: ConflictStrategy,
  result: ConflictResult,
): void {
  let entries;
  try {
    entries = readdirSync(currentDir, { withFileTypes: true });
  } catch (err: any) {
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      return; // skip inaccessible directories
    }
    throw err;
  }

  for (const entry of entries) {
    const sourcePath = join(currentDir, entry.name);
    const relPath = relative(baseDir, sourcePath);
    const targetPath = join(targetBase, relPath);

    if (entry.isDirectory()) {
      if (!existsSync(targetPath)) {
        mkdirSync(targetPath, { recursive: true });
      }
      walkAndCopy(baseDir, sourcePath, targetBase, strategy, result);
    } else if (entry.isSymbolicLink()) {
      // Preserve symlinks: read the link target and recreate it
      try {
        const linkTarget = readlinkSync(sourcePath);

        if (existsSync(targetPath) || lstatSync(targetPath).isSymbolicLink()) {
          if (strategy === 'skip') {
            result.skippedFiles++;
            continue;
          } else if (strategy === 'rename') {
            const bakPath = targetPath + '.bak';
            let bakTarget = bakPath;
            let counter = 1;
            while (existsSync(bakTarget)) {
              bakTarget = `${targetPath}.bak.${counter}`;
              counter++;
            }
            renameSync(targetPath, bakTarget);
            result.renamedFiles++;
          } else {
            // overwrite: remove existing before creating symlink
            rmSync(targetPath, { force: true });
          }
        }

        const parentDir = dirname(targetPath);
        if (!existsSync(parentDir)) {
          mkdirSync(parentDir, { recursive: true });
        }

        symlinkSync(linkTarget, targetPath);
        result.copiedFiles++;
      } catch (err: any) {
        if (err.code === 'ENOENT') {
          // lstatSync throws ENOENT if target doesn't exist — safe to create symlink
          const linkTarget = readlinkSync(sourcePath);
          const parentDir = dirname(targetPath);
          if (!existsSync(parentDir)) {
            mkdirSync(parentDir, { recursive: true });
          }
          symlinkSync(linkTarget, targetPath);
          result.copiedFiles++;
        }
        // Skip other symlink errors (e.g., permission denied)
      }
    } else if (entry.isFile()) {
      if (existsSync(targetPath)) {
        if (strategy === 'skip') {
          result.skippedFiles++;
          continue;
        } else if (strategy === 'rename') {
          const bakPath = targetPath + '.bak';
          let bakTarget = bakPath;
          let counter = 1;
          while (existsSync(bakTarget)) {
            bakTarget = `${targetPath}.bak.${counter}`;
            counter++;
          }
          renameSync(targetPath, bakTarget);
          result.renamedFiles++;
        }
      }

      const parentDir = dirname(targetPath);
      if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true });
      }

      try {
        copyFileSync(sourcePath, targetPath);
        const stat = statSync(sourcePath);
        result.copiedFiles++;
        result.copiedBytes += stat.size;
      } catch (err: any) {
        if (err.code === 'ENOSPC') {
          throw new Error(`Disk full while copying ${relPath}`);
        }
        if (err.code === 'EACCES' || err.code === 'EPERM') {
          result.skippedFiles++;
          continue;
        }
        throw err;
      }
    }
  }
}

// --- Verification ---

function verifyRestoredFiles(targetDir: string, expectedCount: number): string | null {
  try {
    let actualCount = 0;
    countFilesRecursive(targetDir, (count) => { actualCount = count; });
    // Allow some tolerance since restic may count differently
    if (actualCount === 0 && expectedCount > 0) {
      return `No files found in target directory after restore`;
    }
    return null;
  } catch (err: any) {
    return `Verification error: ${err.message}`;
  }
}

function countFilesRecursive(dir: string, cb: (count: number) => void): void {
  let count = 0;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() || entry.isSymbolicLink()) {
        count++;
      } else if (entry.isDirectory()) {
        countFilesRecursive(join(dir, entry.name), (subCount) => { count += subCount; });
      }
    }
  } catch { /* skip inaccessible dirs */ }
  cb(count);
}

// --- Disk space check ---

function checkDiskSpace(targetPath: string): string | null {
  try {
    const { execSync } = require('node:child_process');
    const checkPath = existsSync(targetPath) ? targetPath : dirname(targetPath);
    const output = execSync(`df -B1 "${checkPath}" 2>/dev/null | tail -1`, { encoding: 'utf-8' });
    const parts = output.trim().split(/\s+/);
    if (parts.length >= 4) {
      const available = parseInt(parts[3], 10);
      // Require at least 100MB free
      if (available < 100 * 1024 * 1024) {
        return `Insufficient disk space: only ${(available / (1024 * 1024)).toFixed(0)} MB available at target`;
      }
    }
  } catch {
    // Can't check disk space, proceed anyway
  }
  return null;
}

// --- Cleanup ---

function cleanupTempDir(tempDir: string | null): void {
  if (!tempDir) return;
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch { /* ignore cleanup errors */ }
}

export function cancelRestoreJob(jobId: string): boolean {
  const job = db.select().from(schema.restoreJobs).where(eq(schema.restoreJobs.id, jobId)).get();
  if (!job || !job.taskId) return false;
  return cancelTask(job.taskId);
}
