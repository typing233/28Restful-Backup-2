export function RepoCard({ repo, onClick }: { repo: any; onClick: () => void }) {
  const statusColors: Record<string, string> = {
    ok: 'border-green-600',
    error: 'border-red-600',
    unknown: 'border-gray-600',
    initializing: 'border-yellow-600',
  };

  const backendIcons: Record<string, string> = {
    local: '💾',
    sftp: '🌐',
    s3: '☁️',
    rest: '🔗',
    b2: '🗄️',
  };

  return (
    <div
      onClick={onClick}
      className={`bg-gray-800 rounded-lg p-4 border-l-4 ${statusColors[repo.status] || 'border-gray-600'} cursor-pointer hover:bg-gray-750 transition-colors`}
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-white font-semibold truncate">{repo.name}</h3>
        <span className="text-lg">{backendIcons[repo.backendType] || '📦'}</span>
      </div>
      <p className="text-gray-400 text-sm truncate mb-3">{repo.repoUrl}</p>
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>{repo.snapshotCount != null ? `${repo.snapshotCount} snapshots` : 'Unknown'}</span>
        <span className={`px-2 py-0.5 rounded capitalize ${
          repo.status === 'ok' ? 'bg-green-900/50 text-green-300' :
          repo.status === 'error' ? 'bg-red-900/50 text-red-300' :
          'bg-gray-700 text-gray-400'
        }`}>{repo.status}</span>
      </div>
    </div>
  );
}
