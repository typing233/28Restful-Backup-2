import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
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

  const jobId = nanoid();
  const taskId = nanoid();
  const context = JSON.stringify({ restoreJobId: jobId });

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

  const effectiveTarget = input.conflictStrategy === 'overwrite'
    ? input.targetPath
    : input.targetPath;

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
      handleRestoreCompleted(jobId, taskId);
    } else if (msg.type === 'task:failed') {
      taskEvents.removeListener('message', completionHandler);
      handleRestoreFailed(jobId, msg.error, msg.durationMs);
    } else if (msg.type === 'task:cancelled') {
      taskEvents.removeListener('message', completionHandler);
      db.update(schema.restoreJobs)
        .set({ status: 'cancelled', completedAt: new Date() })
        .where(eq(schema.restoreJobs.id, jobId))
        .run();
    }
  };
  taskEvents.on('message', completionHandler);

  await enqueueTask(taskId, repoId, userId, 'restore', command, context);

  return { jobId, taskId };
}

function handleRestoreCompleted(jobId: string, taskId: string): void {
  const task = db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
  let filesRestored = 0;
  let bytesRestored = 0;

  if (task?.log) {
    const filesMatch = task.log.match(/restoring.*?(\d+)\s+files/i);
    if (filesMatch) filesRestored = parseInt(filesMatch[1], 10);
    const bytesMatch = task.log.match(/(\d+)\s+bytes/i);
    if (bytesMatch) bytesRestored = parseInt(bytesMatch[1], 10);
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

function handleRestoreFailed(jobId: string, error: string, durationMs: number): void {
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

export function cancelRestoreJob(jobId: string): boolean {
  const job = db.select().from(schema.restoreJobs).where(eq(schema.restoreJobs.id, jobId)).get();
  if (!job || !job.taskId) return false;
  return cancelTask(job.taskId);
}
