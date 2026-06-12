import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { statSync, accessSync, constants as fsConstants } from 'node:fs';
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

  // --- Pre-flight: Execution Window ---
  const windowError = checkExecutionWindow(plan.cronExpression);
  if (windowError && triggerType === 'scheduled') {
    throw new Error(`Execution window check failed: ${windowError}`);
  }

  // --- Pre-flight: Permission Boundary (path access) ---
  const pathError = checkPathPermissions(paths);
  if (pathError) {
    throw new Error(`Permission boundary: ${pathError}`);
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

function checkExecutionWindow(cronExpression: string): string | null {
  // Parse hour range from cron: if expression specifies specific hours,
  // ensure current hour falls within the allowed window
  const parts = cronExpression.split(' ');
  if (parts.length < 5) return null;

  const hourPart = parts[1];
  if (hourPart === '*') return null; // anytime is fine

  const currentHour = new Date().getHours();

  // Handle range like "2-6"
  const rangeMatch = hourPart.match(/^(\d+)-(\d+)$/);
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1], 10);
    const end = parseInt(rangeMatch[2], 10);
    if (start <= end) {
      if (currentHour < start || currentHour > end) {
        return `Current hour ${currentHour} is outside execution window ${start}:00-${end}:59`;
      }
    } else {
      // wrapping range like 22-4
      if (currentHour < start && currentHour > end) {
        return `Current hour ${currentHour} is outside execution window ${start}:00-${end}:59`;
      }
    }
    return null;
  }

  // Handle specific hour like "2"
  const specificHour = parseInt(hourPart, 10);
  if (!isNaN(specificHour) && currentHour !== specificHour) {
    // Allow +-1 hour tolerance for scheduled runs
    if (Math.abs(currentHour - specificHour) > 1) {
      return `Current hour ${currentHour} is outside execution window (expected ~${specificHour}:00)`;
    }
  }

  return null;
}

function checkPathPermissions(paths: string[]): string | null {
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
        // For directories, estimate from stat — full recursive scan is too expensive for pre-flight.
        // We rely on restic's progress output to detect overrun during execution.
        // But we can at least check the directory is accessible.
        const estimate = estimateDirectorySize(p);
        totalSize += estimate.bytes;
        totalFiles += estimate.files;
      }
    } catch {
      // Skip inaccessible paths (caught by permission check above)
    }
  }

  if (maxBytes && totalSize > maxBytes) {
    return `Estimated size ${formatBytes(totalSize)} exceeds quota of ${formatBytes(maxBytes)}`;
  }
  if (maxFileCount && totalFiles > maxFileCount) {
    return `Estimated file count ${totalFiles} exceeds limit of ${maxFileCount}`;
  }
  return null;
}

function estimateDirectorySize(dirPath: string): { bytes: number; files: number } {
  try {
    const { readdirSync, statSync: statS, lstatSync: lstatS } = require('node:fs');
    const entries = readdirSync(dirPath, { withFileTypes: true });
    let bytes = 0;
    let files = 0;
    for (const entry of entries.slice(0, 1000)) {
      try {
        const fullPath = `${dirPath}/${entry.name}`;
        if (entry.isSymbolicLink()) {
          // Count symlinks as files but don't follow for size
          files++;
        } else if (entry.isFile()) {
          bytes += statS(fullPath).size;
          files++;
        } else if (entry.isDirectory()) {
          files += 10;
        }
      } catch { /* skip inaccessible entries (EACCES, ENOENT for broken symlinks) */ }
    }
    if (entries.length > 1000) {
      const ratio = entries.length / 1000;
      bytes = Math.round(bytes * ratio);
      files = Math.round(files * ratio);
    }
    return { bytes, files };
  } catch {
    return { bytes: 0, files: 0 };
  }
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
