import { useState } from 'react';

const PRESETS = [
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Every 6 hours', value: '0 */6 * * *' },
  { label: 'Daily at 2am', value: '0 2 * * *' },
  { label: 'Daily at midnight', value: '0 0 * * *' },
  { label: 'Weekly (Sun 2am)', value: '0 2 * * 0' },
  { label: 'Monthly (1st, 2am)', value: '0 2 1 * *' },
];

interface Props {
  value: string;
  onChange: (value: string) => void;
}

export function CronInput({ value, onChange }: Props) {
  const [isCustom, setIsCustom] = useState(!PRESETS.some((p) => p.value === value));

  return (
    <div className="space-y-2">
      <label className="text-sm text-gray-400">Schedule</label>
      <div className="flex gap-2 flex-wrap">
        {PRESETS.map((preset) => (
          <button
            key={preset.value}
            type="button"
            onClick={() => { onChange(preset.value); setIsCustom(false); }}
            className={`px-2 py-1 rounded text-xs font-medium ${
              value === preset.value && !isCustom
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            {preset.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setIsCustom(true)}
          className={`px-2 py-1 rounded text-xs font-medium ${
            isCustom ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          Custom
        </button>
      </div>
      {isCustom && (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="* * * * * (min hour dom mon dow)"
          className="w-full bg-gray-700 text-white px-3 py-2 rounded text-sm font-mono"
        />
      )}
      <p className="text-xs text-gray-500">
        Current: <span className="font-mono">{value || '(not set)'}</span>
      </p>
    </div>
  );
}
