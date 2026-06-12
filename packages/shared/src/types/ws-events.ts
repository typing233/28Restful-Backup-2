export type ClientMessage =
  | { type: 'subscribe'; taskId: string }
  | { type: 'unsubscribe'; taskId: string }
  | { type: 'subscribe-repo'; repoId: string }
  | { type: 'unsubscribe-repo'; repoId: string }
  | { type: 'subscribe-plan'; planId: string }
  | { type: 'unsubscribe-plan'; planId: string }
  | { type: 'subscribe-restore'; jobId: string }
  | { type: 'unsubscribe-restore'; jobId: string };

export type ServerMessage =
  | { type: 'task:queued'; taskId: string; repoId: string; operation: string }
  | { type: 'task:started'; taskId: string; startedAt: string }
  | { type: 'task:log'; taskId: string; stream: 'stdout' | 'stderr'; line: string; ts: string }
  | { type: 'task:progress'; taskId: string; percent: number; message?: string }
  | { type: 'task:completed'; taskId: string; exitCode: number; durationMs: number; result?: unknown }
  | { type: 'task:failed'; taskId: string; exitCode: number; error: string; durationMs: number }
  | { type: 'task:cancelled'; taskId: string }
  | { type: 'repo:updated'; repoId: string; status: string; snapshotCount?: number; totalSize?: number }
  | { type: 'plan:run-started'; planId: string; runId: string; taskId: string }
  | { type: 'plan:run-completed'; planId: string; runId: string; snapshotId: string; filesNew: number; bytesAdded: number; durationMs: number }
  | { type: 'plan:run-failed'; planId: string; runId: string; error: string; durationMs: number }
  | { type: 'plan:retention-applied'; planId: string; runId: string; snapshotsRemoved: number }
  | { type: 'restore:started'; jobId: string; taskId: string }
  | { type: 'restore:progress'; jobId: string; percent: number; filesRestored: number; bytesRestored: number }
  | { type: 'restore:completed'; jobId: string; filesRestored: number; bytesRestored: number; durationMs: number }
  | { type: 'restore:failed'; jobId: string; error: string }
  | { type: 'error'; message: string };
