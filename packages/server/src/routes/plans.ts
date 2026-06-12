import type { FastifyInstance } from 'fastify';
import { eq, and, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db, schema } from '../db/connection.js';
import { schedulePlan, unschedulePlan, reschedulePlan } from '../scheduler/plan-scheduler.js';
import { executePlanBackup } from '../scheduler/plan-executor.js';
import type { BackupPlan, BackupPlanRun, CreateBackupPlanInput, UpdateBackupPlanInput } from '@restful-backup/shared';

export function planRoutes(app: FastifyInstance): void {
  app.get<{ Params: { id: string } }>('/api/repos/:id/plans', async (request) => {
    const { userId } = request.user as { userId: string };
    const { id: repoId } = request.params;

    const rows = db.select().from(schema.backupPlans)
      .where(and(eq(schema.backupPlans.repoId, repoId), eq(schema.backupPlans.userId, userId)))
      .orderBy(desc(schema.backupPlans.createdAt))
      .all();

    return rows.map(toPlanResponse);
  });

  app.post<{ Params: { id: string }; Body: CreateBackupPlanInput }>('/api/repos/:id/plans', async (request, reply) => {
    const { userId } = request.user as { userId: string };
    const { id: repoId } = request.params;
    const body = request.body;

    const repo = db.select().from(schema.repos)
      .where(and(eq(schema.repos.id, repoId), eq(schema.repos.userId, userId)))
      .get();
    if (!repo) return reply.status(404).send({ error: 'Repository not found' });

    if (!body.name || !body.cronExpression || !body.paths?.length) {
      return reply.status(400).send({ error: 'name, cronExpression, and paths are required' });
    }

    const id = nanoid();
    const now = new Date();

    db.insert(schema.backupPlans).values({
      id,
      repoId,
      userId,
      name: body.name,
      enabled: true,
      cronExpression: body.cronExpression,
      paths: JSON.stringify(body.paths),
      excludes: body.excludes ? JSON.stringify(body.excludes) : null,
      tags: body.tags ? JSON.stringify(body.tags) : null,
      retentionPolicy: body.retentionPolicy ? JSON.stringify(body.retentionPolicy) : null,
      maxFileCount: body.maxFileCount ?? null,
      maxBytes: body.maxBytes ?? null,
      oneFileSystem: body.oneFileSystem ?? false,
      excludeLargerThan: body.excludeLargerThan ?? null,
      allowedBasePaths: body.allowedBasePaths ? JSON.stringify(body.allowedBasePaths) : null,
      preHook: body.preHook ?? null,
      postHook: body.postHook ?? null,
      createdAt: now,
      updatedAt: now,
    }).run();

    schedulePlan(id, body.cronExpression);

    const plan = db.select().from(schema.backupPlans).where(eq(schema.backupPlans.id, id)).get()!;
    return toPlanResponse(plan);
  });

  app.get<{ Params: { planId: string } }>('/api/plans/:planId', async (request, reply) => {
    const { userId } = request.user as { userId: string };
    const { planId } = request.params;

    const plan = db.select().from(schema.backupPlans)
      .where(and(eq(schema.backupPlans.id, planId), eq(schema.backupPlans.userId, userId)))
      .get();
    if (!plan) return reply.status(404).send({ error: 'Plan not found' });

    return toPlanResponse(plan);
  });

  app.put<{ Params: { planId: string }; Body: UpdateBackupPlanInput }>('/api/plans/:planId', async (request, reply) => {
    const { userId } = request.user as { userId: string };
    const { planId } = request.params;
    const body = request.body;

    const existing = db.select().from(schema.backupPlans)
      .where(and(eq(schema.backupPlans.id, planId), eq(schema.backupPlans.userId, userId)))
      .get();
    if (!existing) return reply.status(404).send({ error: 'Plan not found' });

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) updates.name = body.name;
    if (body.cronExpression !== undefined) updates.cronExpression = body.cronExpression;
    if (body.paths !== undefined) updates.paths = JSON.stringify(body.paths);
    if (body.excludes !== undefined) updates.excludes = body.excludes ? JSON.stringify(body.excludes) : null;
    if (body.tags !== undefined) updates.tags = body.tags ? JSON.stringify(body.tags) : null;
    if (body.retentionPolicy !== undefined) updates.retentionPolicy = body.retentionPolicy ? JSON.stringify(body.retentionPolicy) : null;
    if (body.maxFileCount !== undefined) updates.maxFileCount = body.maxFileCount;
    if (body.maxBytes !== undefined) updates.maxBytes = body.maxBytes;
    if (body.oneFileSystem !== undefined) updates.oneFileSystem = body.oneFileSystem;
    if (body.excludeLargerThan !== undefined) updates.excludeLargerThan = body.excludeLargerThan;
    if (body.allowedBasePaths !== undefined) updates.allowedBasePaths = body.allowedBasePaths ? JSON.stringify(body.allowedBasePaths) : null;
    if (body.enabled !== undefined) updates.enabled = body.enabled;
    if (body.preHook !== undefined) updates.preHook = body.preHook;
    if (body.postHook !== undefined) updates.postHook = body.postHook;

    db.update(schema.backupPlans).set(updates).where(eq(schema.backupPlans.id, planId)).run();

    const plan = db.select().from(schema.backupPlans).where(eq(schema.backupPlans.id, planId)).get()!;

    if (body.cronExpression || body.enabled !== undefined) {
      if (plan.enabled) {
        reschedulePlan(planId, plan.cronExpression);
      } else {
        unschedulePlan(planId);
      }
    }

    return toPlanResponse(plan);
  });

  app.delete<{ Params: { planId: string } }>('/api/plans/:planId', async (request, reply) => {
    const { userId } = request.user as { userId: string };
    const { planId } = request.params;

    const existing = db.select().from(schema.backupPlans)
      .where(and(eq(schema.backupPlans.id, planId), eq(schema.backupPlans.userId, userId)))
      .get();
    if (!existing) return reply.status(404).send({ error: 'Plan not found' });

    unschedulePlan(planId);
    db.delete(schema.backupPlanRuns).where(eq(schema.backupPlanRuns.planId, planId)).run();
    db.delete(schema.backupPlans).where(eq(schema.backupPlans.id, planId)).run();
    return { success: true };
  });

  app.post<{ Params: { planId: string } }>('/api/plans/:planId/pause', async (request, reply) => {
    const { userId } = request.user as { userId: string };
    const { planId } = request.params;

    const plan = db.select().from(schema.backupPlans)
      .where(and(eq(schema.backupPlans.id, planId), eq(schema.backupPlans.userId, userId)))
      .get();
    if (!plan) return reply.status(404).send({ error: 'Plan not found' });

    db.update(schema.backupPlans)
      .set({ enabled: false, updatedAt: new Date() })
      .where(eq(schema.backupPlans.id, planId))
      .run();
    unschedulePlan(planId);

    const updated = db.select().from(schema.backupPlans).where(eq(schema.backupPlans.id, planId)).get()!;
    return toPlanResponse(updated);
  });

  app.post<{ Params: { planId: string } }>('/api/plans/:planId/resume', async (request, reply) => {
    const { userId } = request.user as { userId: string };
    const { planId } = request.params;

    const plan = db.select().from(schema.backupPlans)
      .where(and(eq(schema.backupPlans.id, planId), eq(schema.backupPlans.userId, userId)))
      .get();
    if (!plan) return reply.status(404).send({ error: 'Plan not found' });

    db.update(schema.backupPlans)
      .set({ enabled: true, updatedAt: new Date() })
      .where(eq(schema.backupPlans.id, planId))
      .run();
    schedulePlan(planId, plan.cronExpression);

    const updated = db.select().from(schema.backupPlans).where(eq(schema.backupPlans.id, planId)).get()!;
    return toPlanResponse(updated);
  });

  app.post<{ Params: { planId: string }; Body: { force?: boolean } }>('/api/plans/:planId/trigger', async (request, reply) => {
    const { userId } = request.user as { userId: string };
    const { planId } = request.params;

    const plan = db.select().from(schema.backupPlans)
      .where(and(eq(schema.backupPlans.id, planId), eq(schema.backupPlans.userId, userId)))
      .get();
    if (!plan) return reply.status(404).send({ error: 'Plan not found' });

    const force = request.body?.force ?? false;
    const runId = await executePlanBackup(planId, { triggerType: 'manual', force });
    const run = db.select().from(schema.backupPlanRuns).where(eq(schema.backupPlanRuns.id, runId)).get()!;

    reply.status(202);
    return { runId, taskId: run.taskId, status: 'queued' };
  });

  app.get<{ Params: { planId: string } }>('/api/plans/:planId/runs', async (request, reply) => {
    const { userId } = request.user as { userId: string };
    const { planId } = request.params;

    const plan = db.select().from(schema.backupPlans)
      .where(and(eq(schema.backupPlans.id, planId), eq(schema.backupPlans.userId, userId)))
      .get();
    if (!plan) return reply.status(404).send({ error: 'Plan not found' });

    const rows = db.select().from(schema.backupPlanRuns)
      .where(eq(schema.backupPlanRuns.planId, planId))
      .orderBy(desc(schema.backupPlanRuns.createdAt))
      .limit(50)
      .all();

    return rows.map(toRunResponse);
  });
}

function toPlanResponse(row: typeof schema.backupPlans.$inferSelect): BackupPlan {
  return {
    id: row.id,
    repoId: row.repoId,
    userId: row.userId,
    name: row.name,
    enabled: row.enabled,
    cronExpression: row.cronExpression,
    paths: JSON.parse(row.paths),
    excludes: row.excludes ? JSON.parse(row.excludes) : [],
    tags: row.tags ? JSON.parse(row.tags) : [],
    retentionPolicy: row.retentionPolicy ? JSON.parse(row.retentionPolicy) : null,
    maxFileCount: row.maxFileCount,
    maxBytes: row.maxBytes,
    oneFileSystem: row.oneFileSystem,
    excludeLargerThan: row.excludeLargerThan,
    allowedBasePaths: row.allowedBasePaths ? JSON.parse(row.allowedBasePaths) : null,
    preHook: row.preHook,
    postHook: row.postHook,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    lastRunStatus: row.lastRunStatus,
    nextRunAt: row.nextRunAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toRunResponse(row: typeof schema.backupPlanRuns.$inferSelect): BackupPlanRun {
  return {
    id: row.id,
    planId: row.planId,
    taskId: row.taskId,
    triggerType: row.triggerType as BackupPlanRun['triggerType'],
    status: row.status,
    snapshotId: row.snapshotId,
    filesNew: row.filesNew,
    filesChanged: row.filesChanged,
    filesUnmodified: row.filesUnmodified,
    bytesAdded: row.bytesAdded,
    bytesProcessed: row.bytesProcessed,
    durationMs: row.durationMs,
    errorMessage: row.errorMessage,
    retentionApplied: row.retentionApplied,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
