import type { FastifyInstance } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { db, schema } from '../db/connection.js';
import { browseSnapshot, diffSnapshots } from '../services/snapshot-service.js';

export function snapshotRoutes(app: FastifyInstance): void {
  app.get<{ Params: { id: string; snapId: string }; Querystring: { path?: string } }>(
    '/api/repos/:id/snapshots/:snapId/ls',
    async (request, reply) => {
      const { userId } = request.user as { userId: string };
      const { id: repoId, snapId } = request.params;
      const { path } = request.query;

      const repo = db.select().from(schema.repos)
        .where(and(eq(schema.repos.id, repoId), eq(schema.repos.userId, userId)))
        .get();
      if (!repo) return reply.status(404).send({ error: 'Repository not found' });

      try {
        const entries = await browseSnapshot(repoId, snapId, path || '/');
        return entries;
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    },
  );

  app.get<{ Params: { id: string; snapId: string }; Querystring: { compareWith: string } }>(
    '/api/repos/:id/snapshots/:snapId/diff',
    async (request, reply) => {
      const { userId } = request.user as { userId: string };
      const { id: repoId, snapId } = request.params;
      const { compareWith } = request.query;

      if (!compareWith) {
        return reply.status(400).send({ error: 'compareWith query parameter is required' });
      }

      const repo = db.select().from(schema.repos)
        .where(and(eq(schema.repos.id, repoId), eq(schema.repos.userId, userId)))
        .get();
      if (!repo) return reply.status(404).send({ error: 'Repository not found' });

      try {
        const entries = await diffSnapshots(repoId, snapId, compareWith);
        return entries;
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    },
  );
}
