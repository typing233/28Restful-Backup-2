import { useState, useEffect } from 'react';
import { api } from '../../api/client';

interface Props {
  repoId: string;
  onSelect: (snapshotId: string) => void;
}

export function SnapshotPicker({ repoId, onSelect }: Props) {
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    async function fetch() {
      try {
        const tasks = await api.getRepoTasks(repoId);
        const snapshotTask = tasks.find((t: any) => t.operation === 'snapshots' && t.status === 'completed' && t.result);
        if (snapshotTask?.result) {
          setSnapshots(Array.isArray(snapshotTask.result) ? snapshotTask.result : []);
        }
      } catch { /* ignore */ }
      setLoading(false);
    }
    fetch();
  }, [repoId]);

  if (loading) return <div className="text-gray-400">Loading snapshots...</div>;
  if (snapshots.length === 0) {
    return (
      <div className="text-gray-400 text-sm">
        No snapshots found. Run a "snapshots" task on the repository first, or create a backup plan.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-400">Select a snapshot to restore from:</p>
      <div className="space-y-2 max-h-80 overflow-y-auto">
        {snapshots.map((snap: any) => (
          <button
            key={snap.short_id || snap.id}
            onClick={() => { setSelected(snap.short_id || snap.id); onSelect(snap.short_id || snap.id); }}
            className={`w-full text-left p-3 rounded border ${
              selected === (snap.short_id || snap.id)
                ? 'border-blue-500 bg-blue-900/30'
                : 'border-gray-700 bg-gray-800 hover:border-gray-600'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-white font-mono text-sm">{snap.short_id || snap.id?.substring(0, 8)}</span>
              <span className="text-gray-400 text-xs">{new Date(snap.time).toLocaleString()}</span>
            </div>
            <div className="mt-1 text-xs text-gray-400">
              {snap.hostname && <span className="mr-3">Host: {snap.hostname}</span>}
              {snap.paths?.length > 0 && <span>Paths: {snap.paths.join(', ')}</span>}
              {snap.tags?.length > 0 && <span className="ml-3">Tags: {snap.tags.join(', ')}</span>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
