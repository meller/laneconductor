import React from 'react';

// Track AM-1119 Phase 1: Step 1 of the App Creator wizard — name, repo
// source, manager worker. Same fields/behavior as the legacy NewProjectModal
// form, extracted so both the wizard and "Quick create" can render them.
export function BasicsStep({ value, onChange, managerWorkers, nameInputRef }) {
  const { name, repoType, repoValue, hasExistingCode, kind = 'app', workerId } = value;

  function set(patch) {
    onChange({ ...value, ...patch });
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs text-gray-500 mb-1">Project name <span className="text-gray-600">(required)</span></label>
        <input
          ref={nameInputRef}
          type="text"
          value={name}
          onChange={e => set({ name: e.target.value })}
          placeholder="e.g. Digger Game"
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-500"
        />
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Project type</label>
        <div className="flex rounded-lg overflow-hidden border border-gray-700 text-xs w-fit">
          {[{ value: 'app', label: 'Software app' }, { value: 'marketing', label: 'Marketing / growth (no code)' }].map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => set({ kind: opt.value })}
              className={`px-3 py-1 transition-colors ${kind === opt.value ? 'bg-blue-900 text-blue-300' : 'bg-gray-900 text-gray-500 hover:text-gray-300'}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {kind === 'marketing' && (
          <p className="text-[11px] text-gray-500 mt-1">
            Skips Design/Stack and Deployment — tracks are generated from the marketing skills instead of app scaffolding.
          </p>
        )}
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Repo source</label>
        <div className="flex rounded-lg overflow-hidden border border-gray-700 text-xs w-fit mb-2">
          {[{ value: 'path', label: 'Existing local path' }, { value: 'git', label: 'Git URL to clone' }].map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => set({ repoType: opt.value, hasExistingCode: opt.value === 'path' })}
              className={`px-3 py-1 transition-colors ${repoType === opt.value ? 'bg-blue-900 text-blue-300' : 'bg-gray-900 text-gray-500 hover:text-gray-300'}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={repoValue}
          onChange={e => set({ repoValue: e.target.value })}
          placeholder={repoType === 'path' ? '/home/you/Code/digger-game' : 'git@github.com:you/digger-game.git'}
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-500"
        />
        <label className="flex items-center gap-1.5 mt-1.5 text-xs text-gray-500">
          <input type="checkbox" checked={hasExistingCode} onChange={e => set({ hasExistingCode: e.target.checked })} />
          This already has code (unchecked = brand new project)
        </label>
      </div>

      {managerWorkers.length > 1 && (
        <div>
          <label className="block text-xs text-gray-500 mb-1">Manager worker</label>
          <select
            value={workerId ?? ''}
            onChange={e => set({ workerId: Number(e.target.value) })}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-gray-500"
          >
            {managerWorkers.map(w => (
              <option key={w.id} value={w.id}>{w.hostname}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

export function basicsStepValid(value) {
  return Boolean(value.name.trim() && value.repoValue.trim() && value.workerId);
}
