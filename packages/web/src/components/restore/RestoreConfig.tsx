import { useState } from 'react';

interface Props {
  onSubmit: (config: { targetPath: string; conflictStrategy: string; verifyAfter: boolean }) => void;
}

export function RestoreConfig({ onSubmit }: Props) {
  const [targetPath, setTargetPath] = useState('');
  const [conflictStrategy, setConflictStrategy] = useState('overwrite');
  const [verifyAfter, setVerifyAfter] = useState(true);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!targetPath.trim()) return;
    onSubmit({ targetPath: targetPath.trim(), conflictStrategy, verifyAfter });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="text-sm text-gray-400 block mb-1">Target Path</label>
        <input
          type="text"
          value={targetPath}
          onChange={(e) => setTargetPath(e.target.value)}
          placeholder="/home/user/restored"
          className="w-full bg-gray-700 text-white px-3 py-2 rounded text-sm"
        />
        <p className="text-xs text-gray-500 mt-1">Directory where files will be restored to</p>
      </div>

      <div>
        <label className="text-sm text-gray-400 block mb-2">Conflict Strategy</label>
        <div className="space-y-2">
          {[
            { value: 'overwrite', label: 'Overwrite', desc: 'Replace existing files with restored versions' },
            { value: 'rename', label: 'Rename', desc: 'Add .bak suffix to existing files before restoring' },
            { value: 'skip', label: 'Skip', desc: 'Skip files that already exist at the target' },
          ].map((opt) => (
            <label key={opt.value} className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                name="conflict"
                value={opt.value}
                checked={conflictStrategy === opt.value}
                onChange={(e) => setConflictStrategy(e.target.value)}
                className="mt-0.5"
              />
              <div>
                <span className="text-white text-sm">{opt.label}</span>
                <p className="text-gray-500 text-xs">{opt.desc}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={verifyAfter}
          onChange={(e) => setVerifyAfter(e.target.checked)}
          className="rounded"
        />
        <span className="text-sm text-gray-300">Verify after restore</span>
      </label>

      <button
        type="submit"
        disabled={!targetPath.trim()}
        className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded text-sm font-medium"
      >
        Start Restore
      </button>
    </form>
  );
}
