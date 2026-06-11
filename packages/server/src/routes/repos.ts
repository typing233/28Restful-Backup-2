import type { FastifyInstance } from 'fastify';
import { eq, and, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db, schema } from '../db/connection.js';
import { config } from '../config.js';
import { encrypt } from '../crypto/credentials.js';
import type { CreateRepoInput, Repo } from '@restful-backup/shared';

export function repoRoutes(app: FastifyInstance): void {
  app.get('/api/repos', async (request) => {
    const { userId } = request.user as { userId: string };
    const rows = db.select().from(schema.repos).where(eq(schema.repos.userId, userId)).all();
    return rows.map(toRepoResponse);
  });

  app.get<{ Params: { id: string } }>('/api/repos/:id', async (request, reply) => {
    const { userId } = request.user as { userId: string };
    const { id } = request.params;

    const repo = db.select().from(schema.repos)
      .where(and(eq(schema.repos.id, id), eq(schema.repos.userId, userId)))
      .get();

    if (!repo) return reply.status(404).send({ error: 'Repository not found' });
    return toRepoResponse(repo);
  });

  app.post<{ Body: CreateRepoInput }>('/api/repos', async (request) => {
    const { userId } = request.user as { userId: string };
    const { name, backendType, repoUrl, credentials } = request.body;

    const { ciphertext, iv, tag } = encrypt(JSON.stringify(credentials), config.encryptionSecret);
    const id = nanoid();
    const now = new Date();

    db.insert(schema.repos).values({
      id,
      userId,
      name,
      backendType,
      repoUrl,
      credentialsEncrypted: ciphertext,
      credentialsIv: iv,
      credentialsTag: tag,
      status: 'unknown',
      createdAt: now,
      updatedAt: now,
    }).run();

    const repo = db.select().from(schema.repos).where(eq(schema.repos.id, id)).get()!;
    return toRepoResponse(repo);
  });

  app.put<{ Params: { id: string }; Body: Partial<CreateRepoInput> }>('/api/repos/:id', async (request, reply) => {
    const { userId } = request.user as { userId: string };
    const { id } = request.params;

    const existing = db.select().from(schema.repos)
      .where(and(eq(schema.repos.id, id), eq(schema.repos.userId, userId)))
      .get();

    if (!existing) return reply.status(404).send({ error: 'Repository not found' });

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    const { name, backendType, repoUrl, credentials } = request.body;

    if (name) updates.name = name;
    if (backendType) updates.backendType = backendType;
    if (repoUrl) updates.repoUrl = repoUrl;
    if (credentials) {
      const { ciphertext, iv, tag } = encrypt(JSON.stringify(credentials), config.encryptionSecret);
      updates.credentialsEncrypted = ciphertext;
      updates.credentialsIv = iv;
      updates.credentialsTag = tag;
    }

    db.update(schema.repos).set(updates).where(eq(schema.repos.id, id)).run();
    const repo = db.select().from(schema.repos).where(eq(schema.repos.id, id)).get()!;
    return toRepoResponse(repo);
  });

  app.delete<{ Params: { id: string } }>('/api/repos/:id', async (request, reply) => {
    const { userId } = request.user as { userId: string };
    const { id } = request.params;

    const existing = db.select().from(schema.repos)
      .where(and(eq(schema.repos.id, id), eq(schema.repos.userId, userId)))
      .get();

    if (!existing) return reply.status(404).send({ error: 'Repository not found' });

    db.delete(schema.tasks).where(eq(schema.tasks.repoId, id)).run();
    db.delete(schema.repos).where(eq(schema.repos.id, id)).run();
    return { success: true };
  });
}

function toRepoResponse(row: typeof schema.repos.$inferSelect): Repo {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    backendType: row.backendType as Repo['backendType'],
    repoUrl: row.repoUrl,
    status: row.status as Repo['status'],
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    snapshotCount: row.snapshotCount,
    totalSize: row.totalSize,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
