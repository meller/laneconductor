// conductor/services/meta-defaults.mjs
// Track 10084: a meta-level shared config source that individual projects
// cascade from for `project.primary.cli`/`.model` and `conductor/workflow.json`-
// shaped settings, instead of every project independently configuring and
// verifying everything from scratch.
//
// Deliberately a NEW, dedicated file (conductor/meta-defaults.json) living
// inside the meta project's own on-disk folder
// (META_PROJECT_REPO_PATH/conductor/meta-defaults.json) — not the meta
// project's own .laneconductor.json, which describes the meta project's own
// identity/config as a project in its own right. Reusing that file to also
// mean "defaults published to every other project" would conflate two
// different concerns and risks the meta project silently inheriting its own
// published defaults.
//
// Pure-ish module: loadMetaDefaults() does one file read and never throws
// (missing file / malformed JSON both degrade to {}, mirroring how
// conductor/defaults.json already degrades in laneconductor.sync.mjs). The
// two merge functions are fully pure, DI'd, and independently testable —
// same pattern as config-root.mjs / lane-model-resolver.mjs.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { META_PROJECT_REPO_PATH } from './meta-project.mjs';

// LC_META_DEFAULTS_PATH lets tests (and an operator with an unusual
// filesystem layout) redirect this without touching the real meta project
// on disk — same override-seam pattern as LC_SKIP_GIT_LOCK elsewhere in
// this codebase.
export function resolveMetaDefaultsPath() {
  if (process.env.LC_META_DEFAULTS_PATH) return process.env.LC_META_DEFAULTS_PATH;
  return join(META_PROJECT_REPO_PATH, 'conductor', 'meta-defaults.json');
}

/**
 * Reads conductor/meta-defaults.json. Never throws — a missing file or
 * malformed JSON both mean "no meta defaults configured yet", not an error.
 * `path` is injectable (defaults to the real resolved path) so this is
 * testable against a real temp file without mocking module-level constants —
 * same DI pattern as config-root.mjs's resolvePrimaryRepoRoot parameter.
 * @param {string} [path]
 * @returns {{ project?: { primary?: { cli?: string, model?: string|null } }, workflow?: object }}
 */
export function loadMetaDefaults(path = resolveMetaDefaultsPath()) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * REQ-2: 5-tier precedence for project.primary.{cli,model} — CLI flags are
 * applied by the caller separately (they already win over everything, and
 * are in-memory-only per track 10011); this only resolves the remaining 4
 * tiers. Each tier only fills in what every higher tier left unset — a
 * project's own settings always win over the meta tier.
 *
 * @param {object} opts
 * @param {{ project?: { primary?: { cli?: string, model?: string|null } } }} opts.hardcoded
 * @param {{ project?: { primary?: { cli?: string, model?: string|null } } }} [opts.metaDefaults]
 * @param {{ project?: { primary?: { cli?: string, model?: string|null } } }} [opts.projectDefaults] - conductor/defaults.json, already-parsed
 * @param {{ project?: { primary?: { cli?: string, model?: string|null } } }} [opts.projectConfig] - .laneconductor.json, already-parsed
 * @param {boolean} [opts.inheritMetaDefaults] - project.inherit_meta_defaults, default true
 * @returns {{ cli: string, model: string|null|undefined }}
 */
export function mergeEffectivePrimary({
  hardcoded,
  metaDefaults = {},
  projectDefaults = {},
  projectConfig = {},
  inheritMetaDefaults = true,
} = {}) {
  const hardcodedPrimary = hardcoded?.project?.primary ?? {};
  const metaPrimary = inheritMetaDefaults ? (metaDefaults?.project?.primary ?? {}) : {};
  const projectDefaultsPrimary = projectDefaults?.project?.primary ?? {};
  const projectConfigPrimary = projectConfig?.project?.primary ?? {};

  return {
    cli: projectConfigPrimary.cli ?? projectDefaultsPrimary.cli ?? metaPrimary.cli ?? hardcodedPrimary.cli,
    model: projectConfigPrimary.model ?? projectDefaultsPrimary.model ?? metaPrimary.model ?? hardcodedPrimary.model,
  };
}

function mergeLanes(...layersLowestFirst) {
  const laneNames = new Set();
  for (const layer of layersLowestFirst) {
    for (const laneName of Object.keys(layer?.lanes || {})) laneNames.add(laneName);
  }
  const lanes = {};
  for (const laneName of laneNames) {
    lanes[laneName] = Object.assign({}, ...layersLowestFirst.map(l => l?.lanes?.[laneName] || {}));
  }
  return lanes;
}

/**
 * REQ-3: field-level deep merge for conductor/workflow.json-shaped configs,
 * keyed by lanes.<lane>.<key> and top-level global/defaults blocks —
 * replaces the old "return whichever whole file is found first" fallback.
 * A project's own lane's own key always wins over the same key at a lower
 * tier; a lane/key a higher tier doesn't mention falls through untouched.
 *
 * @param {object} opts
 * @param {object|null} [opts.projectWorkflow] - project's own conductor/workflow.json, already parsed
 * @param {object} [opts.metaWorkflow] - meta-defaults.json's `workflow` block
 * @param {object} [opts.globalCanonicalWorkflow] - install-path canonical conductor/workflow.json
 * @param {boolean} [opts.inheritMetaDefaults] - default true
 * @returns {object|null} null only when every source is empty
 */
export function mergeWorkflowConfig({
  projectWorkflow,
  metaWorkflow,
  globalCanonicalWorkflow,
  inheritMetaDefaults = true,
} = {}) {
  const project = projectWorkflow || {};
  const meta = inheritMetaDefaults ? (metaWorkflow || {}) : {};
  const canonical = globalCanonicalWorkflow || {};

  if (!projectWorkflow && !Object.keys(meta).length && !globalCanonicalWorkflow) return null;

  const layersLowestFirst = [canonical, meta, project];

  return {
    ...canonical,
    ...meta,
    ...project,
    lanes: mergeLanes(...layersLowestFirst),
    global: Object.assign({}, ...layersLowestFirst.map(l => l.global || {})),
    defaults: Object.assign({}, ...layersLowestFirst.map(l => l.defaults || {})),
  };
}
