import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { RepoCard } from '../components/repos/RepoCard';
import { RepoForm } from '../components/repos/RepoForm';

export function RepoListPage({ onSelectRepo }: { onSelectRepo: (id: string) => void }) {
  const [repos, setRepos] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchRepos = async () => {
    try {
      const data = await api.getRepos();
      setRepos(data);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchRepos(); }, []);

  async function handleCreated() {
    setShowForm(false);
    await fetchRepos();
  }

  if (loading) {
    return <div className="p-8 text-gray-400">Loading repositories...</div>;
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">Repositories</h1>
        <button
          onClick={() => setShowForm(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded font-medium"
        >
          + Add Repository
        </button>
      </div>

      {repos.length === 0 ? (
        <div className="text-center py-20 text-gray-500">
          <p className="text-lg">No repositories configured yet.</p>
          <p className="text-sm mt-2">Add a Restic repository to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {repos.map((repo) => (
            <RepoCard key={repo.id} repo={repo} onClick={() => onSelectRepo(repo.id)} />
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-white mb-4">Add Repository</h2>
            <RepoForm onCreated={handleCreated} onCancel={() => setShowForm(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
