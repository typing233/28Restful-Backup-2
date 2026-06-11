import { useState } from 'react';
import { useAuthStore } from './store/index';
import { useWebSocket } from './hooks/useWebSocket';
import { LoginPage } from './pages/LoginPage';
import { RepoListPage } from './pages/RepoListPage';
import { RepoDetailPage } from './pages/RepoDetailPage';

export function App() {
  const token = useAuthStore((s) => s.token);
  const username = useAuthStore((s) => s.username);
  const logout = useAuthStore((s) => s.logout);
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const { connected, send, subscribe } = useWebSocket();

  if (!token) {
    return <LoginPage />;
  }

  return (
    <div className="min-h-screen bg-gray-900">
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-white font-bold text-lg">Restful Backup</h1>
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} title={connected ? 'Connected' : 'Disconnected'} />
        </div>
        <div className="flex items-center gap-4">
          <span className="text-gray-400 text-sm">{username}</span>
          <button onClick={logout} className="text-gray-400 hover:text-white text-sm">
            Logout
          </button>
        </div>
      </header>

      <main>
        {selectedRepoId ? (
          <RepoDetailPage
            repoId={selectedRepoId}
            wsSend={send}
            wsSubscribe={subscribe}
            onBack={() => setSelectedRepoId(null)}
          />
        ) : (
          <RepoListPage onSelectRepo={setSelectedRepoId} />
        )}
      </main>
    </div>
  );
}
