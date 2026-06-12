export interface RetentionPolicy {
  keepLast?: number;
  keepDaily?: number;
  keepWeekly?: number;
  keepMonthly?: number;
  keepYearly?: number;
  keepWithinDuration?: string;
}

export type PlanRunTrigger = 'scheduled' | 'manual';

export interface BackupPlan {
  id: string;
  repoId: string;
  userId: string;
  name: string;
  enabled: boolean;
  cronExpression: string;
  paths: string[];
  excludes: string[];
  tags: string[];
  retentionPolicy: RetentionPolicy | null;
  maxFileCount: number | null;
  maxBytes: number | null;
  oneFileSystem: boolean;
  excludeLargerThan: string | null;
  preHook: string | null;
  postHook: string | null;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBackupPlanInput {
  repoId: string;
  name: string;
  cronExpression: string;
  paths: string[];
  excludes?: string[];
  tags?: string[];
  retentionPolicy?: RetentionPolicy;
  maxFileCount?: number;
  maxBytes?: number;
  oneFileSystem?: boolean;
  excludeLargerThan?: string;
  preHook?: string;
  postHook?: string;
}

export interface UpdateBackupPlanInput {
  name?: string;
  cronExpression?: string;
  paths?: string[];
  excludes?: string[];
  tags?: string[];
  retentionPolicy?: RetentionPolicy | null;
  maxFileCount?: number | null;
  maxBytes?: number | null;
  oneFileSystem?: boolean;
  excludeLargerThan?: string | null;
  enabled?: boolean;
  preHook?: string | null;
  postHook?: string | null;
}

export interface BackupPlanRun {
  id: string;
  planId: string;
  taskId: string | null;
  triggerType: PlanRunTrigger;
  status: string;
  snapshotId: string | null;
  filesNew: number | null;
  filesChanged: number | null;
  filesUnmodified: number | null;
  bytesAdded: number | null;
  bytesProcessed: number | null;
  durationMs: number | null;
  errorMessage: string | null;
  retentionApplied: boolean;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}
