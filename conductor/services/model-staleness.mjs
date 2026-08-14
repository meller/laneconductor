#!/usr/bin/env node
// conductor/services/model-staleness.mjs
// Track 1111 Phase 5: workflow.json's per-lane `primary_model` strings are
// hardcoded literal model IDs (populated by Phase 1/4) — nothing previously
// noticed when a provider ships a newer version and one of those strings
// stops being current. 1099 already discovers what's currently available
// per worker (cachedModels, reported as workers.available_models); this
// module just compares the two, so a mismatch can be logged instead of
// silently ignored (REQ-5).
//
// "Stale" here means two different things, both worth surfacing but
// distinguished so the log line can say which: the configured model might
// (a) simply be gone from what this worker can currently use, with no
// obvious same-tier successor found either — provider access change, typo,
// or discovery gap (see track 1111's own conversation.md for a live
// example: claude-haiku-4-5 exists but wasn't in this worker's discovered
// list) — or (b) be gone AND a newer same-tier model IS present, which is
// the "ship a newer version" case REQ-6's auto-update (if ever built)
// would act on. Exact-string absence alone only proves (a); this also
// checks for (b) via a same-tier match.

const TIERS = ['opus', 'sonnet', 'haiku', 'fable'];

function tierOf(modelId) {
  if (!modelId) return null;
  const lower = modelId.toLowerCase();
  return TIERS.find(t => lower.includes(t)) ?? null;
}

// laneCliResolver: (laneConfig, proj) => cli — defaults to the same
// project-wide-fixed rule buildCliArgs/resolveLaneCliAndModel use (REQ-3:
// provider never varies per lane), kept as a parameter only so a caller
// with a different resolution need isn't forced to duplicate this file.
export function findStaleLaneModels({ workflowConfig, proj = {}, cachedModels = {} } = {}) {
  const stale = [];
  const lanes = workflowConfig?.lanes ?? {};
  for (const [laneName, laneConfig] of Object.entries(lanes)) {
    const model = laneConfig?.primary_model;
    if (!model) continue;
    const cli = proj.primary?.cli ?? 'claude';
    const available = cachedModels?.[cli] ?? [];
    const availableIds = available.map(m => m.id);
    if (availableIds.includes(model)) continue; // current — nothing to report

    const tier = tierOf(model);
    const suggested = tier ? (available.find(m => tierOf(m.id) === tier)?.id ?? null) : null;
    stale.push({ lane: laneName, cli, model, tier, suggested });
  }
  return stale;
}

export function formatStaleLaneModelWarning({ lane, cli, model, suggested }) {
  return suggested
    ? `[workflow] lane '${lane}' configures primary_model '${model}' (${cli}), which is not in the currently discovered available_models — a same-tier newer model IS available: '${suggested}'. Consider updating conductor/workflow.json.`
    : `[workflow] lane '${lane}' configures primary_model '${model}' (${cli}), which is not in the currently discovered available_models, and no same-tier replacement was found either — verify this model ID is still valid.`;
}
