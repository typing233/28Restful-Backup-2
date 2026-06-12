import type { FastifyInstance } from 'fastify';
import { eq, and, desc } from 'drizzle-orm';
import { db, schema } from '../db/connection.js';
import { startRestore } from '../services/restore-service.js';
import { cancelTask } from '../queue/task-queue.js';
import type { RestoreJobInput, RestoreJob } from '@restful-backup/shared';

export function restoreRoutes(app: FastifyInstance): void {
  app.post<{ Params: { id: string }; Body: RestoreJobInput }>('/api/repos/:id/restore', async (request, reply) => {
    const { userId } = request.user as { userId: string };
    const { id: repoId } = request.params;
    const body = request.body;

    const repo = db.select().from(schema.repos)
      .where(and(eq(schema.repos.id, repoId), eq(schema.repos.userId, userId)))
      .get();
    if (!repo) return reply.status(404).send({ error: 'Repository not found' });

    if (!body.snapshotId || !body.targetPath || !body.sourcePaths?.length) {
      return reply.status(400).send({ error: 'snapshotId, sourcePaths, and targetPath are required' });
    }

    try {
      const result = await startRestore(repoId, userId, body);
      reply.status(202);
      return result;
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  app.get<{ Params: { id: string } }>('/api/repos/:id/restore-jobs', async (request) => {
    const { userId } = request.user as { userId: string };
    const { id: repoId } = request.params;

    const rows = db.select().from(schema.restoreJobs)
      .where(and(eq(schema.restoreJobs.repoId, repoId), eq(schema.restoreJobs.userId, userId)))
      .orderBy(desc(schema.restoreJobs.createdAt))
      .limit(50)
      .all();

    return rows.map(toRestoreJobResponse);
  });

  app.get<{ Params: { jobId: string } }>('/api/restore-jobs/:jobId', async (request, reply) => {
    const { userId } = request.user as { userId: string };
    const { jobId } = request.params;

    const job = db.select().from(schema.restoreJobs)
      .where(and(eq(schema.restoreJobs.id, jobId), eq(schema.restoreJobs.userId, userId)))
      .get();
    if (!job) return reply.status(404).send({ error: 'Restore job not found' });

    return toRestoreJobResponse(job);
  });

  app.post<{ Params: { jobId: string } }>('/api/restore-jobs/:jobId/cancel', async (request, reply) => {
    const { userId } = request.user as { userId: string };
    const { jobId } = request.params;

    const job = db.select().from(schema.restoreJobs)
      .where(and(eq(schema.restoreJobs.id, jobId), eq(schema.restoreJobs.userId, userId)))
      .get();
    if (!job) return reply.status(404).send({ error: 'Restore job not found' });
    if (job.status !== 'running' && job.status !== 'pending') {
      return reply.status(400).send({ error: 'Job is not running' });
    }

    if (job.taskId) {
      cancelTask(job.taskId);
    }
    db.update(schema.restoreJobs)
      .set({ status: 'cancelled', completedAt: new Date() })
      .where(eq(schema.restoreJobs.id, jobId))
      .run();

    return { cancelled: true };
  });
}

function toRestoreJobResponse(row: typeof schema.restoreJobs.$inferSelect): RestoreJob {
  return {
    id: row.id,
    repoId: row.repoId,
    userId: row.userId,
    taskId: row.taskId,
    snapshotId: row.snapshotId,
    sourcePaths: JSON.parse(row.sourcePaths),
    targetPath: row.targetPath,
    conflictStrategy: row.conflictStrategy as RestoreJob['conflictStrategy'],
    status: row.status,
    filesRestored: row.filesRestored,
    bytesRestored: row.bytesRestored,
    durationMs: row.durationMs,
    errorMessage: row.errorMessage,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
