import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { TaskLogStream } from '../components/tasks/TaskLogStream';
import { TaskStatusBadge } from '../components/tasks/TaskStatusBadge';
import type { ServerMessage } from '@restful-backup/shared';

interface Props {
  repoId: string;
  wsSend: (msg: any) => void;
  wsSubscribe: (listener: (msg: ServerMessage) => void) => () => void;
  onBack: () => void;
}

export function RepoDetailPage({ repoId, wsSend, wsSubscribe, onBack }: Props) {
  const [repo, setRepo] = useState<any>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [taskProgress, setTaskProgress] = useState<Record<string, number>>({});

  const fetchRepo = async () => {
    try {
      const data = await api.getRepo(repoId);
      setRepo(data);
    } catch { /* ignore */ }
  };

  const fetchTasks = async () => {
    try {
      const data = await api.getRepoTasks(repoId);
      setTasks(data);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    fetchRepo();
    fetchTasks();
  }, [repoId]);

  // Subscribe to repo-level events for progress updates on all tasks
  useEffect(() => {
    wsSend({ type: 'subscribe-repo', repoId });

    const unsub = wsSubscribe((msg: ServerMessage) => {
      if (msg.type === 'task:progress' && 'taskId' in msg) {
        setTaskProgress((prev) => ({ ...prev, [msg.taskId]: msg.percent }));
      }
      if (msg.type === 'task:completed' || msg.type === 'task:failed' || msg.type === 'task:cancelled') {
        fetchTasks();
        fetchRepo();
      }
      if (msg.type === 'task:started' && 'taskId' in msg) {
        fetchTasks();
      }
    });

    return () => {
      wsSend({ type: 'unsubscribe-repo', repoId });
      unsub();
    };
  }, [repoId, wsSend, wsSubscribe]);

  async function handleTrigger(operation: string) {
    setTriggering(true);
    try {
      const { taskId } = await api.triggerTask(repoId, operation);
      setActiveTaskId(taskId);
      setTimeout(fetchTasks, 500);
    } catch { /* ignore */ }
    setTriggering(false);
  }

  async function handleCancel() {
    if (activeTaskId) {
      await api.cancelTask(activeTaskId);
    }
  }

  async function handleRetry(taskId: string) {
    try {
      const result = await api.retryTask(taskId);
      setActiveTaskId(result.taskId);
      setTimeout(fetchTasks, 500);
    } catch { /* ignore */ }
  }

  function handleTaskComplete() {
    fetchRepo();
    fetchTasks();
    setActiveTaskId(null);
  }

  if (!repo) return <div className="p-8 text-gray-400">Loading...</div>;

  const backendBadgeColor: Record<string, string> = {
    local: 'bg-green-800 text-green-200',
    sftp: 'bg-purple-800 text-purple-200',
    s3: 'bg-orange-800 text-orange-200',
    rest: 'bg-blue-800 text-blue-200',
    b2: 'bg-red-800 text-red-200',
  };

  return (
    <div className="p-6">
      <button onClick={onBack} className="text-gray-400 hover:text-white mb-4 inline-block">
        &larr; Back to Repositories
      </button>

      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-bold text-white">{repo.name}</h1>
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${backendBadgeColor[repo.backendType] || 'bg-gray-700 text-gray-300'}`}>
          {repo.backendType.toUpperCase()}
        </span>
        <StatusDot status={repo.status} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <StatCard label="Snapshots" value={repo.snapshotCount ?? '—'} />
        <StatCard label="Total Size" value={repo.totalSize ? formatBytes(repo.totalSize) : '—'} />
        <StatCard label="Last Checked" value={repo.lastCheckedAt ? new Date(repo.lastCheckedAt).toLocaleString() : 'Never'} />
      </div>

      {repo.errorMessage && (
        <div className="bg-red-900/30 border border-red-800 text-red-300 p-3 rounded mb-4 text-sm">
          {repo.errorMessage}
        </div>
      )}

      <div className="flex gap-2 mb-6 flex-wrap">
        {(['init', 'check', 'snapshots', 'stats', 'unlock'] as const).map((op) => (
          <button
            key={op}
            onClick={() => handleTrigger(op)}
            disabled={triggering || !!activeTaskId}
            className="bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white px-3 py-1.5 rounded text-sm font-medium capitalize"
          >
            {op}
          </button>
        ))}
        {activeTaskId && (
          <button
            onClick={handleCancel}
            className="bg-red-700 hover:bg-red-600 text-white px-3 py-1.5 rounded text-sm font-medium"
          >
            Cancel
          </button>
        )}
      </div>

      {activeTaskId && (
        <TaskLogStream
          taskId={activeTaskId}
          wsSend={wsSend}
          wsSubscribe={wsSubscribe}
          onComplete={handleTaskComplete}
        />
      )}

      <div className="mt-6">
        <h2 className="text-lg font-semibold text-white mb-3">Recent Tasks</h2>
        {tasks.length === 0 ? (
          <p className="text-gray-500 text-sm">No tasks yet.</p>
        ) : (
          <div className="space-y-2">
            {tasks.slice(0, 10).map((task) => {
              const progress = taskProgress[task.id];
              const isRunning = task.status === 'running';

              return (
                <div key={task.id} className="bg-gray-800 rounded p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <TaskStatusBadge status={task.status} />
                      <span className="text-white font-medium capitalize">{task.operation}</span>
                      {isRunning && progress != null && (
                        <span className="text-blue-300 text-xs font-mono">{progress.toFixed(1)}%</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-sm text-gray-400">
                      {task.durationMs != null && <span>{(task.durationMs / 1000).toFixed(1)}s</span>}
                      <span>{new Date(task.createdAt).toLocaleString()}</span>
                      {(task.status === 'failed' || task.status === 'timeout' || task.status === 'cancelled') && (
                        <button
                          onClick={() => handleRetry(task.id)}
                          disabled={!!activeTaskId}
                          className="text-blue-400 hover:text-blue-300 disabled:opacity-50 font-medium"
                        >
                          Retry
                        </button>
                      )}
                    </div>
                  </div>
                  {isRunning && (
                    <div className="mt-2">
                      <div className="h-1.5 bg-gray-700 rounded overflow-hidden">
                        <div
                          className="h-full bg-blue-500 transition-all duration-500"
                          style={{ width: `${Math.min(progress ?? 0, 100)}%` }}
                        />
                      </div>
                    </div>
                  )}
                  {task.errorMessage && (
                    <div className="mt-2 text-red-400 text-xs bg-red-950/40 rounded px-2 py-1 font-mono">
                      {task.errorMessage}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <div className="text-gray-400 text-sm">{label}</div>
      <div className="text-white text-xl font-semibold mt-1">{value}</div>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    ok: 'bg-green-500',
    error: 'bg-red-500',
    unknown: 'bg-gray-500',
    initializing: 'bg-yellow-500',
  };
  return <span className={`w-3 h-3 rounded-full ${colors[status] || 'bg-gray-500'}`} />;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}
