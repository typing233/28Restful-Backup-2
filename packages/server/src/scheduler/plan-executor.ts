import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { statSync, readdirSync, lstatSync, accessSync, constants as fsConstants } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { db, schema } from '../db/connection.js';
import { enqueueTask, taskEvents } from '../queue/task-queue.js';
import { buildBackupCommand, buildForgetCommand, buildCommand } from '../restic/commands.js';
import { config } from '../config.js';
import type { PlanRunTrigger, RetentionPolicy, ServerMessage } from '@restful-backup/shared';

// --- Concurrency limiter: global backup semaphore ---
let activeBackupCount = 0;
const pendingBackups: Array<() => void> = [];

function acquireBackupSlot(): Promise<void> {
  if (activeBackupCount < config.maxConcurrentTasks) {
    activeBackupCount++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    pendingBackups.push(() => { activeBackupCount++; resolve(); });
  });
}

function releaseBackupSlot(): void {
  activeBackupCount--;
  const next = pendingBackups.shift();
  if (next) next();
}

// --- Idempotency: per-plan lock to prevent duplicate runs ---
const runningPlans = new Set<string>();

export async function executePlanBackup(planId: string, triggerType: PlanRunTrigger): Promise<string> {
  // Idempotency guard: reject if plan already has a run in progress
  if (runningPlans.has(planId)) {
    throw new Error('Plan is already running. Wait for the current run to finish.');
  }

  const plan = db.select().from(schema.backupPlans).where(eq(schema.backupPlans.id, planId)).get();
  if (!plan) throw new Error('Plan not found');
  if (!plan.enabled && triggerType === 'scheduled') throw new Error('Plan is disabled');

  const paths: string[] = JSON.parse(plan.paths);
  const excludes: string[] = plan.excludes ? JSON.parse(plan.excludes) : [];
  const tags: string[] = plan.tags ? JSON.parse(plan.tags) : [];
  const retentionPolicy: RetentionPolicy | null = plan.retentionPolicy ? JSON.parse(plan.retentionPolicy) : null;
  const allowedBasePaths: string[] = plan.allowedBasePaths ? JSON.parse(plan.allowedBasePaths) : [];

  // --- Pre-flight: Execution Window (enforced for ALL triggers) ---
  const windowError = checkExecutionWindow(plan.allowedHoursStart, plan.allowedHoursEnd);
  if (windowError) {
    throw new Error(`Execution window rejected: ${windowError}`);
  }

  // --- Pre-flight: Permission Boundary (path allowlist) ---
  const pathError = checkPathBoundary(paths, allowedBasePaths);
  if (pathError) {
    throw new Error(`Permission boundary: ${pathError}`);
  }

  // --- Pre-flight: Path Accessibility ---
  const accessError = checkPathAccessibility(paths);
  if (accessError) {
    throw new Error(`Path access error: ${accessError}`);
  }

  // --- Pre-flight: Storage Quota ---
  if (plan.maxBytes || plan.maxFileCount) {
    const quotaError = checkStorageQuota(paths, plan.maxBytes, plan.maxFileCount);
    if (quotaError) {
      throw new Error(`Storage quota exceeded: ${quotaError}`);
    }
  }

  // Acquire concurrency slot
  await acquireBackupSlot();
  runningPlans.add(planId);

  const runId = nanoid();
  const taskId = nanoid();
  const context = JSON.stringify({ planId, runId });

  db.insert(schema.backupPlanRuns).values({
    id: runId,
    planId,
    taskId,
    triggerType,
    status: 'queued',
    createdAt: new Date(),
  }).run();

  db.insert(schema.tasks).values({
    id: taskId,
    repoId: plan.repoId,
    userId: plan.userId,
    operation: 'backup',
    status: 'queued',
    context,
    createdAt: new Date(),
  }).run();

  const command = buildBackupCommand({
    paths,
    excludes,
    tags,
    oneFileSystem: plan.oneFileSystem ?? false,
    excludeLargerThan: plan.excludeLargerThan ?? undefined,
  });

  taskEvents.emit('message', {
    type: 'plan:run-started',
    planId,
    runId,
    taskId,
  } satisfies ServerMessage);

  const completionHandler = (msg: ServerMessage) => {
    if (!('taskId' in msg) || msg.taskId !== taskId) return;

    if (msg.type === 'task:completed') {
      taskEvents.removeListener('message', completionHandler);
      handleBackupCompleted(planId, runId, taskId, retentionPolicy, plan.repoId, plan.userId).catch((err) => {
        console.error(`Post-backup handler failed for plan ${planId}:`, err);
      }).finally(() => {
        runningPlans.delete(planId);
        releaseBackupSlot();
      });
    } else if (msg.type === 'task:failed') {
      taskEvents.removeListener('message', completionHandler);
      handleBackupFailed(planId, runId, msg.error, msg.durationMs);
      runningPlans.delete(planId);
      releaseBackupSlot();
    } else if (msg.type === 'task:cancelled') {
      taskEvents.removeListener('message', completionHandler);
      db.update(schema.backupPlanRuns)
        .set({ status: 'cancelled', completedAt: new Date() })
        .where(eq(schema.backupPlanRuns.id, runId))
        .run();
      updatePlanLastRun(planId, 'cancelled');
      runningPlans.delete(planId);
      releaseBackupSlot();
    }
  };
  taskEvents.on('message', completionHandler);

  await enqueueTask(taskId, plan.repoId, plan.userId, 'backup', command, context);

  return runId;
}

// --- Pre-flight check implementations ---

function checkExecutionWindow(allowedStart: number | null, allowedEnd: number | null): string | null {
  if (allowedStart == null || allowedEnd == null) return null;

  const currentHour = new Date().getHours();

  if (allowedStart <= allowedEnd) {
    // Normal range: e.g. 2-6 means hours 2,3,4,5,6 are allowed
    if (currentHour < allowedStart || currentHour > allowedEnd) {
      return `Current hour ${currentHour}:00 is outside allowed execution window ${allowedStart}:00–${allowedEnd}:59. Backup refused.`;
    }
  } else {
    // Wrapping range: e.g. 22-4 means hours 22,23,0,1,2,3,4 are allowed
    if (currentHour < allowedStart && currentHour > allowedEnd) {
      return `Current hour ${currentHour}:00 is outside allowed execution window ${allowedStart}:00–${allowedEnd}:59 (overnight). Backup refused.`;
    }
  }
  return null;
}

function checkPathBoundary(paths: string[], allowedBasePaths: string[]): string | null {
  if (allowedBasePaths.length === 0) return null;

  const resolvedAllowed = allowedBasePaths.map((p) => resolvePath(p));

  for (const p of paths) {
    const resolved = resolvePath(p);
    const isWithinAllowed = resolvedAllowed.some((base) =>
      resolved === base || resolved.startsWith(base + '/')
    );
    if (!isWithinAllowed) {
      return `Path "${p}" is outside allowed boundaries. Allowed base paths: ${allowedBasePaths.join(', ')}`;
    }
  }
  return null;
}

function checkPathAccessibility(paths: string[]): string | null {
  for (const p of paths) {
    try {
      accessSync(p, fsConstants.R_OK);
    } catch {
      return `Cannot read path "${p}" — permission denied or path does not exist`;
    }
  }
  return null;
}

function checkStorageQuota(paths: string[], maxBytes: number | null, maxFileCount: number | null): string | null {
  let totalSize = 0;
  let totalFiles = 0;

  for (const p of paths) {
    try {
      const stat = statSync(p);
      if (stat.isFile()) {
        totalSize += stat.size;
        totalFiles += 1;
      } else if (stat.isDirectory()) {
        const estimate = scanDirectorySize(p, maxBytes, maxFileCount);
        totalSize += estimate.bytes;
        totalFiles += estimate.files;
        // Early exit if already exceeded
        if (maxBytes && totalSize > maxBytes) {
          return `Total size ${formatBytes(totalSize)} exceeds quota of ${formatBytes(maxBytes)} (exceeded while scanning "${p}")`;
        }
        if (maxFileCount && totalFiles > maxFileCount) {
          return `Total file count ${totalFiles} exceeds limit of ${maxFileCount} (exceeded while scanning "${p}")`;
        }
      }
    } catch {
      // Skip inaccessible paths (caught by accessibility check above)
    }
  }

  if (maxBytes && totalSize > maxBytes) {
    return `Total size ${formatBytes(totalSize)} exceeds quota of ${formatBytes(maxBytes)}`;
  }
  if (maxFileCount && totalFiles > maxFileCount) {
    return `Total file count ${totalFiles} exceeds limit of ${maxFileCount}`;
  }
  return null;
}

function scanDirectorySize(
  dirPath: string,
  maxBytes: number | null,
  maxFileCount: number | null,
  depth: number = 0,
): { bytes: number; files: number } {
  // Recursive scan with depth limit to avoid infinite loops on circular symlinks
  if (depth > 32) return { bytes: 0, files: 0 };

  let bytes = 0;
  let files = 0;

  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      try {
        const fullPath = join(dirPath, entry.name);
        if (entry.isSymbolicLink()) {
          files++;
        } else if (entry.isFile()) {
          const s = statSync(fullPath);
          bytes += s.size;
          files++;
        } else if (entry.isDirectory()) {
          const sub = scanDirectorySize(fullPath, maxBytes, maxFileCount, depth + 1);
          bytes += sub.bytes;
          files += sub.files;
        }
        // Early exit if already over quota
        if (maxBytes && bytes > maxBytes) return { bytes, files };
        if (maxFileCount && files > maxFileCount) return { bytes, files };
      } catch { /* skip inaccessible entries */ }
    }
  } catch { /* skip inaccessible directories */ }

  return { bytes, files };
}

// --- Post-backup handlers ---

async function handleBackupCompleted(
  planId: string,
  runId: string,
  taskId: string,
  retentionPolicy: RetentionPolicy | null,
  repoId: string,
  userId: string,
): Promise<void> {
  const task = db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
  if (!task) return;

  let snapshotId: string | null = null;
  let filesNew = 0;
  let filesChanged = 0;
  let filesUnmodified = 0;
  let bytesAdded = 0;
  let bytesProcessed = 0;

  if (task.result) {
    try {
      const result = JSON.parse(task.result);
      snapshotId = result.snapshot_id || null;
      filesNew = result.files_new || 0;
      filesChanged = result.files_changed || 0;
      filesUnmodified = result.files_unmodified || 0;
      bytesAdded = result.data_added || 0;
      bytesProcessed = result.total_bytes_processed || 0;
    } catch { /* ignore */ }
  }

  if (!snapshotId && task.log) {
    const snapMatch = task.log.match(/snapshot ([a-f0-9]+) saved/);
    if (snapMatch) snapshotId = snapMatch[1];
  }

  db.update(schema.backupPlanRuns)
    .set({
      status: 'completed',
      snapshotId,
      filesNew,
      filesChanged,
      filesUnmodified,
      bytesAdded,
      bytesProcessed,
      durationMs: task.durationMs,
      completedAt: new Date(),
    })
    .where(eq(schema.backupPlanRuns.id, runId))
    .run();

  taskEvents.emit('message', {
    type: 'plan:run-completed',
    planId,
    runId,
    snapshotId: snapshotId || '',
    filesNew,
    bytesAdded,
    durationMs: task.durationMs || 0,
  } satisfies ServerMessage);

  updatePlanLastRun(planId, 'completed');

  // --- Post-backup verification: run `restic check` ---
  await runPostBackupVerification(repoId, userId, planId, runId);

  // --- Apply retention policy if configured ---
  if (retentionPolicy && hasRetentionRules(retentionPolicy)) {
    await applyRetention(planId, runId, repoId, userId, retentionPolicy);
  }
}

async function runPostBackupVerification(repoId: string, userId: string, planId: string, runId: string): Promise<void> {
  const checkTaskId = nanoid();
  const checkCommand = buildCommand('check');
  const checkContext = JSON.stringify({ planId, runId, verification: true });

  db.insert(schema.tasks).values({
    id: checkTaskId,
    repoId,
    userId,
    operation: 'check',
    status: 'queued',
    context: checkContext,
    createdAt: new Date(),
  }).run();

  return new Promise<void>((resolve) => {
    const handler = (msg: ServerMessage) => {
      if (!('taskId' in msg) || msg.taskId !== checkTaskId) return;
      if (msg.type === 'task:completed' || msg.type === 'task:failed' || msg.type === 'task:cancelled') {
        taskEvents.removeListener('message', handler);
        if (msg.type === 'task:failed') {
          // Mark run with verification warning (don't fail the whole run)
          const existingRun = db.select().from(schema.backupPlanRuns).where(eq(schema.backupPlanRuns.id, runId)).get();
          const prevError = existingRun?.errorMessage || '';
          db.update(schema.backupPlanRuns)
            .set({ errorMessage: prevError ? `${prevError}; Verification failed: ${msg.error}` : `Verification warning: ${msg.error}` })
            .where(eq(schema.backupPlanRuns.id, runId))
            .run();
        }
        resolve();
      }
    };
    taskEvents.on('message', handler);
    enqueueTask(checkTaskId, repoId, userId, 'check', checkCommand, checkContext).catch(() => resolve());
  });
}

async function applyRetention(
  planId: string,
  runId: string,
  repoId: string,
  userId: string,
  policy: RetentionPolicy,
): Promise<void> {
  const forgetTaskId = nanoid();
  const command = buildForgetCommand({ ...policy, prune: true });

  db.insert(schema.tasks).values({
    id: forgetTaskId,
    repoId,
    userId,
    operation: 'forget',
    status: 'queued',
    context: JSON.stringify({ planId, runId, retention: true }),
    createdAt: new Date(),
  }).run();

  const retentionHandler = (msg: ServerMessage) => {
    if (!('taskId' in msg) || msg.taskId !== forgetTaskId) return;
    if (msg.type === 'task:completed' || msg.type === 'task:failed' || msg.type === 'task:cancelled') {
      taskEvents.removeListener('message', retentionHandler);
      if (msg.type === 'task:completed') {
        db.update(schema.backupPlanRuns)
          .set({ retentionApplied: true })
          .where(eq(schema.backupPlanRuns.id, runId))
          .run();
        taskEvents.emit('message', {
          type: 'plan:retention-applied',
          planId,
          runId,
          snapshotsRemoved: 0,
        } satisfies ServerMessage);
      }
    }
  };
  taskEvents.on('message', retentionHandler);

  await enqueueTask(forgetTaskId, repoId, userId, 'forget', command, JSON.stringify({ planId, runId, retention: true }));
}

function handleBackupFailed(planId: string, runId: string, error: string, durationMs: number): void {
  const errorCategory = classifyBackupError(error);

  db.update(schema.backupPlanRuns)
    .set({
      status: 'failed',
      errorMessage: errorCategory ? `[${errorCategory}] ${error}` : error,
      durationMs,
      completedAt: new Date(),
    })
    .where(eq(schema.backupPlanRuns.id, runId))
    .run();

  taskEvents.emit('message', {
    type: 'plan:run-failed',
    planId,
    runId,
    error: errorCategory ? `[${errorCategory}] ${error}` : error,
    durationMs,
  } satisfies ServerMessage);

  updatePlanLastRun(planId, 'failed');

  // Auto-retry with idempotency: only retry recoverable errors
  if (errorCategory === 'permission_denied' || errorCategory === 'disk_full') {
    // Don't retry non-recoverable errors
    return;
  }

  const runs = db.select().from(schema.backupPlanRuns)
    .where(eq(schema.backupPlanRuns.planId, planId))
    .all();
  const recentFailures = runs.filter(
    (r) => r.status === 'failed' && r.createdAt.getTime() > Date.now() - 3600_000
  ).length;

  if (recentFailures < config.maxRetries) {
    const retryDelay = Math.pow(2, recentFailures) * 30_000;
    setTimeout(() => {
      executePlanBackup(planId, 'scheduled').catch(() => {});
    }, retryDelay);
  }
}

function classifyBackupError(error: string): string | null {
  const lower = error.toLowerCase();
  if (lower.includes('permission denied') || lower.includes('eacces') || lower.includes('eperm')) {
    return 'permission_denied';
  }
  if (lower.includes('no space left') || lower.includes('enospc') || lower.includes('disk full')) {
    return 'disk_full';
  }
  if (lower.includes('connection') || lower.includes('timeout') || lower.includes('network')) {
    return 'network_error';
  }
  if (lower.includes('lock') || lower.includes('already locked')) {
    return 'repo_locked';
  }
  if (lower.includes('signal') || lower.includes('killed') || lower.includes('interrupted')) {
    return 'interrupted';
  }
  return null;
}

function updatePlanLastRun(planId: string, status: string): void {
  db.update(schema.backupPlans)
    .set({ lastRunAt: new Date(), lastRunStatus: status, updatedAt: new Date() })
    .where(eq(schema.backupPlans.id, planId))
    .run();
}

function hasRetentionRules(policy: RetentionPolicy): boolean {
  return !!(policy.keepLast || policy.keepDaily || policy.keepWeekly || policy.keepMonthly || policy.keepYearly || policy.keepWithinDuration);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}
