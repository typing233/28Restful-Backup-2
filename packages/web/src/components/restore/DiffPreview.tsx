import { useState, useEffect } from 'react';
import { api } from '../../api/client';

interface Props {
  repoId: string;
  snapshotId: string;
  compareWith?: string;
}

interface DiffEntry {
  path: string;
  modifier: 'added' | 'removed' | 'modified';
  sizeOld?: number;
  sizeNew?: number;
}

export function DiffPreview({ repoId, snapshotId, compareWith }: Props) {
  const [entries, setEntries] = useState<DiffEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!compareWith) return;
    setLoading(true);
    api.diffSnapshots(repoId, snapshotId, compareWith)
      .then(setEntries)
      .catch((err: any) => setError(err.message))
      .finally(() => setLoading(false));
  }, [repoId, snapshotId, compareWith]);

  if (!compareWith) {
    return <p className="text-gray-500 text-sm">Select two snapshots to compare differences.</p>;
  }
  if (loading) return <div className="text-gray-400 text-sm">Loading diff...</div>;
  if (error) return <div className="text-red-400 text-sm">{error}</div>;
  if (entries.length === 0) return <p className="text-gray-400 text-sm">No differences found.</p>;

  const colors = { added: 'text-green-400', removed: 'text-red-400', modified: 'text-yellow-400' };
  const icons = { added: '+', removed: '-', modified: 'M' };

  return (
    <div className="border border-gray-700 rounded max-h-72 overflow-y-auto">
      {entries.map((entry, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-1.5 border-b border-gray-700 last:border-0 font-mono text-sm">
          <span className={`w-4 ${colors[entry.modifier]}`}>{icons[entry.modifier]}</span>
          <span className={colors[entry.modifier]}>{entry.path}</span>
        </div>
      ))}
      <div className="px-3 py-2 text-xs text-gray-500 border-t border-gray-700">
        {entries.filter((e) => e.modifier === 'added').length} added,{' '}
        {entries.filter((e) => e.modifier === 'modified').length} modified,{' '}
        {entries.filter((e) => e.modifier === 'removed').length} removed
      </div>
    </div>
  );
}
