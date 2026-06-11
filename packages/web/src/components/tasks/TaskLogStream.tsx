import { useEffect, useRef, useState } from 'react';
import type { ServerMessage } from '@restful-backup/shared';

interface Props {
  taskId: string;
  wsSend: (msg: any) => void;
  wsSubscribe: (listener: (msg: ServerMessage) => void) => () => void;
  onComplete: () => void;
}

export function TaskLogStream({ taskId, wsSend, wsSubscribe, onComplete }: Props) {
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [status, setStatus] = useState<string>('queued');
  const [error, setError] = useState<string | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    wsSend({ type: 'subscribe', taskId });

    const unsub = wsSubscribe((msg: ServerMessage) => {
      if (!('taskId' in msg) || msg.taskId !== taskId) return;

      switch (msg.type) {
        case 'task:started':
          setStatus('running');
          break;
        case 'task:log':
          setLogs((prev) => [...prev, msg.line]);
          break;
        case 'task:progress':
          setProgress(msg.percent);
          break;
        case 'task:completed':
          setStatus('completed');
          setProgress(100);
          setTimeout(onComplete, 1500);
          break;
        case 'task:failed':
          setStatus('failed');
          setError(msg.error);
          setTimeout(onComplete, 3000);
          break;
        case 'task:cancelled':
          setStatus('cancelled');
          setTimeout(onComplete, 1000);
          break;
      }
    });

    return () => {
      wsSend({ type: 'unsubscribe', taskId });
      unsub();
    };
  }, [taskId]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between p-3 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <StatusIndicator status={status} />
          <span className="text-white text-sm font-medium">Task Output</span>
        </div>
        {progress !== null && (
          <span className="text-gray-400 text-sm">{progress.toFixed(1)}%</span>
        )}
      </div>

      {progress !== null && (
        <div className="h-1 bg-gray-800">
          <div
            className={`h-full transition-all duration-300 ${status === 'failed' ? 'bg-red-500' : 'bg-blue-500'}`}
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>
      )}

      <div className="p-3 max-h-80 overflow-y-auto font-mono text-xs leading-5">
        {logs.length === 0 && status === 'queued' && (
          <span className="text-gray-500">Waiting to start...</span>
        )}
        {logs.map((line, i) => (
          <div key={i} className="text-gray-300 whitespace-pre-wrap break-all">{line}</div>
        ))}
        {error && <div className="text-red-400 mt-2">Error: {error}</div>}
        <div ref={logEndRef} />
      </div>
    </div>
  );
}

function StatusIndicator({ status }: { status: string }) {
  if (status === 'running') {
    return <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />;
  }
  if (status === 'completed') {
    return <span className="w-2 h-2 rounded-full bg-green-500" />;
  }
  if (status === 'failed') {
    return <span className="w-2 h-2 rounded-full bg-red-500" />;
  }
  return <span className="w-2 h-2 rounded-full bg-gray-500" />;
}
