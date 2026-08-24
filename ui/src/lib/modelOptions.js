// ui/src/lib/modelOptions.js
// Track 1116: shared Provider/Model picker logic, used by both
// WorkflowSettings.jsx's per-lane panel (REQ-1/REQ-2) and
// TrackDetailPanel.jsx's per-track override field (REQ-7) — one
// implementation of "merge live-discovered models with static presets" and
// "guess which provider a stored model id belongs to", not two copies.
import { PROVIDERS, PROVIDER_IDS } from '../../../conductor/providers.mjs';

// Merges live-reported `available_models` across every worker for a given
// provider with the static preset list (live entries first, deduped against
// presets by id) — same fallback shape WorkerModelModal.jsx already uses,
// generalized to merge across all of a project's workers (plan.md Phase 2's
// "merge across workers" decision) rather than just one. `available_models`
// arrives as either a flat array (scoped to that worker's own `cli` only) or
// an object keyed by provider id.
export function modelsForProvider(cli, workers) {
  const seen = new Map();
  for (const w of workers || []) {
    if (!w?.available_models) continue;
    const raw = Array.isArray(w.available_models)
      ? (w.cli === cli ? w.available_models : null)
      : w.available_models[cli];
    if (!Array.isArray(raw)) continue;
    for (const m of raw) {
      const entry = typeof m === 'string' ? { id: m, label: m } : m;
      if (entry?.id && !seen.has(entry.id)) seen.set(entry.id, entry);
    }
  }
  const live = [...seen.values()];
  const basePresets = PROVIDERS[cli]?.models || [];
  return live.length > 0
    ? [...live, ...basePresets.filter(p => !live.some(m => m.id === p.id))]
    : basePresets;
}

// Infers which provider a stored model string belongs to, so opening a
// picker with a value already set shows the right Provider selected instead
// of resetting to the default. Checks live-reported models first (a model id
// could exist there but not yet in the static registry), then static presets.
export function guessProviderForModel(model, workers) {
  if (!model) return null;
  for (const cli of PROVIDER_IDS) {
    if (modelsForProvider(cli, workers).some(m => m.id === model)) return cli;
  }
  return null;
}
