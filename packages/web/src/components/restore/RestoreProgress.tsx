import { useEffect, useState } from 'react';
import type { ServerMessage } from '@restful-backup/shared';

interface Props {
  jobId: string;
  taskId: string;
  wsSend: (msg: any) => void;
  wsSubscribe: (listener: (msg: ServerMessage) => void) => () => void;
  onComplete: () => void;
}

export function RestoreProgress({ jobId, taskId, wsSend, wsSubscribe, onComplete }: Props) {
  const [logs, setLogs] = useState<string[]>([]);
  const [percent, setPercent] = useState(0);
  const [status, setStatus] = useState<'running' | 'completed' | 'failed'>('running');
  const [error, setError] = useState('');

  useEffect(() => {
    wsSend({ type: 'subscribe', taskId });
    wsSend({ type: 'subscribe-restore', jobId });

    const unsub = wsSubscribe((msg: ServerMessage) => {
      if (msg.type === 'task:log' && 'taskId' in msg && msg.taskId === taskId) {
        setLogs((prev) => [...prev.slice(-200), msg.line]);
      }
      if (msg.type === 'task:progress' && 'taskId' in msg && msg.taskId === taskId) {
        setPercent(msg.percent);
      }
      if (msg.type === 'restore:completed' && 'jobId' in msg && (msg as any).jobId === jobId) {
        setStatus('completed');
        onComplete();
      }
      if (msg.type === 'restore:failed' && 'jobId' in msg && (msg as any).jobId === jobId) {
        setStatus('failed');
        setError((msg as any).error);
      }
      if (msg.type === 'task:completed' && 'taskId' in msg && msg.taskId === taskId) {
        setStatus('completed');
        onComplete();
      }
      if (msg.type === 'task:failed' && 'taskId' in msg && msg.taskId === taskId) {
        setStatus('failed');
        setError(msg.error);
      }
    });

    return () => {
      wsSend({ type: 'unsubscribe', taskId });
      wsSend({ type: 'unsubscribe-restore', jobId });
      unsub();
    };
  }, [jobId, taskId]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className={`text-sm font-medium ${
          status === 'running' ? 'text-blue-400' : status === 'completed' ? 'text-green-400' : 'text-red-400'
        }`}>
          {status === 'running' ? 'Restoring...' : status === 'completed' ? 'Restore Complete' : 'Restore Failed'}
        </span>
        {status === 'running' && <span className="text-gray-400 text-sm">{percent.toFixed(1)}%</span>}
      </div>

      {status === 'running' && (
        <div className="h-2 bg-gray-700 rounded overflow-hidden">
          <div className="h-full bg-blue-500 transition-all duration-500" style={{ width: `${Math.min(percent, 100)}%` }} />
        </div>
      )}

      {error && (
        <div className="bg-red-900/30 border border-red-800 text-red-300 p-3 rounded text-sm">{error}</div>
      )}

      <div className="bg-gray-900 rounded border border-gray-700 p-3 max-h-48 overflow-y-auto font-mono text-xs text-gray-300">
        {logs.length === 0 ? (
          <span className="text-gray-500">Waiting for output...</span>
        ) : (
          logs.map((line, i) => <div key={i}>{line}</div>)
        )}
      </div>
    </div>
  );
}
