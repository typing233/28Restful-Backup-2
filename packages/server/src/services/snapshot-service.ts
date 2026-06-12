import { eq } from 'drizzle-orm';
import { db, schema } from '../db/connection.js';
import { config } from '../config.js';
import { decrypt } from '../crypto/credentials.js';
import { buildLsCommand, buildDiffCommand } from '../restic/commands.js';
import { executeRestic } from '../restic/executor.js';
import { buildResticEnv } from '../restic/env-builder.js';
import type { RepoCredentials, SnapshotEntry, SnapshotDiffEntry } from '@restful-backup/shared';

const lsCache = new Map<string, { entries: SnapshotEntry[]; ts: number }>();
const CACHE_TTL = 300_000; // 5 minutes

export async function browseSnapshot(repoId: string, snapshotId: string, path?: string): Promise<SnapshotEntry[]> {
  const cacheKey = `${repoId}:${snapshotId}:${path || '/'}`;
  const cached = lsCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.entries;
  }

  const { env, cleanup } = getRepoEnv(repoId);
  const command = buildLsCommand({ snapshotId, path });

  try {
    const result = await executeRestic(
      command,
      { env, cleanup },
      { onStdout: () => {}, onStderr: () => {} },
      new AbortController().signal,
    );

    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || `restic ls failed with code ${result.exitCode}`);
    }

    const entries: SnapshotEntry[] = [];
    for (const line of result.stdout.split('\n')) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.struct_type === 'node') {
          entries.push({
            name: obj.name,
            type: obj.type === 'dir' ? 'dir' : obj.type === 'symlink' ? 'symlink' : 'file',
            path: obj.path,
            size: obj.size,
            mtime: obj.mtime,
            mode: obj.mode,
          });
        }
      } catch { /* skip non-JSON lines */ }
    }

    // Filter to direct children of the requested path
    const basePath = (path || '/').replace(/\/$/, '');
    const filtered = entries.filter((e) => {
      const parentDir = e.path.substring(0, e.path.lastIndexOf('/')) || '/';
      return parentDir === basePath || (basePath === '/' && e.path.split('/').filter(Boolean).length === 1);
    });

    lsCache.set(cacheKey, { entries: filtered, ts: Date.now() });
    return filtered;
  } catch (err) {
    cleanup();
    throw err;
  }
}

export async function diffSnapshots(repoId: string, snapshotA: string, snapshotB: string): Promise<SnapshotDiffEntry[]> {
  const { env, cleanup } = getRepoEnv(repoId);
  const command = buildDiffCommand({ snapshotA, snapshotB });

  try {
    const result = await executeRestic(
      command,
      { env, cleanup },
      { onStdout: () => {}, onStderr: () => {} },
      new AbortController().signal,
    );

    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || `restic diff failed with code ${result.exitCode}`);
    }

    const entries: SnapshotDiffEntry[] = [];
    for (const line of result.stdout.split('\n')) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.path) {
          entries.push({
            path: obj.path,
            modifier: mapModifier(obj.modifier),
            sizeOld: obj.size_from,
            sizeNew: obj.size_to,
          });
        }
      } catch {
        // Parse text format: "+    /path/to/file" or "M    /path/to/file"
        const match = line.match(/^([+\-M])\s+(.+)$/);
        if (match) {
          entries.push({
            path: match[2],
            modifier: match[1] === '+' ? 'added' : match[1] === '-' ? 'removed' : 'modified',
          });
        }
      }
    }

    return entries;
  } catch (err) {
    cleanup();
    throw err;
  }
}

function mapModifier(mod: string): SnapshotDiffEntry['modifier'] {
  switch (mod) {
    case '+': return 'added';
    case '-': return 'removed';
    default: return 'modified';
  }
}

function getRepoEnv(repoId: string): { env: Record<string, string>; cleanup: () => void } {
  const repo = db.select().from(schema.repos).where(eq(schema.repos.id, repoId)).get();
  if (!repo) throw new Error('Repository not found');

  const credentials: RepoCredentials = JSON.parse(
    decrypt(repo.credentialsEncrypted, repo.credentialsIv, repo.credentialsTag, config.encryptionSecret)
  );

  return buildResticEnv(repo.repoUrl, credentials);
}
