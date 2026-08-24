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

// Track 1111 Phase 6 (REQ-6): opt-in, same-tier-only auto-update.
// Deliberately reuses `stale` entries findStaleLaneModels already computed
// and tested (Phase 5) rather than inventing a broader "a newer version
// exists even though the configured one still works" trigger — providers
// add new model IDs long before (if ever) removing old ones, so that
// broader trigger would fire far more often and wasn't part of what this
// pass scoped/tested. Only entries with a `suggested` same-tier
// replacement are ever applied; an entry with no suggestion (ambiguous —
// could be a typo or a discovery gap, see conversation.md's haiku-4.5
// example) is left as log-only, opted in or not.
export function applyStaleModelAutoUpdates(workflowConfig, staleEntries) {
  const applied = [];
  for (const entry of staleEntries) {
    if (!entry.suggested) continue;
    const laneConfig = workflowConfig?.lanes?.[entry.lane];
    if (!laneConfig) continue;
    laneConfig.primary_model = entry.suggested;
    applied.push({ lane: entry.lane, from: entry.model, to: entry.suggested });
  }
  return applied;
}

// Track 1111 Phase 6: the opt-in gate + apply + persist step, as one
// testable function with injected `writeFile`/`commit`/`logInfo` side
// effects — laneconductor.sync.mjs's refreshModels() calls this with real
// fs/git effects; tests inject fakes so the opt-out default (TC-9) and the
// same-tier-only, auditable-via-commit behavior (TC-10) can be verified
// without a real worker process. Default is OFF: `global.
// auto_update_stale_models` must be exactly `true` in workflow.json — a
// project that never sets it, or sets it false, is never auto-updated
// (REQ-6). A change is never a silent file rewrite: `commit` is always
// called alongside `writeFile` when anything was applied, so the change
// lands in workflow.json's own git history.
export function maybeAutoUpdateWorkflowModels({
  workflowConfig,
  staleEntries,
  writeFile = () => {},
  commit = () => {},
  logInfo = () => {},
} = {}) {
  if (workflowConfig?.global?.auto_update_stale_models !== true) return [];
  const applied = applyStaleModelAutoUpdates(workflowConfig, staleEntries);
  if (applied.length === 0) return applied;

  writeFile(JSON.stringify(workflowConfig, null, 2) + '\n');
  const summary = applied.map(a => `${a.lane}: ${a.from} → ${a.to}`).join(', ');
  commit(`chore(workflow): auto-update stale primary_model (${summary})`);
  logInfo(applied, summary);
  return applied;
}
