export type TaskOperation = 'init' | 'check' | 'snapshots' | 'stats' | 'unlock' | 'backup' | 'forget' | 'restore' | 'ls' | 'diff';

export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout';

export interface Task {
  id: string;
  repoId: string;
  userId: string;
  operation: TaskOperation;
  status: TaskStatus;
  exitCode: number | null;
  errorMessage: string | null;
  log: string | null;
  result: unknown | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  createdAt: string;
}

export interface TriggerTaskInput {
  operation: TaskOperation;
}
