import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { PlanForm } from '../components/plans/PlanForm';

interface Props {
  repoId: string;
  onSelectPlan: (planId: string) => void;
}

export function PlanListPage({ repoId, onSelectPlan }: Props) {
  const [plans, setPlans] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchPlans = async () => {
    try {
      const data = await api.getPlans(repoId);
      setPlans(data);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchPlans(); }, [repoId]);

  async function handleCreate(data: any) {
    await api.createPlan(repoId, { ...data, repoId });
    setShowForm(false);
    fetchPlans();
  }

  async function handleToggle(plan: any) {
    if (plan.enabled) {
      await api.pausePlan(plan.id);
    } else {
      await api.resumePlan(plan.id);
    }
    fetchPlans();
  }

  async function handleDelete(planId: string) {
    await api.deletePlan(planId);
    fetchPlans();
  }

  async function handleTrigger(planId: string) {
    await api.triggerPlan(planId);
    fetchPlans();
  }

  if (loading) return <div className="text-gray-400 p-4">Loading plans...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Backup Plans</h2>
        <button
          onClick={() => setShowForm(true)}
          className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded text-sm font-medium"
        >
          New Plan
        </button>
      </div>

      {showForm && (
        <div className="bg-gray-800 rounded-lg p-5 border border-gray-700">
          <h3 className="text-white font-medium mb-4">Create Backup Plan</h3>
          <PlanForm onSubmit={handleCreate} onCancel={() => setShowForm(false)} />
        </div>
      )}

      {plans.length === 0 && !showForm && (
        <p className="text-gray-500 text-sm">No backup plans yet. Create one to schedule automatic backups.</p>
      )}

      <div className="space-y-3">
        {plans.map((plan) => (
          <div key={plan.id} className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className={`w-2.5 h-2.5 rounded-full ${plan.enabled ? 'bg-green-500' : 'bg-gray-500'}`} />
                <button
                  onClick={() => onSelectPlan(plan.id)}
                  className="text-white font-medium hover:text-blue-400"
                >
                  {plan.name}
                </button>
                <span className="text-gray-400 text-xs font-mono">{plan.cronExpression}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleTrigger(plan.id)}
                  className="text-blue-400 hover:text-blue-300 text-xs font-medium"
                >
                  Run Now
                </button>
                <button
                  onClick={() => handleToggle(plan)}
                  className="text-gray-400 hover:text-white text-xs font-medium"
                >
                  {plan.enabled ? 'Pause' : 'Resume'}
                </button>
                <button
                  onClick={() => handleDelete(plan.id)}
                  className="text-red-400 hover:text-red-300 text-xs font-medium"
                >
                  Delete
                </button>
              </div>
            </div>
            <div className="mt-2 flex gap-4 text-xs text-gray-400">
              <span>{plan.paths.length} path(s)</span>
              {plan.excludes.length > 0 && <span>{plan.excludes.length} exclude(s)</span>}
              {plan.lastRunAt && (
                <span>Last run: {new Date(plan.lastRunAt).toLocaleString()} ({plan.lastRunStatus})</span>
              )}
              {plan.nextRunAt && <span>Next: {new Date(plan.nextRunAt).toLocaleString()}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
