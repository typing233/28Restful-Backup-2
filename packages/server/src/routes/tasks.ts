import type { FastifyInstance } from 'fastify';
import { eq, and, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db, schema } from '../db/connection.js';
import { enqueueTask, cancelTask } from '../queue/task-queue.js';
import type { TaskOperation, Task, TriggerTaskInput } from '@restful-backup/shared';

export function taskRoutes(app: FastifyInstance): void {
  app.post<{ Params: { id: string }; Body: TriggerTaskInput }>('/api/repos/:id/tasks', async (request, reply) => {
    const { userId } = request.user as { userId: string };
    const { id: repoId } = request.params;
    const { operation } = request.body;

    const validOps: TaskOperation[] = ['init', 'check', 'snapshots', 'stats', 'unlock'];
    if (!validOps.includes(operation)) {
      return reply.status(400).send({ error: `Invalid operation. Must be one of: ${validOps.join(', ')}` });
    }

    const repo = db.select().from(schema.repos)
      .where(and(eq(schema.repos.id, repoId), eq(schema.repos.userId, userId)))
      .get();

    if (!repo) return reply.status(404).send({ error: 'Repository not found' });

    const taskId = nanoid();
    db.insert(schema.tasks).values({
      id: taskId,
      repoId,
      userId,
      operation,
      status: 'queued',
      createdAt: new Date(),
    }).run();

    await enqueueTask(taskId, repoId, userId, operation);

    reply.status(202);
    return { taskId, status: 'queued' };
  });

  app.get<{ Params: { id: string } }>('/api/repos/:id/tasks', async (request) => {
    const { userId } = request.user as { userId: string };
    const { id: repoId } = request.params;

    const rows = db.select().from(schema.tasks)
      .where(and(eq(schema.tasks.repoId, repoId), eq(schema.tasks.userId, userId)))
      .orderBy(desc(schema.tasks.createdAt))
      .limit(50)
      .all();

    return rows.map(toTaskResponse);
  });

  app.get<{ Params: { taskId: string } }>('/api/tasks/:taskId', async (request, reply) => {
    const { userId } = request.user as { userId: string };
    const { taskId } = request.params;

    const task = db.select().from(schema.tasks)
      .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, userId)))
      .get();

    if (!task) return reply.status(404).send({ error: 'Task not found' });
    return toTaskResponse(task);
  });

  app.post<{ Params: { taskId: string } }>('/api/tasks/:taskId/cancel', async (request, reply) => {
    const { userId } = request.user as { userId: string };
    const { taskId } = request.params;

    const task = db.select().from(schema.tasks)
      .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, userId)))
      .get();

    if (!task) return reply.status(404).send({ error: 'Task not found' });
    if (task.status !== 'running' && task.status !== 'queued') {
      return reply.status(400).send({ error: 'Task is not running' });
    }

    const cancelled = cancelTask(taskId);
    return { cancelled };
  });
}

function toTaskResponse(row: typeof schema.tasks.$inferSelect): Task {
  return {
    id: row.id,
    repoId: row.repoId,
    userId: row.userId,
    operation: row.operation as Task['operation'],
    status: row.status as Task['status'],
    exitCode: row.exitCode,
    errorMessage: row.errorMessage,
    log: row.log,
    result: row.result ? JSON.parse(row.result) : null,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    durationMs: row.durationMs,
    createdAt: row.createdAt.toISOString(),
  };
}
