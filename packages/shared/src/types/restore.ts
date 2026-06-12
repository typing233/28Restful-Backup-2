export type ConflictStrategy = 'overwrite' | 'rename' | 'skip';

export interface SnapshotInfo {
  id: string;
  time: string;
  hostname: string;
  tags: string[];
  paths: string[];
  shortId: string;
}

export interface SnapshotEntry {
  name: string;
  type: 'file' | 'dir' | 'symlink';
  path: string;
  size?: number;
  mtime?: string;
  mode?: number;
}

export interface SnapshotDiffEntry {
  path: string;
  modifier: 'added' | 'removed' | 'modified';
  sizeOld?: number;
  sizeNew?: number;
}

export interface RestoreJobInput {
  snapshotId: string;
  sourcePaths: string[];
  targetPath: string;
  conflictStrategy: ConflictStrategy;
  includePatterns?: string[];
  excludePatterns?: string[];
  verifyAfter?: boolean;
}

export interface RestoreJob {
  id: string;
  repoId: string;
  userId: string;
  taskId: string | null;
  snapshotId: string;
  sourcePaths: string[];
  targetPath: string;
  conflictStrategy: ConflictStrategy;
  status: string;
  filesRestored: number | null;
  bytesRestored: number | null;
  durationMs: number | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}
