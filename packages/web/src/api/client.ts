import { useAuthStore } from '../store/index.js';

const BASE_URL = '';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = useAuthStore.getState().token;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers as Record<string, string>) },
  });

  if (res.status === 401) {
    useAuthStore.getState().logout();
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  return res.json();
}

export const api = {
  register: (username: string, password: string) =>
    request<{ token: string; userId: string; username: string }>('/api/users/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  login: (username: string, password: string) =>
    request<{ token: string; userId: string; username: string }>('/api/users/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  getRepos: () =>
    request<any[]>('/api/repos'),

  getRepo: (id: string) =>
    request<any>(`/api/repos/${id}`),

  createRepo: (data: any) =>
    request<any>('/api/repos', { method: 'POST', body: JSON.stringify(data) }),

  deleteRepo: (id: string) =>
    request<any>(`/api/repos/${id}`, { method: 'DELETE' }),

  triggerTask: (repoId: string, operation: string) =>
    request<{ taskId: string; status: string }>(`/api/repos/${repoId}/tasks`, {
      method: 'POST',
      body: JSON.stringify({ operation }),
    }),

  getRepoTasks: (repoId: string) =>
    request<any[]>(`/api/repos/${repoId}/tasks`),

  getTask: (taskId: string) =>
    request<any>(`/api/tasks/${taskId}`),

  cancelTask: (taskId: string) =>
    request<any>(`/api/tasks/${taskId}/cancel`, { method: 'POST' }),
};
