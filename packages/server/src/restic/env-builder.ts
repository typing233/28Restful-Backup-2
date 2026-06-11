import type { RepoCredentials } from '@restful-backup/shared';

export function buildResticEnv(repoUrl: string, credentials: RepoCredentials): Record<string, string> {
  const env: Record<string, string> = {
    RESTIC_REPOSITORY: repoUrl,
    RESTIC_PASSWORD: credentials.password,
  };

  if (credentials.awsAccessKeyId) {
    env.AWS_ACCESS_KEY_ID = credentials.awsAccessKeyId;
  }
  if (credentials.awsSecretAccessKey) {
    env.AWS_SECRET_ACCESS_KEY = credentials.awsSecretAccessKey;
  }
  if (credentials.awsDefaultRegion) {
    env.AWS_DEFAULT_REGION = credentials.awsDefaultRegion;
  }
  if (credentials.b2AccountId) {
    env.B2_ACCOUNT_ID = credentials.b2AccountId;
  }
  if (credentials.b2AccountKey) {
    env.B2_ACCOUNT_KEY = credentials.b2AccountKey;
  }

  return env;
}
