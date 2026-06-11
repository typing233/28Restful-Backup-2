export type BackendType = 'local' | 'sftp' | 's3' | 'rest' | 'b2';

export type RepoStatus = 'ok' | 'error' | 'unknown' | 'initializing';

export interface Repo {
  id: string;
  userId: string;
  name: string;
  backendType: BackendType;
  repoUrl: string;
  status: RepoStatus;
  lastCheckedAt: string | null;
  snapshotCount: number | null;
  totalSize: number | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRepoInput {
  name: string;
  backendType: BackendType;
  repoUrl: string;
  credentials: RepoCredentials;
}

export interface RepoCredentials {
  password: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  awsDefaultRegion?: string;
  sshKey?: string;
  sshPassword?: string;
  b2AccountId?: string;
  b2AccountKey?: string;
}
