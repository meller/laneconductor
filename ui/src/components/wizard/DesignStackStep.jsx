import React from 'react';

// Track AM-1119 Phase 1: Step 3 — visual style + tech stack. Both optional;
// this step never blocks Next, matching spec.md REQ-1 (stepper only
// validates what's actually required at each step).
const STACK_PRESETS = [
  { value: '', label: 'Let the planner decide' },
  { value: 'Next.js, Postgres, Tailwind', label: 'Next.js + Postgres + Tailwind' },
  { value: 'React + Vite, Firebase (Firestore)', label: 'React + Vite + Firestore' },
  { value: 'Vanilla JS + Canvas, no backend', label: 'Vanilla JS + Canvas (static game)' },
  { value: 'custom', label: 'Custom (type below)' },
];

export function DesignStackStep({ value, onChange }) {
  const { designPrompt, stackPreset, techStack } = value;

  function set(patch) {
    onChange({ ...value, ...patch });
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs text-gray-500 mb-1">Visual style <span className="text-gray-600">(optional)</span></label>
        <textarea
          value={designPrompt}
          onChange={e => set({ designPrompt: e.target.value })}
          rows={2}
          placeholder="e.g. retro pixel-art, dark background, bright ore colors"
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 resize-none placeholder-gray-600 focus:outline-none focus:border-gray-500"
        />
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Tech stack <span className="text-gray-600">(optional)</span></label>
        <select
          value={stackPreset}
          onChange={e => {
            const preset = e.target.value;
            set({ stackPreset: preset, techStack: preset === 'custom' ? techStack : preset });
          }}
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 mb-2 focus:outline-none focus:border-gray-500"
        >
          {STACK_PRESETS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        {stackPreset === 'custom' && (
          <input
            type="text"
            value={techStack}
            onChange={e => set({ techStack: e.target.value })}
            placeholder="e.g. SvelteKit, SQLite"
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-500"
          />
        )}
      </div>
    </div>
  );
}

export function designStackStepValid() {
  return true; // fully optional step
}
