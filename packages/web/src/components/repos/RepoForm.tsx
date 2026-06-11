import { useState } from 'react';
import { api } from '../../api/client';

interface Props {
  onCreated: () => void;
  onCancel: () => void;
}

type BackendType = 'local' | 'sftp' | 's3' | 'rest' | 'b2';

export function RepoForm({ onCreated, onCancel }: Props) {
  const [name, setName] = useState('');
  const [backendType, setBackendType] = useState<BackendType>('local');
  const [repoUrl, setRepoUrl] = useState('');
  const [password, setPassword] = useState('');
  const [awsKeyId, setAwsKeyId] = useState('');
  const [awsSecret, setAwsSecret] = useState('');
  const [awsRegion, setAwsRegion] = useState('');
  const [sshAuthType, setSshAuthType] = useState<'key' | 'password'>('password');
  const [sshKey, setSshKey] = useState('');
  const [sshPassword, setSshPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const urlPlaceholders: Record<BackendType, string> = {
    local: '/path/to/repo',
    sftp: 'sftp:user@host:/path/to/repo',
    s3: 's3:bucket-name/prefix',
    rest: 'rest:https://host:port/',
    b2: 'b2:bucket-name:prefix',
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !repoUrl || !password) {
      setError('Name, repository URL, and password are required');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      await api.createRepo({
        name,
        backendType,
        repoUrl,
        credentials: {
          password,
          ...(backendType === 's3' ? {
            awsAccessKeyId: awsKeyId || undefined,
            awsSecretAccessKey: awsSecret || undefined,
            awsDefaultRegion: awsRegion || undefined,
          } : {}),
          ...(backendType === 'sftp' ? {
            sshKey: sshAuthType === 'key' ? sshKey || undefined : undefined,
            sshPassword: sshAuthType === 'password' ? sshPassword || undefined : undefined,
          } : {}),
        },
      });
      onCreated();
    } catch (err: any) {
      setError(err.message);
    }
    setSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <div className="bg-red-900/50 text-red-300 p-2 rounded text-sm">{error}</div>}

      <div>
        <label className="text-gray-300 text-sm block mb-1">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Backup"
          className="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 outline-none"
        />
      </div>

      <div>
        <label className="text-gray-300 text-sm block mb-1">Backend Type</label>
        <select
          value={backendType}
          onChange={(e) => setBackendType(e.target.value as BackendType)}
          className="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 outline-none"
        >
          <option value="local">Local Path</option>
          <option value="sftp">SFTP</option>
          <option value="s3">Amazon S3</option>
          <option value="rest">REST Server</option>
          <option value="b2">Backblaze B2</option>
        </select>
      </div>

      <div>
        <label className="text-gray-300 text-sm block mb-1">Repository URL</label>
        <input
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          placeholder={urlPlaceholders[backendType]}
          className="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 outline-none font-mono text-sm"
        />
      </div>

      <div>
        <label className="text-gray-300 text-sm block mb-1">Repository Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Restic repository password"
          className="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 outline-none"
        />
      </div>

      {backendType === 's3' && (
        <>
          <div>
            <label className="text-gray-300 text-sm block mb-1">AWS Access Key ID</label>
            <input
              value={awsKeyId}
              onChange={(e) => setAwsKeyId(e.target.value)}
              className="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="text-gray-300 text-sm block mb-1">AWS Secret Access Key</label>
            <input
              type="password"
              value={awsSecret}
              onChange={(e) => setAwsSecret(e.target.value)}
              className="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="text-gray-300 text-sm block mb-1">AWS Region</label>
            <input
              value={awsRegion}
              onChange={(e) => setAwsRegion(e.target.value)}
              placeholder="us-east-1"
              className="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 outline-none"
            />
          </div>
        </>
      )}

      {backendType === 'sftp' && (
        <>
          <div>
            <label className="text-gray-300 text-sm block mb-1">SSH Authentication</label>
            <select
              value={sshAuthType}
              onChange={(e) => setSshAuthType(e.target.value as 'key' | 'password')}
              className="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 outline-none"
            >
              <option value="password">SSH Password</option>
              <option value="key">SSH Private Key</option>
            </select>
          </div>
          {sshAuthType === 'password' ? (
            <div>
              <label className="text-gray-300 text-sm block mb-1">SSH Password</label>
              <input
                type="password"
                value={sshPassword}
                onChange={(e) => setSshPassword(e.target.value)}
                placeholder="SSH login password"
                className="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 outline-none"
              />
            </div>
          ) : (
            <div>
              <label className="text-gray-300 text-sm block mb-1">SSH Private Key</label>
              <textarea
                value={sshKey}
                onChange={(e) => setSshKey(e.target.value)}
                placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----"}
                rows={5}
                className="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 outline-none font-mono text-xs"
              />
            </div>
          )}
        </>
      )}

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2 rounded font-medium"
        >
          {submitting ? 'Adding...' : 'Add Repository'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2 rounded font-medium"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
