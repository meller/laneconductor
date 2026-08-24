#!/usr/bin/env node
// conductor/services/lane-model-resolver.mjs
// Track 1111 Phase 1/3: the precedence rule for "which model/cli does an
// automated lane action use" — extracted out of buildCliArgs
// (laneconductor.sync.mjs) purely so it's unit-testable without spawning a
// process, same reasoning track 1087 extracted buildClaudeArgs into its own
// module. Provider (`cli`) stays project-wide fixed by design (REQ-3 —
// session continuity via --resume is provider-specific); only the model is
// meant to vary per lane, which is why `primary_cli` is deliberately NOT
// read from laneConfig here even though it's a symmetric-looking omission —
// see loadWorkflowConfig's stripLanePrimaryCli guard, which removes any
// `primary_cli` a lane config might contain before this function ever sees
// it. A lane's `primary_model`, when set, wins over the project's default/
// manually-overridden model (REQ-2) — a manual "Change Model" override
// (track 1096's set_model dispatch, persisted into proj.primary.model)
// only applies when the current lane has no `primary_model` of its own.

// Track 1116 REQ-7: adds a track-level tier on top of 1111's lane/project
// precedence — `track.model` (sourced from the track's own `**Model**:`
// index.md marker) wins over the lane's `primary_model`, which still wins
// over the project default. `track` is optional and defaults to `{}` so
// every existing call site (none of which pass it) is unaffected.
export function resolveLaneCliAndModel({ laneConfig = {}, proj = {}, track = {} } = {}) {
  const cli = proj.primary?.cli ?? 'claude';
  const model = track.model ?? laneConfig.primary_model ?? proj.primary?.model;
  return { cli, model };
}

// Track 1111 Phase 1 Task 5 (REQ-3 guard): without this, a stray per-lane
// `primary_cli` in workflow.json WOULD silently override the provider
// mid-track — breaking `--resume` session continuity (provider is
// Claude-specific, see track 1086). Only `primary_model` is meant to vary
// per lane; the provider is a project-wide fixed choice. Strips (doesn't
// just warn about) any `primary_cli` found on a lane, mutating and
// returning the same config object, so a stray config value can never be
// silently honored downstream even if the warning goes unnoticed.
export function stripLanePrimaryCli(config, warn = console.warn) {
  if (!config?.lanes) return config;
  for (const [laneName, laneConfig] of Object.entries(config.lanes)) {
    if (laneConfig && Object.prototype.hasOwnProperty.call(laneConfig, 'primary_cli')) {
      warn(`[config] workflow.json lanes.${laneName}.primary_cli is not supported — provider must stay fixed project-wide (REQ-3). Ignoring it.`);
      delete laneConfig.primary_cli;
    }
  }
  return config;
}
