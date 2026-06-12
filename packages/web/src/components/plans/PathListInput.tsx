import { useState } from 'react';

interface Props {
  value: string[];
  onChange: (value: string[]) => void;
  label?: string;
  placeholder?: string;
}

export function PathListInput({ value, onChange, label = 'Paths', placeholder = '/path/to/backup' }: Props) {
  const [input, setInput] = useState('');

  function addPath() {
    const trimmed = input.trim();
    if (trimmed && !value.includes(trimmed)) {
      onChange([...value, trimmed]);
      setInput('');
    }
  }

  function removePath(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-2">
      <label className="text-sm text-gray-400">{label}</label>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPath(); } }}
          placeholder={placeholder}
          className="flex-1 bg-gray-700 text-white px-3 py-2 rounded text-sm"
        />
        <button
          type="button"
          onClick={addPath}
          className="bg-gray-600 hover:bg-gray-500 text-white px-3 py-2 rounded text-sm"
        >
          Add
        </button>
      </div>
      {value.length > 0 && (
        <div className="space-y-1">
          {value.map((path, index) => (
            <div key={index} className="flex items-center justify-between bg-gray-700 rounded px-3 py-1.5">
              <span className="text-white text-sm font-mono truncate">{path}</span>
              <button
                type="button"
                onClick={() => removePath(index)}
                className="text-red-400 hover:text-red-300 text-sm ml-2"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
