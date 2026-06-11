import type { RepoCredentials } from '@restful-backup/shared';
import { writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

export interface ResticEnvResult {
  env: Record<string, string>;
  cleanup: () => void;
}

export function buildResticEnv(repoUrl: string, credentials: RepoCredentials): ResticEnvResult {
  const env: Record<string, string> = {
    RESTIC_REPOSITORY: repoUrl,
    RESTIC_PASSWORD: credentials.password,
  };

  let cleanupFn: (() => void) | null = null;

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

  // SFTP: write SSH key to temp file, set RESTIC_SFTP_COMMAND
  if (credentials.sshKey) {
    const keyDir = join(tmpdir(), 'restful-backup-keys');
    mkdirSync(keyDir, { recursive: true });
    const keyFile = join(keyDir, `key-${randomBytes(8).toString('hex')}`);
    writeFileSync(keyFile, credentials.sshKey, { mode: 0o600 });
    env.RESTIC_SFTP_COMMAND = `ssh -i ${keyFile} -o StrictHostKeyChecking=no -o BatchMode=yes -s sftp`;
    cleanupFn = () => {
      try { unlinkSync(keyFile); } catch { /* ignore */ }
    };
  } else if (credentials.sshPassword) {
    // Use sshpass for password-based SFTP authentication
    env.RESTIC_SFTP_COMMAND = `sshpass -p '${credentials.sshPassword.replace(/'/g, "'\\''")}' ssh -o StrictHostKeyChecking=no -s sftp`;
  }

  return {
    env,
    cleanup: cleanupFn || (() => {}),
  };
}
