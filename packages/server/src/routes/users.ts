import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createHash } from 'node:crypto';
import { db, schema } from '../db/connection.js';

export function userRoutes(app: FastifyInstance): void {
  app.post<{ Body: { username: string; password: string } }>('/api/users/register', async (request, reply) => {
    const { username, password } = request.body;
    if (!username || !password) {
      return reply.status(400).send({ error: 'Username and password required' });
    }

    const existing = db.select().from(schema.users).where(eq(schema.users.username, username)).get();
    if (existing) {
      return reply.status(409).send({ error: 'Username already exists' });
    }

    const id = nanoid();
    const passwordHash = createHash('sha256').update(password).digest('hex');

    db.insert(schema.users).values({
      id,
      username,
      passwordHash,
      createdAt: new Date(),
    }).run();

    const token = app.jwt.sign({ userId: id, username });
    return { token, userId: id, username };
  });

  app.post<{ Body: { username: string; password: string } }>('/api/users/login', async (request, reply) => {
    const { username, password } = request.body;
    const passwordHash = createHash('sha256').update(password).digest('hex');

    const user = db.select().from(schema.users).where(eq(schema.users.username, username)).get();
    if (!user || user.passwordHash !== passwordHash) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const token = app.jwt.sign({ userId: user.id, username: user.username });
    return { token, userId: user.id, username: user.username };
  });

  app.get('/api/users/me', { preHandler: [app.authenticate] }, async (request) => {
    const { userId, username } = request.user as { userId: string; username: string };
    return { userId, username };
  });
}
