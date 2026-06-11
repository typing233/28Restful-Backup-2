import { useState, useEffect, useRef, useCallback } from 'react';
import type { ServerMessage } from '@restful-backup/shared';

interface TaskStreamState {
  logs: string[];
  progress: number | null;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout' | null;
  result: unknown | null;
  error: string | null;
}

export function useTaskStream(
  taskId: string | null,
  wsSend: (msg: any) => void,
  wsSubscribe: (listener: (msg: ServerMessage) => void) => () => void,
) {
  const [state, setState] = useState<TaskStreamState>({
    logs: [],
    progress: null,
    status: null,
    result: null,
    error: null,
  });

  useEffect(() => {
    if (!taskId) return;

    wsSend({ type: 'subscribe', taskId });

    const unsub = wsSubscribe((msg) => {
      if (!('taskId' in msg) || msg.taskId !== taskId) return;

      switch (msg.type) {
        case 'task:started':
          setState((s) => ({ ...s, status: 'running' }));
          break;
        case 'task:log':
          setState((s) => ({ ...s, logs: [...s.logs, `[${msg.stream}] ${msg.line}`] }));
          break;
        case 'task:progress':
          setState((s) => ({ ...s, progress: msg.percent }));
          break;
        case 'task:completed':
          setState((s) => ({ ...s, status: 'completed', result: msg.result ?? null, progress: 100 }));
          break;
        case 'task:failed':
          setState((s) => ({ ...s, status: 'failed', error: msg.error }));
          break;
        case 'task:cancelled':
          setState((s) => ({ ...s, status: 'cancelled' }));
          break;
      }
    });

    return () => {
      wsSend({ type: 'unsubscribe', taskId });
      unsub();
    };
  }, [taskId, wsSend, wsSubscribe]);

  const reset = useCallback(() => {
    setState({ logs: [], progress: null, status: null, result: null, error: null });
  }, []);

  return { ...state, reset };
}
