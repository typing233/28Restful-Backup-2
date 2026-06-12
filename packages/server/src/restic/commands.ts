import type { TaskOperation } from '@restful-backup/shared';

export interface ResticCommand {
  args: string[];
  timeoutMs: number;
  parseJson: boolean;
}

const TIMEOUTS: Record<TaskOperation, number> = {
  init: 60_000,
  check: 600_000,
  snapshots: 60_000,
  stats: 120_000,
  unlock: 30_000,
  backup: 3_600_000,
  forget: 1_800_000,
  restore: 7_200_000,
  ls: 120_000,
  diff: 300_000,
};

export function buildCommand(operation: TaskOperation): ResticCommand {
  switch (operation) {
    case 'init':
      return { args: ['init', '--json'], timeoutMs: TIMEOUTS.init, parseJson: true };
    case 'check':
      return { args: ['check', '--json'], timeoutMs: TIMEOUTS.check, parseJson: false };
    case 'snapshots':
      return { args: ['snapshots', '--json'], timeoutMs: TIMEOUTS.snapshots, parseJson: true };
    case 'stats':
      return { args: ['stats', '--json'], timeoutMs: TIMEOUTS.stats, parseJson: true };
    case 'unlock':
      return { args: ['unlock'], timeoutMs: TIMEOUTS.unlock, parseJson: false };
    default:
      return { args: [operation, '--json'], timeoutMs: 60_000, parseJson: false };
  }
}

export interface BackupCommandOptions {
  paths: string[];
  excludes?: string[];
  tags?: string[];
}

export function buildBackupCommand(opts: BackupCommandOptions): ResticCommand {
  const args = ['backup', '--json', ...opts.paths];
  for (const ex of opts.excludes ?? []) args.push('--exclude', ex);
  for (const tag of opts.tags ?? []) args.push('--tag', tag);
  return { args, timeoutMs: TIMEOUTS.backup, parseJson: true };
}

export interface ForgetCommandOptions {
  keepLast?: number;
  keepDaily?: number;
  keepWeekly?: number;
  keepMonthly?: number;
  keepYearly?: number;
  keepWithinDuration?: string;
  tags?: string[];
  prune?: boolean;
}

export function buildForgetCommand(opts: ForgetCommandOptions): ResticCommand {
  const args = ['forget', '--json'];
  if (opts.keepLast) args.push('--keep-last', String(opts.keepLast));
  if (opts.keepDaily) args.push('--keep-daily', String(opts.keepDaily));
  if (opts.keepWeekly) args.push('--keep-weekly', String(opts.keepWeekly));
  if (opts.keepMonthly) args.push('--keep-monthly', String(opts.keepMonthly));
  if (opts.keepYearly) args.push('--keep-yearly', String(opts.keepYearly));
  if (opts.keepWithinDuration) args.push('--keep-within', opts.keepWithinDuration);
  for (const tag of opts.tags ?? []) args.push('--tag', tag);
  if (opts.prune) args.push('--prune');
  return { args, timeoutMs: TIMEOUTS.forget, parseJson: true };
}

export interface RestoreCommandOptions {
  snapshotId: string;
  targetPath: string;
  includePaths?: string[];
  excludePaths?: string[];
}

export function buildRestoreCommand(opts: RestoreCommandOptions): ResticCommand {
  const args = ['restore', opts.snapshotId, '--target', opts.targetPath, '--json'];
  for (const inc of opts.includePaths ?? []) args.push('--include', inc);
  for (const exc of opts.excludePaths ?? []) args.push('--exclude', exc);
  return { args, timeoutMs: TIMEOUTS.restore, parseJson: false };
}

export interface LsCommandOptions {
  snapshotId: string;
  path?: string;
}

export function buildLsCommand(opts: LsCommandOptions): ResticCommand {
  const args = ['ls', '--json', opts.snapshotId];
  if (opts.path) args.push(opts.path);
  return { args, timeoutMs: TIMEOUTS.ls, parseJson: true };
}

export interface DiffCommandOptions {
  snapshotA: string;
  snapshotB: string;
}

export function buildDiffCommand(opts: DiffCommandOptions): ResticCommand {
  return { args: ['diff', '--json', opts.snapshotA, opts.snapshotB], timeoutMs: TIMEOUTS.diff, parseJson: true };
}
