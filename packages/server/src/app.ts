import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import { config } from './config.js';
import { healthRoutes } from './routes/health.js';
import { userRoutes } from './routes/users.js';
import { repoRoutes } from './routes/repos.js';
import { taskRoutes } from './routes/tasks.js';
import { registerWebSocket } from './ws/handler.js';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: any, reply: any) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { userId: string; username: string };
    user: { userId: string; username: string };
  }
}

export async function buildApp() {
  const app = Fastify({
    logger: {
      transport: {
        target: 'pino-pretty',
        options: { colorize: true },
      },
    },
  });

  await app.register(cors, { origin: true });
  await app.register(jwt, { secret: config.jwtSecret });
  await app.register(websocket);

  app.decorate('authenticate', async (request: any, reply: any) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  healthRoutes(app);
  userRoutes(app);
  app.register(async (scoped) => {
    scoped.addHook('preHandler', app.authenticate);
    repoRoutes(scoped);
    taskRoutes(scoped);
  });
  registerWebSocket(app);

  return app;
}
