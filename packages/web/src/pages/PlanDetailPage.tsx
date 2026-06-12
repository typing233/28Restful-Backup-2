import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { PlanForm } from '../components/plans/PlanForm';
import { PlanRunHistory } from '../components/plans/PlanRunHistory';

interface Props {
  planId: string;
  onBack: () => void;
}

export function PlanDetailPage({ planId, onBack }: Props) {
  const [plan, setPlan] = useState<any>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const [editing, setEditing] = useState(false);
  const [triggering, setTriggering] = useState(false);

  const fetchPlan = async () => {
    try {
      const data = await api.getPlan(planId);
      setPlan(data);
    } catch { /* ignore */ }
  };

  const fetchRuns = async () => {
    try {
      const data = await api.getPlanRuns(planId);
      setRuns(data);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    fetchPlan();
    fetchRuns();
  }, [planId]);

  async function handleUpdate(data: any) {
    await api.updatePlan(planId, data);
    setEditing(false);
    fetchPlan();
  }

  async function handleTrigger() {
    setTriggering(true);
    try {
      await api.triggerPlan(planId);
      setTimeout(fetchRuns, 1000);
    } catch { /* ignore */ }
    setTriggering(false);
  }

  async function handleToggle() {
    if (!plan) return;
    if (plan.enabled) {
      await api.pausePlan(planId);
    } else {
      await api.resumePlan(planId);
    }
    fetchPlan();
  }

  if (!plan) return <div className="p-6 text-gray-400">Loading...</div>;

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="text-gray-400 hover:text-white text-sm">
        &larr; Back to Plans
      </button>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-white">{plan.name}</h2>
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${plan.enabled ? 'bg-green-800 text-green-200' : 'bg-gray-700 text-gray-300'}`}>
            {plan.enabled ? 'Active' : 'Paused'}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleTrigger}
            disabled={triggering}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-3 py-1.5 rounded text-sm"
          >
            {triggering ? 'Running...' : 'Run Now'}
          </button>
          <button
            onClick={handleToggle}
            className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded text-sm"
          >
            {plan.enabled ? 'Pause' : 'Resume'}
          </button>
          <button
            onClick={() => setEditing(!editing)}
            className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded text-sm"
          >
            Edit
          </button>
        </div>
      </div>

      {!editing && (
        <div className="bg-gray-800 rounded-lg p-4 grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
          <div>
            <span className="text-gray-400 block">Schedule</span>
            <span className="text-white font-mono">{plan.cronExpression}</span>
          </div>
          <div>
            <span className="text-gray-400 block">Paths</span>
            <span className="text-white">{plan.paths.join(', ')}</span>
          </div>
          {plan.excludes.length > 0 && (
            <div>
              <span className="text-gray-400 block">Excludes</span>
              <span className="text-white">{plan.excludes.join(', ')}</span>
            </div>
          )}
          {plan.retentionPolicy && (
            <div>
              <span className="text-gray-400 block">Retention</span>
              <span className="text-white text-xs">
                {Object.entries(plan.retentionPolicy).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(', ')}
              </span>
            </div>
          )}
          {plan.lastRunAt && (
            <div>
              <span className="text-gray-400 block">Last Run</span>
              <span className="text-white">{new Date(plan.lastRunAt).toLocaleString()}</span>
            </div>
          )}
          {plan.nextRunAt && (
            <div>
              <span className="text-gray-400 block">Next Run</span>
              <span className="text-white">{new Date(plan.nextRunAt).toLocaleString()}</span>
            </div>
          )}
        </div>
      )}

      {editing && (
        <div className="bg-gray-800 rounded-lg p-5 border border-gray-700">
          <PlanForm
            initial={plan}
            onSubmit={handleUpdate}
            onCancel={() => setEditing(false)}
            submitLabel="Save Changes"
          />
        </div>
      )}

      <div>
        <h3 className="text-lg font-semibold text-white mb-3">Run History</h3>
        <PlanRunHistory runs={runs} />
      </div>
    </div>
  );
}
