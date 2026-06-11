import { EventEmitter } from 'node:events';
import { eq } from 'drizzle-orm';
import type { TaskOperation, RepoCredentials } from '@restful-backup/shared';
import { db, schema } from '../db/connection.js';
import { config } from '../config.js';
import { decrypt } from '../crypto/credentials.js';
import { buildCommand } from '../restic/commands.js';
import { executeRestic } from '../restic/executor.js';
import { getRepoMutex } from './repo-lock.js';
import type { ServerMessage } from '@restful-backup/shared';

export const taskEvents = new EventEmitter();
taskEvents.setMaxListeners(100);

const runningTasks = new Map<string, AbortController>();

export async function enqueueTask(
  taskId: string,
  repoId: string,
  userId: string,
  operation: TaskOperation,
): Promise<void> {
  taskEvents.emit('message', {
    type: 'task:queued',
    taskId,
    repoId,
    operation,
  } satisfies ServerMessage);

  processTask(taskId, repoId, userId, operation).catch((err) => {
    console.error(`Task ${taskId} failed unexpectedly:`, err);
  });
}

export function cancelTask(taskId: string): boolean {
  const controller = runningTasks.get(taskId);
  if (controller) {
    controller.abort();
    return true;
  }
  return false;
}

async function processTask(
  taskId: string,
  repoId: string,
  userId: string,
  operation: TaskOperation,
): Promise<void> {
  const mutex = getRepoMutex(repoId);

  await mutex.runExclusive(async () => {
    const repo = db.select().from(schema.repos).where(eq(schema.repos.id, repoId)).get();
    if (!repo) {
      db.update(schema.tasks)
        .set({ status: 'failed', errorMessage: 'Repository not found', completedAt: new Date() })
        .where(eq(schema.tasks.id, taskId))
        .run();
      return;
    }

    const credentials: RepoCredentials = JSON.parse(
      decrypt(repo.credentialsEncrypted, repo.credentialsIv, repo.credentialsTag, config.encryptionSecret)
    );

    const controller = new AbortController();
    runningTasks.set(taskId, controller);

    const startedAt = new Date();
    db.update(schema.tasks)
      .set({ status: 'running', startedAt })
      .where(eq(schema.tasks.id, taskId))
      .run();

    taskEvents.emit('message', {
      type: 'task:started',
      taskId,
      startedAt: startedAt.toISOString(),
    } satisfies ServerMessage);

    const command = buildCommand(operation);
    const logLines: string[] = [];

    const result = await executeRestic(
      command,
      repo.repoUrl,
      credentials,
      {
        onStdout: (line) => {
          logLines.push(line);
          taskEvents.emit('message', {
            type: 'task:log',
            taskId,
            stream: 'stdout',
            line,
            ts: new Date().toISOString(),
          } satisfies ServerMessage);
          parseProgress(taskId, line);
        },
        onStderr: (line) => {
          logLines.push(line);
          taskEvents.emit('message', {
            type: 'task:log',
            taskId,
            stream: 'stderr',
            line,
            ts: new Date().toISOString(),
          } satisfies ServerMessage);
          parseProgress(taskId, line);
        },
      },
      controller.signal,
    );

    runningTasks.delete(taskId);
    const completedAt = new Date();
    const fullLog = logLines.join('\n');

    let parsedResult: string | null = null;
    if (result.exitCode === 0 && command.parseJson && result.stdout.trim()) {
      try {
        JSON.parse(result.stdout.trim());
        parsedResult = result.stdout.trim();
      } catch { /* not valid JSON, ignore */ }
    }

    if (controller.signal.aborted) {
      db.update(schema.tasks)
        .set({ status: 'cancelled', log: fullLog, completedAt, durationMs: result.durationMs })
        .where(eq(schema.tasks.id, taskId))
        .run();
      taskEvents.emit('message', { type: 'task:cancelled', taskId } satisfies ServerMessage);
    } else if (result.killed) {
      db.update(schema.tasks)
        .set({
          status: 'timeout',
          exitCode: result.exitCode,
          log: fullLog,
          errorMessage: 'Operation timed out',
          completedAt,
          durationMs: result.durationMs,
        })
        .where(eq(schema.tasks.id, taskId))
        .run();
      taskEvents.emit('message', {
        type: 'task:failed',
        taskId,
        exitCode: result.exitCode,
        error: 'Operation timed out',
        durationMs: result.durationMs,
      } satisfies ServerMessage);
    } else if (result.exitCode === 0) {
      db.update(schema.tasks)
        .set({
          status: 'completed',
          exitCode: 0,
          log: fullLog,
          result: parsedResult,
          completedAt,
          durationMs: result.durationMs,
        })
        .where(eq(schema.tasks.id, taskId))
        .run();

      updateRepoStats(repoId, operation, parsedResult);

      taskEvents.emit('message', {
        type: 'task:completed',
        taskId,
        exitCode: 0,
        durationMs: result.durationMs,
        result: parsedResult ? JSON.parse(parsedResult) : undefined,
      } satisfies ServerMessage);
    } else {
      const errorMsg = result.stderr.trim().split('\n').pop() || `Exit code ${result.exitCode}`;
      db.update(schema.tasks)
        .set({
          status: 'failed',
          exitCode: result.exitCode,
          log: fullLog,
          errorMessage: errorMsg,
          completedAt,
          durationMs: result.durationMs,
        })
        .where(eq(schema.tasks.id, taskId))
        .run();

      db.update(schema.repos)
        .set({ status: 'error', errorMessage: errorMsg, updatedAt: new Date() })
        .where(eq(schema.repos.id, repoId))
        .run();

      taskEvents.emit('message', {
        type: 'task:failed',
        taskId,
        exitCode: result.exitCode,
        error: errorMsg,
        durationMs: result.durationMs,
      } satisfies ServerMessage);
    }
  });
}

function updateRepoStats(repoId: string, operation: TaskOperation, resultJson: string | null): void {
  const updates: Record<string, unknown> = {
    status: 'ok',
    lastCheckedAt: new Date(),
    errorMessage: null,
    updatedAt: new Date(),
  };

  if (operation === 'snapshots' && resultJson) {
    try {
      const snapshots = JSON.parse(resultJson);
      if (Array.isArray(snapshots)) {
        updates.snapshotCount = snapshots.length;
      }
    } catch { /* ignore parse error */ }
  }

  if (operation === 'stats' && resultJson) {
    try {
      const stats = JSON.parse(resultJson);
      if (stats.total_size != null) {
        updates.totalSize = stats.total_size;
      }
    } catch { /* ignore */ }
  }

  db.update(schema.repos).set(updates).where(eq(schema.repos.id, repoId)).run();

  taskEvents.emit('message', {
    type: 'repo:updated',
    repoId,
    status: 'ok',
    ...(updates.snapshotCount != null ? { snapshotCount: updates.snapshotCount as number } : {}),
    ...(updates.totalSize != null ? { totalSize: updates.totalSize as number } : {}),
  } satisfies ServerMessage);
}

function parseProgress(taskId: string, line: string): void {
  const match = line.match(/\[[\d:]+\]\s+([\d.]+)%/);
  if (match) {
    taskEvents.emit('message', {
      type: 'task:progress',
      taskId,
      percent: parseFloat(match[1]),
      message: line.trim(),
    } satisfies ServerMessage);
  }
}
