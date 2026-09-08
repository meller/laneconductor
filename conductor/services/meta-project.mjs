// conductor/services/meta-project.mjs
// Track 1091 Phase 7: the manager's pseudo-track conversation lives inside
// a specific project's own repo (conductor/tracks/manager/), but "Create
// with chat" needs somewhere to have that conversation BEFORE any real
// project exists (a brand-new install, zero projects registered) or when
// no concrete project is currently selected ("All Projects"). Rather than
// building a second, project-independent storage mechanism, this ensures
// one fixed, always-there project exists to be that home.
//
// Filesystem-first, no DB dependency — works in every mode, including
// local-fs (no DB, no API server), and is callable directly from the
// `/laneconductor` skill or `lc` CLI, not just the web UI's API server.
// DB registration (when running in a DB-backed mode) is the caller's own,
// separate, secondary concern — see ui/server/index.mjs's
// POST /api/meta-project/ensure for that half.
//
// Lives under the manager's own configured projects directory (decided
// live 2026-09-08) — the same base folder `lc worker start --manager
// --projects-dir <path>` clones every other project into (persisted at
// ~/.laneconductor/manager-config.json, read the same way
// laneconductor.sync.mjs's own manager-projects-dir lookup does) — rather
// than a separate, hidden location. Falls back to the home directory when
// no projects directory has been configured yet.

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { ensureManagerPseudoTrack } from './manager-pseudo-track.mjs';

export const META_PROJECT_NAME = 'LaneConductor Meta';

function resolveProjectsDir() {
  const configPath = join(os.homedir(), '.laneconductor', 'manager-config.json');
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    if (config.projectsDir) return config.projectsDir;
  } catch { /* not configured yet — fall back below */ }
  return os.homedir();
}

export const META_PROJECT_REPO_PATH = join(resolveProjectsDir(), 'laneconductor-meta');

/**
 * Ensures the meta project's directory and manager pseudo-track structure
 * exist on disk. Idempotent — safe to call every time. Returns the path.
 */
export function ensureMetaProjectOnDisk() {
  if (!existsSync(META_PROJECT_REPO_PATH)) {
    mkdirSync(META_PROJECT_REPO_PATH, { recursive: true });
  }
  ensureManagerPseudoTrack(META_PROJECT_REPO_PATH);
  return META_PROJECT_REPO_PATH;
}
