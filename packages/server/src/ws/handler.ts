import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import { eq, and } from 'drizzle-orm';
import type { ClientMessage, ServerMessage } from '@restful-backup/shared';
import { db, schema } from '../db/connection.js';
import { taskEvents } from '../queue/task-queue.js';

interface ClientState {
  ws: WebSocket;
  userId: string;
  taskSubs: Set<string>;
  repoSubs: Set<string>;
  planSubs: Set<string>;
  restoreSubs: Set<string>;
}

const clients = new Set<ClientState>();

export function registerWebSocket(app: FastifyInstance): void {
  app.get('/ws', { websocket: true }, (socket, request) => {
    const token = new URL(request.url || '/', 'http://localhost').searchParams.get('token');
    if (!token) {
      socket.send(JSON.stringify({ type: 'error', message: 'Authentication required: pass ?token=JWT' }));
      socket.close(4001, 'Unauthorized');
      return;
    }

    let userId: string;
    try {
      const decoded = app.jwt.verify<{ userId: string }>(token);
      userId = decoded.userId;
    } catch {
      socket.send(JSON.stringify({ type: 'error', message: 'Invalid or expired token' }));
      socket.close(4001, 'Unauthorized');
      return;
    }

    const state: ClientState = {
      ws: socket,
      userId,
      taskSubs: new Set(),
      repoSubs: new Set(),
      planSubs: new Set(),
      restoreSubs: new Set(),
    };
    clients.add(state);

    socket.on('message', (raw) => {
      try {
        const msg: ClientMessage = JSON.parse(raw.toString());
        switch (msg.type) {
          case 'subscribe':
            if (verifyTaskOwnership(msg.taskId, userId)) {
              state.taskSubs.add(msg.taskId);
            } else {
              socket.send(JSON.stringify({ type: 'error', message: `Forbidden: task ${msg.taskId} not accessible` }));
            }
            break;
          case 'unsubscribe':
            state.taskSubs.delete(msg.taskId);
            break;
          case 'subscribe-repo':
            if (verifyRepoOwnership(msg.repoId, userId)) {
              state.repoSubs.add(msg.repoId);
            } else {
              socket.send(JSON.stringify({ type: 'error', message: `Forbidden: repo ${msg.repoId} not accessible` }));
            }
            break;
          case 'unsubscribe-repo':
            state.repoSubs.delete(msg.repoId);
            break;
          case 'subscribe-plan':
            if (verifyPlanOwnership(msg.planId, userId)) {
              state.planSubs.add(msg.planId);
            } else {
              socket.send(JSON.stringify({ type: 'error', message: `Forbidden: plan ${msg.planId} not accessible` }));
            }
            break;
          case 'unsubscribe-plan':
            state.planSubs.delete(msg.planId);
            break;
          case 'subscribe-restore':
            if (verifyRestoreOwnership(msg.jobId, userId)) {
              state.restoreSubs.add(msg.jobId);
            } else {
              socket.send(JSON.stringify({ type: 'error', message: `Forbidden: restore job ${msg.jobId} not accessible` }));
            }
            break;
          case 'unsubscribe-restore':
            state.restoreSubs.delete(msg.jobId);
            break;
        }
      } catch { /* ignore malformed messages */ }
    });

    socket.on('close', () => {
      clients.delete(state);
    });
  });

  taskEvents.on('message', (msg: ServerMessage) => {
    const payload = JSON.stringify(msg);
    for (const client of clients) {
      if (shouldReceive(client, msg)) {
        try {
          client.ws.send(payload);
        } catch { /* client disconnected */ }
      }
    }
  });
}

function verifyRepoOwnership(repoId: string, userId: string): boolean {
  const repo = db.select({ id: schema.repos.id }).from(schema.repos)
    .where(and(eq(schema.repos.id, repoId), eq(schema.repos.userId, userId)))
    .get();
  return !!repo;
}

function verifyTaskOwnership(taskId: string, userId: string): boolean {
  const task = db.select({ id: schema.tasks.id }).from(schema.tasks)
    .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, userId)))
    .get();
  return !!task;
}

function verifyPlanOwnership(planId: string, userId: string): boolean {
  const plan = db.select({ id: schema.backupPlans.id }).from(schema.backupPlans)
    .where(and(eq(schema.backupPlans.id, planId), eq(schema.backupPlans.userId, userId)))
    .get();
  return !!plan;
}

function verifyRestoreOwnership(jobId: string, userId: string): boolean {
  const job = db.select({ id: schema.restoreJobs.id }).from(schema.restoreJobs)
    .where(and(eq(schema.restoreJobs.id, jobId), eq(schema.restoreJobs.userId, userId)))
    .get();
  return !!job;
}

function shouldReceive(client: ClientState, msg: ServerMessage): boolean {
  if ('taskId' in msg && client.taskSubs.has(msg.taskId)) return true;
  if ('repoId' in msg && client.repoSubs.has(msg.repoId)) return true;
  if ('planId' in msg && client.planSubs.has((msg as any).planId)) return true;
  if ('jobId' in msg && client.restoreSubs.has((msg as any).jobId)) return true;
  return false;
}
