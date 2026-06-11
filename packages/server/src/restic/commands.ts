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
  }
}
