import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { readdirSync, statSync, accessSync, constants as fsConstants } from 'node:fs';
import { join, resolve } from 'node:path';
import { db, schema } from '../db/connection.js';
import { enqueueTask, taskEvents, cancelTask } from '../queue/task-queue.js';
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

export interface ExecutePlanOptions {
  triggerType: PlanRunTrigger;
  force?: boolean;
}

export async function executePlanBackup(planId: string, opts: ExecutePlanOptions): Promise<string> {
  if (runningPlans.has(planId)) {
    throw new Error('Plan is already running. Wait for the current run to finish.');
  }

  const plan = db.select().from(schema.backupPlans).where(eq(schema.backupPlans.id, planId)).get();
  if (!plan) throw new Error('Plan not found');
  if (!plan.enabled && opts.triggerType === 'scheduled') throw new Error('Plan is disabled');

  const paths: string[] = JSON.parse(plan.paths);
  const excludes: string[] = plan.excludes ? JSON.parse(plan.excludes) : [];
  const tags: string[] = plan.tags ? JSON.parse(plan.tags) : [];
  const retentionPolicy: RetentionPolicy | null = plan.retentionPolicy ? JSON.parse(plan.retentionPolicy) : null;
  const allowedBasePaths: string[] | null = plan.allowedBasePaths ? JSON.parse(plan.allowedBasePaths) : null;

  // --- Pre-flight: Execution Window (blocks BOTH scheduled and manual unless force) ---
  const windowError = checkExecutionWindow(plan.cronExpression);
  if (windowError) {
    if (opts.force) {
      console.warn(`[plan ${planId}] Execution window bypassed with force: ${windowError}`);
    } else {
      throw new Error(`Execution window: ${windowError}. Use force=true to override for manual triggers.`);
    }
  }

  // --- Pre-flight: Permission Boundary ---
  const pathError = checkPathBoundary(paths, allowedBasePaths);
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
    triggerType: opts.triggerType,
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

  // Runtime quota monitoring
  const cleanupMonitor = monitorQuotaDuringBackup(taskId, plan.maxBytes, plan.maxFileCount);

  const completionHandler = (msg: ServerMessage) => {
    if (!('taskId' in msg) || msg.taskId !== taskId) return;

    if (msg.type === 'task:completed') {
      taskEvents.removeListener('message', completionHandler);
      cleanupMonitor();
      handleBackupCompleted(planId, runId, taskId, retentionPolicy, plan.repoId, plan.userId).catch((err) => {
        console.error(`Post-backup handler failed for plan ${planId}:`, err);
      }).finally(() => {
        runningPlans.delete(planId);
        releaseBackupSlot();
      });
    } else if (msg.type === 'task:failed') {
      taskEvents.removeListener('message', completionHandler);
      cleanupMonitor();
      handleBackupFailed(planId, runId, msg.error, msg.durationMs);
      runningPlans.delete(planId);
      releaseBackupSlot();
    } else if (msg.type === 'task:cancelled') {
      taskEvents.removeListener('message', completionHandler);
      cleanupMonitor();
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

// --- Pre-flight check implementations (exported for testing) ---

export function checkExecutionWindow(cronExpression: string): string | null {
  const parts = cronExpression.split(' ');
  if (parts.length < 5) return null;

  const hourPart = parts[1];
  if (hourPart === '*') return null;

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
      if (currentHour < start && currentHour > end) {
        return `Current hour ${currentHour} is outside execution window ${start}:00-${end}:59`;
      }
    }
    return null;
  }

  // Handle comma-separated hours like "2,14,22"
  if (hourPart.includes(',')) {
    const allowedHours = hourPart.split(',').map(h => parseInt(h, 10)).filter(h => !isNaN(h));
    if (allowedHours.length > 0 && !allowedHours.includes(currentHour)) {
      return `Current hour ${currentHour} is outside allowed hours [${allowedHours.join(', ')}]`;
    }
    return null;
  }

  // Handle specific hour like "2"
  const specificHour = parseInt(hourPart, 10);
  if (!isNaN(specificHour) && currentHour !== specificHour) {
    return `Current hour ${currentHour} is outside execution window (expected hour ${specificHour})`;
  }

  return null;
}

export function checkPathBoundary(paths: string[], allowedBasePaths: string[] | null): string | null {
  // Check OS read access
  for (const p of paths) {
    try {
      accessSync(p, fsConstants.R_OK);
    } catch {
      return `Cannot read path "${p}" — permission denied or path does not exist`;
    }
  }

  // Enforce allowlist boundary if configured
  if (!allowedBasePaths || allowedBasePaths.length === 0) return null;

  for (const p of paths) {
    const resolved = resolve(p);
    const withinBoundary = allowedBasePaths.some(base => {
      const resolvedBase = resolve(base);
      return resolved === resolvedBase || resolved.startsWith(resolvedBase + '/');
    });
    if (!withinBoundary) {
      return `Path "${p}" is outside allowed boundaries: [${allowedBasePaths.join(', ')}]`;
    }
  }
  return null;
}

export function checkStorageQuota(paths: string[], maxBytes: number | null, maxFileCount: number | null): string | null {
  let totalSize = 0;
  let totalFiles = 0;
  let anyPartial = false;

  for (const p of paths) {
    try {
      const stat = statSync(p);
      if (stat.isFile()) {
        totalSize += stat.size;
        totalFiles += 1;
      } else if (stat.isDirectory()) {
        const measured = measureDirectorySize(p);
        totalSize += measured.bytes;
        totalFiles += measured.files;
        if (measured.partial) anyPartial = true;
      }
    } catch {
      // Skip inaccessible paths
    }
  }

  if (maxBytes && totalSize > maxBytes) {
    return `Measured size ${formatBytes(totalSize)} exceeds quota of ${formatBytes(maxBytes)}`;
  }
  if (maxFileCount && totalFiles > maxFileCount) {
    return `Measured file count ${totalFiles} exceeds limit of ${maxFileCount}`;
  }

  // If scan was partial and values are within limits, we can't prove over-quota.
  // Runtime monitoring will catch it during execution.
  if (anyPartial && (maxBytes || maxFileCount)) {
    console.warn(`Storage quota pre-flight: scan was partial (large directory). Runtime monitoring will enforce quota.`);
  }

  return null;
}

export function measureDirectorySize(dirPath: string): { bytes: number; files: number; partial: boolean } {
  const MAX_FILES = 100_000;
  const TIMEOUT_MS = 10_000;
  const startTime = Date.now();
  let bytes = 0;
  let files = 0;
  let partial = false;

  function walk(dir: string): void {
    if (partial || files >= MAX_FILES) { partial = true; return; }
    if (Date.now() - startTime > TIMEOUT_MS) { partial = true; return; }

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (partial || files >= MAX_FILES) { partial = true; return; }
      if (Date.now() - startTime > TIMEOUT_MS) { partial = true; return; }

      const fullPath = join(dir, entry.name);
      try {
        if (entry.isSymbolicLink()) {
          files++;
        } else if (entry.isFile()) {
          bytes += statSync(fullPath).size;
          files++;
        } else if (entry.isDirectory()) {
          walk(fullPath);
        }
      } catch { /* skip inaccessible entries */ }
    }
  }

  walk(dirPath);
  return { bytes, files, partial };
}

// --- Runtime quota monitoring ---

function monitorQuotaDuringBackup(taskId: string, maxBytes: number | null, maxFileCount: number | null): () => void {
  if (!maxBytes && !maxFileCount) return () => {};

  const handler = (msg: ServerMessage) => {
    if (msg.type !== 'task:log' || !('taskId' in msg) || msg.taskId !== taskId) return;
    if (!('line' in msg)) return;

    try {
      const json = JSON.parse(msg.line);
      if (json.message_type === 'status') {
        if (maxBytes && json.bytes_done > maxBytes) {
          console.warn(`[quota] Task ${taskId}: bytes_done ${json.bytes_done} exceeds quota ${maxBytes}. Cancelling.`);
          cancelTask(taskId);
        }
        if (maxFileCount && json.files_done > maxFileCount) {
          console.warn(`[quota] Task ${taskId}: files_done ${json.files_done} exceeds limit ${maxFileCount}. Cancelling.`);
          cancelTask(taskId);
        }
      }
    } catch { /* not JSON */ }
  };

  taskEvents.on('message', handler);
  return () => taskEvents.removeListener('message', handler);
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

  await runPostBackupVerification(repoId, userId, planId, runId);

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

  if (errorCategory === 'permission_denied' || errorCategory === 'disk_full') {
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
      executePlanBackup(planId, { triggerType: 'scheduled' }).catch(() => {});
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
