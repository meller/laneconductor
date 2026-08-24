// Track 1116 REQ-3: the single place "what's the default provider/model"
// is decided. Before this, 'claude' (and, in one place,
// MODEL_PRESETS.claude[0]) was independently hardcoded as the "nothing
// configured" fallback in 5 places (ProjectConfigSettings.jsx,
// ProjectCard.jsx, WorkersList.jsx, WorkerModelModal.jsx x2), each blind to
// the project's actual configured default and to live discovery data (1099).
import { PROVIDERS, defaultModelFor, normalizeProviderId } from '../../../conductor/providers.mjs';

// `available_models` (JSONB) comes in two shapes depending on what the
// worker reported: a flat array or an object keyed by provider id (see
// WorkerModelModal.jsx's identical handling). A flat array is only ever
// scoped to the worker's OWN reported `cli` — a worker can't self-report
// models for a provider it isn't currently running — so unlike
// WorkerModelModal.jsx (which is editing one specific worker and lets the
// user pick a different provider for that same worker mid-dialog), this
// merge-across-workers resolver must not attribute a flat array to any cli
// other than that worker's own.
function modelsForProvider(worker, cli) {
  if (!worker?.available_models) return null;
  if (!Array.isArray(worker.available_models)) {
    const raw = worker.available_models[cli];
    return Array.isArray(raw) && raw.length > 0 ? raw : null;
  }
  if (normalizeProviderId(worker.cli) !== cli) return null;
  return worker.available_models.length > 0 ? worker.available_models : null;
}

function modelId(entry) {
  return typeof entry === 'string' ? entry : entry?.id ?? null;
}

function firstLiveModelForProvider(cli, workers) {
  for (const w of workers) {
    const models = modelsForProvider(w, cli);
    if (models) {
      const id = modelId(models[0]);
      if (id) return id;
    }
  }
  return null;
}

// No provider configured at all — merge across every worker's own
// (self-reported) cli, first live model wins. Used only when the project
// has no configured primary.cli, so there's no "selected provider" to scope
// live discovery to yet.
function firstLiveModelAnyProvider(workers) {
  for (const w of workers) {
    if (!w?.cli) continue;
    const cli = normalizeProviderId(w.cli);
    const models = modelsForProvider(w, cli);
    if (models) {
      const id = modelId(models[0]);
      if (id) return { cli, model: id };
    }
  }
  return null;
}

/**
 * Resolves the default { cli, model } pair for a project, trying in order:
 *   1. The project's own configured default (`project.primary.cli`/`.model`
 *      — the nested `.laneconductor.json` shape — or `project.primary_cli`/
 *      `primary_model` — the flattened DB row shape used elsewhere in the UI;
 *      both are handled since different call sites are handed different
 *      shapes of `project`).
 *   2. A live-discovered model reported by any of the project's workers
 *      (track 1099) — for the configured provider if one is set, otherwise
 *      the first live model from any worker's own reported provider.
 *   3. The static registry's first ("recommended") entry for the resolved
 *      provider — `PROVIDERS[cli].models[0]`. Provider itself only falls
 *      back to 'claude' at this last tier, when nothing else determined one.
 */
export function getDefaultProviderModel(project, workers) {
  const workerList = Array.isArray(workers) ? workers : [];
  const configuredCli = normalizeProviderId(project?.primary?.cli ?? project?.primary_cli) || null;
  const configuredModel = project?.primary?.model ?? project?.primary_model ?? null;

  if (configuredCli && configuredModel) {
    return { cli: configuredCli, model: configuredModel };
  }

  if (configuredCli) {
    const liveModel = firstLiveModelForProvider(configuredCli, workerList);
    return { cli: configuredCli, model: liveModel || defaultModelFor(configuredCli) || PROVIDERS.claude.models[0].id };
  }

  const live = firstLiveModelAnyProvider(workerList);
  if (live) return live;

  return { cli: 'claude', model: defaultModelFor('claude') };
}
