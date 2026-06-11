import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from '@restful-backup/shared';
import { taskEvents } from '../queue/task-queue.js';

interface ClientState {
  ws: WebSocket;
  taskSubs: Set<string>;
  repoSubs: Set<string>;
}

const clients = new Set<ClientState>();

export function registerWebSocket(app: FastifyInstance): void {
  app.get('/ws', { websocket: true }, (socket) => {
    const state: ClientState = {
      ws: socket,
      taskSubs: new Set(),
      repoSubs: new Set(),
    };
    clients.add(state);

    socket.on('message', (raw) => {
      try {
        const msg: ClientMessage = JSON.parse(raw.toString());
        switch (msg.type) {
          case 'subscribe':
            state.taskSubs.add(msg.taskId);
            break;
          case 'unsubscribe':
            state.taskSubs.delete(msg.taskId);
            break;
          case 'subscribe-repo':
            state.repoSubs.add(msg.repoId);
            break;
          case 'unsubscribe-repo':
            state.repoSubs.delete(msg.repoId);
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

function shouldReceive(client: ClientState, msg: ServerMessage): boolean {
  if ('taskId' in msg && client.taskSubs.has(msg.taskId)) return true;
  if ('repoId' in msg && client.repoSubs.has(msg.repoId)) return true;
  return false;
}
