import { TaskStatusBadge } from '../tasks/TaskStatusBadge';

interface PlanRun {
  id: string;
  triggerType: string;
  status: string;
  snapshotId: string | null;
  filesNew: number | null;
  bytesAdded: number | null;
  durationMs: number | null;
  errorMessage: string | null;
  createdAt: string;
}

interface Props {
  runs: PlanRun[];
  onRetry?: (runId: string) => void;
}

export function PlanRunHistory({ runs, onRetry }: Props) {
  if (runs.length === 0) {
    return <p className="text-gray-500 text-sm">No run history yet.</p>;
  }

  return (
    <div className="space-y-2">
      {runs.map((run) => (
        <div key={run.id} className="bg-gray-800 rounded p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <TaskStatusBadge status={run.status} />
              <span className="text-gray-300 text-xs capitalize">{run.triggerType}</span>
              {run.snapshotId && (
                <span className="text-gray-400 text-xs font-mono">{run.snapshotId.substring(0, 8)}</span>
              )}
            </div>
            <div className="flex items-center gap-3 text-sm text-gray-400">
              {run.filesNew != null && <span>{run.filesNew} new</span>}
              {run.bytesAdded != null && <span>{formatBytes(run.bytesAdded)}</span>}
              {run.durationMs != null && <span>{(run.durationMs / 1000).toFixed(1)}s</span>}
              <span>{new Date(run.createdAt).toLocaleString()}</span>
            </div>
          </div>
          {run.errorMessage && (
            <div className="mt-2 text-red-400 text-xs bg-red-950/40 rounded px-2 py-1 font-mono">
              {run.errorMessage}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}
