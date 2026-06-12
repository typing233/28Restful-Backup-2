interface RetentionPolicy {
  keepLast?: number;
  keepDaily?: number;
  keepWeekly?: number;
  keepMonthly?: number;
  keepYearly?: number;
  keepWithinDuration?: string;
}

interface Props {
  value: RetentionPolicy | null;
  onChange: (value: RetentionPolicy | null) => void;
}

export function RetentionPolicyForm({ value, onChange }: Props) {
  const policy = value || {};

  function update(key: keyof RetentionPolicy, raw: string) {
    const newPolicy = { ...policy };
    if (key === 'keepWithinDuration') {
      newPolicy[key] = raw || undefined;
    } else {
      const num = parseInt(raw, 10);
      (newPolicy as any)[key] = isNaN(num) ? undefined : num;
    }
    const hasValues = Object.values(newPolicy).some((v) => v !== undefined);
    onChange(hasValues ? newPolicy : null);
  }

  return (
    <div className="space-y-3">
      <label className="text-sm text-gray-400">Retention Policy</label>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Field label="Keep Last" value={policy.keepLast} onChange={(v) => update('keepLast', v)} />
        <Field label="Keep Daily" value={policy.keepDaily} onChange={(v) => update('keepDaily', v)} />
        <Field label="Keep Weekly" value={policy.keepWeekly} onChange={(v) => update('keepWeekly', v)} />
        <Field label="Keep Monthly" value={policy.keepMonthly} onChange={(v) => update('keepMonthly', v)} />
        <Field label="Keep Yearly" value={policy.keepYearly} onChange={(v) => update('keepYearly', v)} />
        <div>
          <label className="text-xs text-gray-500 block mb-1">Keep Within</label>
          <input
            type="text"
            value={policy.keepWithinDuration || ''}
            onChange={(e) => update('keepWithinDuration', e.target.value)}
            placeholder="e.g. 30d"
            className="w-full bg-gray-700 text-white px-2 py-1.5 rounded text-sm"
          />
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value?: number; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-xs text-gray-500 block mb-1">{label}</label>
      <input
        type="number"
        min="0"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
        className="w-full bg-gray-700 text-white px-2 py-1.5 rounded text-sm"
      />
    </div>
  );
}
