import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db, schema } from '../db/connection.js';
import { enqueueTask, taskEvents } from '../queue/task-queue.js';
import { buildBackupCommand, buildForgetCommand } from '../restic/commands.js';
import { config } from '../config.js';
import type { PlanRunTrigger, RetentionPolicy, ServerMessage } from '@restful-backup/shared';

export async function executePlanBackup(planId: string, triggerType: PlanRunTrigger): Promise<string> {
  const plan = db.select().from(schema.backupPlans).where(eq(schema.backupPlans.id, planId)).get();
  if (!plan) throw new Error('Plan not found');
  if (!plan.enabled && triggerType === 'scheduled') throw new Error('Plan is disabled');

  const paths: string[] = JSON.parse(plan.paths);
  const excludes: string[] = plan.excludes ? JSON.parse(plan.excludes) : [];
  const tags: string[] = plan.tags ? JSON.parse(plan.tags) : [];
  const retentionPolicy: RetentionPolicy | null = plan.retentionPolicy ? JSON.parse(plan.retentionPolicy) : null;

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

  const command = buildBackupCommand({ paths, excludes, tags });

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
      });
    } else if (msg.type === 'task:failed') {
      taskEvents.removeListener('message', completionHandler);
      handleBackupFailed(planId, runId, msg.error, msg.durationMs);
    } else if (msg.type === 'task:cancelled') {
      taskEvents.removeListener('message', completionHandler);
      db.update(schema.backupPlanRuns)
        .set({ status: 'cancelled', completedAt: new Date() })
        .where(eq(schema.backupPlanRuns.id, runId))
        .run();
      updatePlanLastRun(planId, 'cancelled');
    }
  };
  taskEvents.on('message', completionHandler);

  await enqueueTask(taskId, plan.repoId, plan.userId, 'backup', command, context);

  return runId;
}

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

  // Also try parsing from log (restic backup summary line)
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

  if (retentionPolicy && hasRetentionRules(retentionPolicy)) {
    await applyRetention(planId, runId, repoId, userId, retentionPolicy);
  }
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
  db.update(schema.backupPlanRuns)
    .set({
      status: 'failed',
      errorMessage: error,
      durationMs,
      completedAt: new Date(),
    })
    .where(eq(schema.backupPlanRuns.id, runId))
    .run();

  taskEvents.emit('message', {
    type: 'plan:run-failed',
    planId,
    runId,
    error,
    durationMs,
  } satisfies ServerMessage);

  updatePlanLastRun(planId, 'failed');

  // Auto-retry logic
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

function updatePlanLastRun(planId: string, status: string): void {
  db.update(schema.backupPlans)
    .set({ lastRunAt: new Date(), lastRunStatus: status, updatedAt: new Date() })
    .where(eq(schema.backupPlans.id, planId))
    .run();
}

function hasRetentionRules(policy: RetentionPolicy): boolean {
  return !!(policy.keepLast || policy.keepDaily || policy.keepWeekly || policy.keepMonthly || policy.keepYearly || policy.keepWithinDuration);
}
