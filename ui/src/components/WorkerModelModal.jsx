import { useState } from 'react';
import { useApi } from '../hooks/useApi.js';
import { PROVIDERS, PROVIDER_IDS } from '../../../conductor/providers.mjs';

// Re-exported under their historical names so existing imports (e.g.
// ProvisionWorkerModal.jsx's `import { MODEL_PRESETS, CLI_ENGINES } from
// './WorkerModelModal.jsx'`) keep working unchanged — the data itself now
// comes from the single canonical registry instead of a local copy.
// Fallback presets shown when a worker hasn't reported its own available models.
export const MODEL_PRESETS = Object.fromEntries(
  PROVIDER_IDS.map(id => [id, PROVIDERS[id].models])
);

export const CLI_ENGINES = PROVIDER_IDS.map(id => ({
  id, name: PROVIDERS[id].label, icon: PROVIDERS[id].icon,
}));

export function WorkerModelModal({ worker, onClose, onUpdated }) {
  const { apiFetch } = useApi();
  const [selectedCli, setSelectedCli] = useState(worker.cli || 'claude');
  // Falls back to the first preset (the current recommended model), not a
  // hardcoded id — a pinned id silently rots to an old model as presets
  // are updated (this was stuck on claude-3-5-sonnet).
  const [selectedModel, setSelectedModel] = useState(
    worker.model || (MODEL_PRESETS[worker.cli || 'claude'] || MODEL_PRESETS.claude)[0].id
  );
  const [customModel, setCustomModel] = useState('');
  const [isCustom, setIsCustom] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Use worker-reported models if available; fall back to global presets.
  // available_models arrives as parsed JSON from the server (JSONB column).
  const rawModels = worker.available_models
    ? (worker.available_models[selectedCli] || 
       (Array.isArray(worker.available_models) ? worker.available_models : null))
    : null;
  const workerModels = Array.isArray(rawModels) && rawModels.length > 0
    ? rawModels.map(m => typeof m === 'string' ? { id: m, label: m } : m)
    : null;
  const basePresets = MODEL_PRESETS[selectedCli] || MODEL_PRESETS.claude;
  const presets = workerModels
    ? [...workerModels, ...basePresets.filter(p => !workerModels.some(m => m.id === p.id))]
    : basePresets;
  const isLiveModels = !!workerModels;

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const modelToSave = isCustom ? customModel.trim() : selectedModel;
    if (!modelToSave) {
      setError('Model identifier is required');
      setLoading(false);
      return;
    }

    try {
      const res = await apiFetch(`/api/workers/${worker.id}/config`, {
        method: 'PATCH',
        body: JSON.stringify({
          cli: selectedCli,
          model: modelToSave,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update worker configuration');
      }

      onUpdated?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col" data-testid="worker-model-modal">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between bg-gray-950/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-purple-400 font-bold text-lg shadow-inner">
              ⚙️
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-100">Worker Configuration</h2>
              <p className="text-xs text-gray-500">Configure CLI engine & model for {worker.hostname}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-800 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-5">
          {error && (
            <div className="p-3 bg-red-950/50 border border-red-900/60 rounded-xl text-red-300 text-xs flex items-center gap-2">
              <span className="text-red-400 font-bold">⚠️ Error:</span> {error}
            </div>
          )}

          {/* CLI Selection */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">
              CLI Engine
            </label>
            <div className="grid grid-cols-2 gap-2">
              {CLI_ENGINES.map(engine => {
                const isSelected = selectedCli === engine.id;
                return (
                  <button
                    key={engine.id}
                    type="button"
                    onClick={() => {
                      setSelectedCli(engine.id);
                      // When switching CLI, reset to first preset for that engine
                      const newPresets = MODEL_PRESETS[engine.id];
                      if (newPresets && newPresets.length > 0) {
                        setSelectedModel(newPresets[0].id);
                        setIsCustom(false);
                      }
                    }}
                    className={`flex items-center gap-2.5 p-3 rounded-xl border text-xs font-bold transition-all text-left ${
                      isSelected
                        ? 'bg-purple-950/40 border-purple-500 text-purple-200 shadow-md shadow-purple-950/50'
                        : 'bg-gray-950 border-gray-800 text-gray-400 hover:border-gray-700 hover:text-gray-200'
                    }`}
                    data-testid={`cli-option-${engine.id}`}
                  >
                    <span className="text-base">{engine.icon}</span>
                    <span>{engine.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Model Selection */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                LLM Model
              </label>
              <div className="flex items-center gap-2">
                {isLiveModels ? (
                  <span className="text-[10px] text-emerald-400 font-semibold bg-emerald-950/40 border border-emerald-900/50 px-2 py-0.5 rounded-full">
                    ✓ live from worker
                  </span>
                ) : (
                  <span className="text-[10px] text-gray-500 font-medium">
                    fallback presets
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setIsCustom(!isCustom)}
                  className="text-[11px] text-purple-400 hover:text-purple-300 font-medium underline"
                >
                  {isCustom ? 'Use Presets' : 'Custom Model'}
                </button>
              </div>
            </div>

            {!isCustom ? (
              <select
                value={selectedModel}
                onChange={e => setSelectedModel(e.target.value)}
                className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3 py-2.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500 transition-colors font-mono"
                data-testid="model-select-dropdown"
              >
                {presets.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.label} ({m.id})
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                placeholder="e.g. anthropic/claude-3-5-sonnet:beta"
                value={customModel}
                onChange={e => setCustomModel(e.target.value)}
                className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3 py-2.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500 transition-colors font-mono"
                data-testid="custom-model-input"
              />
            )}
          </div>

          {/* Footer Buttons */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl text-xs font-bold transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-lg shadow-purple-900/30 transition-all"
              data-testid="save-worker-config-btn"
            >
              {loading ? 'Updating...' : 'Save Configuration'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
