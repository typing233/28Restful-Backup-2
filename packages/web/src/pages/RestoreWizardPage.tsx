import { useState } from 'react';
import { api } from '../api/client';
import { SnapshotPicker } from '../components/restore/SnapshotPicker';
import { FileBrowser } from '../components/restore/FileBrowser';
import { RestoreConfig } from '../components/restore/RestoreConfig';
import { RestoreProgress } from '../components/restore/RestoreProgress';
import type { ServerMessage } from '@restful-backup/shared';

interface Props {
  repoId: string;
  wsSend: (msg: any) => void;
  wsSubscribe: (listener: (msg: ServerMessage) => void) => () => void;
  onBack: () => void;
}

type Step = 'snapshot' | 'files' | 'config' | 'progress' | 'done';

export function RestoreWizardPage({ repoId, wsSend, wsSubscribe, onBack }: Props) {
  const [step, setStep] = useState<Step>('snapshot');
  const [snapshotId, setSnapshotId] = useState('');
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [jobId, setJobId] = useState('');
  const [taskId, setTaskId] = useState('');

  function handleSnapshotSelect(id: string) {
    setSnapshotId(id);
  }

  function handleFilesSelected(paths: string[]) {
    setSelectedPaths(paths);
  }

  async function handleStartRestore(config: { targetPath: string; conflictStrategy: string; verifyAfter: boolean }) {
    try {
      const result = await api.startRestore(repoId, {
        snapshotId,
        sourcePaths: selectedPaths,
        targetPath: config.targetPath,
        conflictStrategy: config.conflictStrategy,
        verifyAfter: config.verifyAfter,
      });
      setJobId(result.jobId);
      setTaskId(result.taskId);
      setStep('progress');
    } catch (err: any) {
      alert(err.message);
    }
  }

  const steps: { key: Step; label: string }[] = [
    { key: 'snapshot', label: 'Select Snapshot' },
    { key: 'files', label: 'Choose Files' },
    { key: 'config', label: 'Configure' },
    { key: 'progress', label: 'Restore' },
  ];

  const currentStepIndex = steps.findIndex((s) => s.key === step);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="text-gray-400 hover:text-white text-sm">
          &larr; Back
        </button>
        <h2 className="text-lg font-semibold text-white">Restore Wizard</h2>
        <div />
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${
              i < currentStepIndex ? 'bg-green-600 text-white' :
              i === currentStepIndex ? 'bg-blue-600 text-white' :
              'bg-gray-700 text-gray-400'
            }`}>
              {i < currentStepIndex ? '✓' : i + 1}
            </div>
            <span className={`text-xs ${i === currentStepIndex ? 'text-white' : 'text-gray-500'}`}>
              {s.label}
            </span>
            {i < steps.length - 1 && <div className="w-8 h-0.5 bg-gray-700" />}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="bg-gray-800 rounded-lg p-5 border border-gray-700 min-h-[300px]">
        {step === 'snapshot' && (
          <div className="space-y-4">
            <SnapshotPicker repoId={repoId} onSelect={handleSnapshotSelect} />
            {snapshotId && (
              <div className="flex justify-end">
                <button
                  onClick={() => setStep('files')}
                  className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-sm"
                >
                  Next: Choose Files
                </button>
              </div>
            )}
          </div>
        )}

        {step === 'files' && (
          <div className="space-y-4">
            <FileBrowser repoId={repoId} snapshotId={snapshotId} onSelect={handleFilesSelected} />
            <div className="flex justify-between">
              <button onClick={() => setStep('snapshot')} className="text-gray-400 hover:text-white text-sm">
                &larr; Back
              </button>
              <button
                onClick={() => setStep('config')}
                disabled={selectedPaths.length === 0}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded text-sm"
              >
                Next: Configure Restore
              </button>
            </div>
          </div>
        )}

        {step === 'config' && (
          <div className="space-y-4">
            <div className="text-sm text-gray-400 mb-4">
              Restoring {selectedPaths.length} item(s) from snapshot <code className="text-white">{snapshotId}</code>
            </div>
            <RestoreConfig onSubmit={handleStartRestore} />
            <button onClick={() => setStep('files')} className="text-gray-400 hover:text-white text-sm mt-4">
              &larr; Back
            </button>
          </div>
        )}

        {step === 'progress' && (
          <RestoreProgress
            jobId={jobId}
            taskId={taskId}
            wsSend={wsSend}
            wsSubscribe={wsSubscribe}
            onComplete={() => setStep('done')}
          />
        )}

        {step === 'done' && (
          <div className="text-center py-8">
            <div className="text-green-400 text-lg font-medium mb-2">Restore Complete</div>
            <p className="text-gray-400 text-sm">Files have been successfully restored.</p>
            <button
              onClick={onBack}
              className="mt-4 bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded text-sm"
            >
              Back to Repository
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
