export type ClientMessage =
  | { type: 'subscribe'; taskId: string }
  | { type: 'unsubscribe'; taskId: string }
  | { type: 'subscribe-repo'; repoId: string }
  | { type: 'unsubscribe-repo'; repoId: string };

export type ServerMessage =
  | { type: 'task:queued'; taskId: string; repoId: string; operation: string }
  | { type: 'task:started'; taskId: string; startedAt: string }
  | { type: 'task:log'; taskId: string; stream: 'stdout' | 'stderr'; line: string; ts: string }
  | { type: 'task:progress'; taskId: string; percent: number; message?: string }
  | { type: 'task:completed'; taskId: string; exitCode: number; durationMs: number; result?: unknown }
  | { type: 'task:failed'; taskId: string; exitCode: number; error: string; durationMs: number }
  | { type: 'task:cancelled'; taskId: string }
  | { type: 'repo:updated'; repoId: string; status: string; snapshotCount?: number; totalSize?: number }
  | { type: 'error'; message: string };
