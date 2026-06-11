import type { FastifyInstance } from 'fastify';
import { execSync } from 'node:child_process';
import { config } from '../config.js';

export function healthRoutes(app: FastifyInstance): void {
  app.get('/api/health', async () => {
    let resticVersion = 'not found';
    try {
      resticVersion = execSync(`${config.resticBinary} version`, { encoding: 'utf8' }).trim();
    } catch { /* restic not installed */ }

    return {
      status: 'ok',
      restic: resticVersion,
      timestamp: new Date().toISOString(),
    };
  });
}
