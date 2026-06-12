import { useState } from 'react';
import { CronInput } from './CronInput';
import { PathListInput } from './PathListInput';
import { RetentionPolicyForm } from './RetentionPolicyForm';

interface PlanFormData {
  name: string;
  cronExpression: string;
  paths: string[];
  excludes: string[];
  tags: string[];
  retentionPolicy: any | null;
  maxFileCount: number | null;
  maxBytes: number | null;
  oneFileSystem: boolean;
  excludeLargerThan: string;
}

interface Props {
  initial?: Partial<PlanFormData>;
  onSubmit: (data: PlanFormData) => Promise<void>;
  onCancel: () => void;
  submitLabel?: string;
}

export function PlanForm({ initial, onSubmit, onCancel, submitLabel = 'Create Plan' }: Props) {
  const [form, setForm] = useState<PlanFormData>({
    name: initial?.name || '',
    cronExpression: initial?.cronExpression || '0 2 * * *',
    paths: initial?.paths || [],
    excludes: initial?.excludes || [],
    tags: initial?.tags || [],
    retentionPolicy: initial?.retentionPolicy || null,
    maxFileCount: initial?.maxFileCount ?? null,
    maxBytes: initial?.maxBytes ?? null,
    oneFileSystem: initial?.oneFileSystem ?? false,
    excludeLargerThan: initial?.excludeLargerThan || '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.paths.length) {
      setError('Name and at least one path are required');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await onSubmit(form);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className="text-sm text-gray-400">Plan Name</label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Daily Home Backup"
          className="w-full bg-gray-700 text-white px-3 py-2 rounded text-sm mt-1"
        />
      </div>

      <CronInput value={form.cronExpression} onChange={(v) => setForm({ ...form, cronExpression: v })} />

      <PathListInput
        value={form.paths}
        onChange={(v) => setForm({ ...form, paths: v })}
        label="Backup Paths"
        placeholder="/home/user/documents"
      />

      <PathListInput
        value={form.excludes}
        onChange={(v) => setForm({ ...form, excludes: v })}
        label="Exclude Patterns"
        placeholder="*.tmp, node_modules, .cache"
      />

      <PathListInput
        value={form.tags}
        onChange={(v) => setForm({ ...form, tags: v })}
        label="Tags"
        placeholder="production, daily"
      />

      <RetentionPolicyForm
        value={form.retentionPolicy}
        onChange={(v) => setForm({ ...form, retentionPolicy: v })}
      />

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm text-gray-400">Max File Count</label>
          <input
            type="number"
            min="0"
            value={form.maxFileCount ?? ''}
            onChange={(e) => setForm({ ...form, maxFileCount: e.target.value ? parseInt(e.target.value) : null })}
            placeholder="Unlimited"
            className="w-full bg-gray-700 text-white px-3 py-2 rounded text-sm mt-1"
          />
        </div>
        <div>
          <label className="text-sm text-gray-400">Max Size (bytes)</label>
          <input
            type="number"
            min="0"
            value={form.maxBytes ?? ''}
            onChange={(e) => setForm({ ...form, maxBytes: e.target.value ? parseInt(e.target.value) : null })}
            placeholder="Unlimited"
            className="w-full bg-gray-700 text-white px-3 py-2 rounded text-sm mt-1"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="oneFileSystem"
            checked={form.oneFileSystem}
            onChange={(e) => setForm({ ...form, oneFileSystem: e.target.checked })}
            className="rounded bg-gray-700 border-gray-600"
          />
          <label htmlFor="oneFileSystem" className="text-sm text-gray-400">Stay on one filesystem</label>
        </div>
        <div>
          <label className="text-sm text-gray-400">Exclude files larger than</label>
          <input
            type="text"
            value={form.excludeLargerThan}
            onChange={(e) => setForm({ ...form, excludeLargerThan: e.target.value })}
            placeholder="e.g. 500M, 2G"
            className="w-full bg-gray-700 text-white px-3 py-2 rounded text-sm mt-1"
          />
        </div>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancel} className="text-gray-400 hover:text-white px-4 py-2 text-sm">
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded text-sm font-medium"
        >
          {submitting ? 'Saving...' : submitLabel}
        </button>
      </div>
    </form>
  );
}
