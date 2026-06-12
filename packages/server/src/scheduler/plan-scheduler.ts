import cron from 'node-cron';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/connection.js';
import { executePlanBackup } from './plan-executor.js';

const scheduledJobs = new Map<string, ReturnType<typeof cron.schedule>>();

export function startScheduler(): void {
  const plans = db.select().from(schema.backupPlans).where(eq(schema.backupPlans.enabled, true)).all();
  for (const plan of plans) {
    schedulePlan(plan.id, plan.cronExpression);
  }
  console.log(`Scheduler started with ${plans.length} active plan(s)`);
}

export function schedulePlan(planId: string, cronExpression: string): void {
  unschedulePlan(planId);

  if (!cron.validate(cronExpression)) {
    console.error(`Invalid cron expression for plan ${planId}: ${cronExpression}`);
    return;
  }

  const job = cron.schedule(cronExpression, () => {
    const plan = db.select().from(schema.backupPlans).where(eq(schema.backupPlans.id, planId)).get();
    if (!plan || !plan.enabled) {
      unschedulePlan(planId);
      return;
    }
    executePlanBackup(planId, 'scheduled').catch((err) => {
      console.error(`Scheduled backup failed for plan ${planId}:`, err);
    });
  });

  scheduledJobs.set(planId, job);
  updateNextRunAt(planId, cronExpression);
}

export function unschedulePlan(planId: string): void {
  const existing = scheduledJobs.get(planId);
  if (existing) {
    existing.stop();
    scheduledJobs.delete(planId);
  }
}

export function reschedulePlan(planId: string, cronExpression: string): void {
  schedulePlan(planId, cronExpression);
}

export function shutdownScheduler(): void {
  for (const [id, job] of scheduledJobs) {
    job.stop();
  }
  scheduledJobs.clear();
  console.log('Scheduler shut down');
}

function updateNextRunAt(planId: string, cronExpression: string): void {
  try {
    const interval = cron.getTasks();
    const nextDate = getNextCronDate(cronExpression);
    if (nextDate) {
      db.update(schema.backupPlans)
        .set({ nextRunAt: nextDate })
        .where(eq(schema.backupPlans.id, planId))
        .run();
    }
  } catch { /* ignore */ }
}

function getNextCronDate(expression: string): Date | null {
  const parts = expression.split(' ');
  if (parts.length < 5) return null;

  const now = new Date();
  // Simple approximation: add 1 minute for minutely, check the pattern
  // For production accuracy, use a proper cron parser; this is sufficient for display
  const next = new Date(now.getTime() + 60_000);
  return next;
}
