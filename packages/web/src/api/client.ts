import { useAuthStore } from '../store/index.js';

const BASE_URL = '';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = useAuthStore.getState().token;
  const headers: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }

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

  retryTask: (taskId: string) =>
    request<{ taskId: string; status: string; retriedFrom: string }>(`/api/tasks/${taskId}/retry`, { method: 'POST' }),

  // Backup Plans
  getPlans: (repoId: string) =>
    request<any[]>(`/api/repos/${repoId}/plans`),

  createPlan: (repoId: string, data: any) =>
    request<any>(`/api/repos/${repoId}/plans`, { method: 'POST', body: JSON.stringify(data) }),

  getPlan: (planId: string) =>
    request<any>(`/api/plans/${planId}`),

  updatePlan: (planId: string, data: any) =>
    request<any>(`/api/plans/${planId}`, { method: 'PUT', body: JSON.stringify(data) }),

  deletePlan: (planId: string) =>
    request<any>(`/api/plans/${planId}`, { method: 'DELETE' }),

  pausePlan: (planId: string) =>
    request<any>(`/api/plans/${planId}/pause`, { method: 'POST' }),

  resumePlan: (planId: string) =>
    request<any>(`/api/plans/${planId}/resume`, { method: 'POST' }),

  triggerPlan: (planId: string) =>
    request<{ runId: string; taskId: string; status: string }>(`/api/plans/${planId}/trigger`, { method: 'POST' }),

  getPlanRuns: (planId: string) =>
    request<any[]>(`/api/plans/${planId}/runs`),

  // Snapshots
  listSnapshots: (repoId: string) =>
    request<any[]>(`/api/repos/${repoId}/tasks`, {
      method: 'POST',
      body: JSON.stringify({ operation: 'snapshots' }),
    }),

  browseSnapshot: (repoId: string, snapshotId: string, path?: string) =>
    request<any[]>(`/api/repos/${repoId}/snapshots/${snapshotId}/ls?path=${encodeURIComponent(path || '/')}`),

  diffSnapshots: (repoId: string, snapshotId: string, compareWith: string) =>
    request<any[]>(`/api/repos/${repoId}/snapshots/${snapshotId}/diff?compareWith=${encodeURIComponent(compareWith)}`),

  // Restore
  startRestore: (repoId: string, data: any) =>
    request<{ jobId: string; taskId: string }>(`/api/repos/${repoId}/restore`, { method: 'POST', body: JSON.stringify(data) }),

  getRestoreJobs: (repoId: string) =>
    request<any[]>(`/api/repos/${repoId}/restore-jobs`),

  getRestoreJob: (jobId: string) =>
    request<any>(`/api/restore-jobs/${jobId}`),

  cancelRestore: (jobId: string) =>
    request<any>(`/api/restore-jobs/${jobId}/cancel`, { method: 'POST' }),
};
