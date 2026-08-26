import React from 'react';

// Track AM-1119 Phase 1: Step 2 — what the app does, who it's for, and
// success metrics. Same semantic fields as the legacy form's purpose/kpis,
// plus target users (new).
export function ProductStep({ value, onChange }) {
  const { purpose, targetUsers, kpis } = value;

  function set(patch) {
    onChange({ ...value, ...patch });
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs text-gray-500 mb-1">What does it do? <span className="text-gray-600">(required)</span></label>
        <textarea
          value={purpose}
          onChange={e => set({ purpose: e.target.value })}
          rows={3}
          placeholder="e.g. A 2D digging/mining game where the player tunnels down collecting ore and avoiding hazards"
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 resize-none placeholder-gray-600 focus:outline-none focus:border-gray-500"
        />
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Who's it for? <span className="text-gray-600">(optional)</span></label>
        <input
          type="text"
          value={targetUsers}
          onChange={e => set({ targetUsers: e.target.value })}
          placeholder="e.g. casual browser-game players"
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-500"
        />
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Success metrics / KPIs <span className="text-gray-600">(optional)</span></label>
        <input
          type="text"
          value={kpis}
          onChange={e => set({ kpis: e.target.value })}
          placeholder="e.g. 500 plays in the first week"
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-500"
        />
      </div>
    </div>
  );
}

export function productStepValid(value) {
  return Boolean(value.purpose.trim());
}
