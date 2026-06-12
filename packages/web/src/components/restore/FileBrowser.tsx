import { useState, useEffect } from 'react';
import { api } from '../../api/client';

interface Props {
  repoId: string;
  snapshotId: string;
  onSelect: (paths: string[]) => void;
}

interface Entry {
  name: string;
  type: 'file' | 'dir' | 'symlink';
  path: string;
  size?: number;
}

export function FileBrowser({ repoId, snapshotId, onSelect }: Props) {
  const [currentPath, setCurrentPath] = useState('/');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function loadDir(path: string) {
    setLoading(true);
    setError('');
    try {
      const data = await api.browseSnapshot(repoId, snapshotId, path);
      setEntries(data);
      setCurrentPath(path);
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  }

  useEffect(() => { loadDir('/'); }, [repoId, snapshotId]);

  useEffect(() => { onSelect(Array.from(selected)); }, [selected]);

  function toggleSelect(path: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function navigateUp() {
    const parent = currentPath.split('/').slice(0, -1).join('/') || '/';
    loadDir(parent);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-400">Path:</span>
        <span className="text-white font-mono text-sm">{currentPath}</span>
        {currentPath !== '/' && (
          <button onClick={navigateUp} className="text-blue-400 hover:text-blue-300 text-xs ml-2">
            Go Up
          </button>
        )}
      </div>

      {error && <div className="text-red-400 text-sm">{error}</div>}

      {loading ? (
        <div className="text-gray-400 text-sm">Loading...</div>
      ) : (
        <div className="border border-gray-700 rounded max-h-72 overflow-y-auto">
          {entries.length === 0 ? (
            <div className="p-4 text-gray-500 text-sm text-center">Empty directory</div>
          ) : (
            entries.map((entry) => (
              <div
                key={entry.path}
                className="flex items-center gap-3 px-3 py-2 border-b border-gray-700 last:border-0 hover:bg-gray-800"
              >
                <input
                  type="checkbox"
                  checked={selected.has(entry.path)}
                  onChange={() => toggleSelect(entry.path)}
                  className="rounded"
                />
                <span className="text-xs text-gray-500 w-4">
                  {entry.type === 'dir' ? 'D' : entry.type === 'symlink' ? 'L' : 'F'}
                </span>
                {entry.type === 'dir' ? (
                  <button
                    onClick={() => loadDir(entry.path)}
                    className="text-blue-400 hover:text-blue-300 text-sm font-mono truncate"
                  >
                    {entry.name}/
                  </button>
                ) : (
                  <span className="text-white text-sm font-mono truncate">{entry.name}</span>
                )}
                {entry.size != null && (
                  <span className="text-gray-500 text-xs ml-auto">{formatSize(entry.size)}</span>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {selected.size > 0 && (
        <div className="text-sm text-gray-400">
          {selected.size} item(s) selected
        </div>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
