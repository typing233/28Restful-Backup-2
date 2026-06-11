import { Mutex } from 'async-mutex';

const locks = new Map<string, Mutex>();

export function getRepoMutex(repoId: string): Mutex {
  if (!locks.has(repoId)) {
    locks.set(repoId, new Mutex());
  }
  return locks.get(repoId)!;
}
