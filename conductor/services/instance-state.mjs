// conductor/services/instance-state.mjs
// Track 10069 Phase 1 (REQ-12): a single, deterministic snapshot of "what
// does this instance look like right now" — one authoritative source for
// `lc state --json`, `GET /api/state`, the setup-gap gate (setup-gaps.mjs),
// and the manager chat digest (D3). No LLM, no I/O of its own: every input
// is already-fetched data, so the same function serves a filesystem-only
// local-fs project and a DB-backed multi-project instance without knowing
// the difference.
//
// Pure module, no I/O — mirrors orphan-worker-detection.mjs's extraction
// style.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { isWorkerOffline } from '../../ui/src/lib/workerStatus.js';

/**
 * @param {object} input
 * @param {Array<{id: string|number, name: string, repo_path: string}>} input.projects
 * @param {Array<{project_id: string|number, track_number: string, lane: string}>} input.tracks
 *   - one row per track, already resolved to its current lane (whatever the
 *     caller's source of truth is: index.md markers for local-fs, lane_status
 *     column for DB-backed)
 * @param {Array<{id: string|number, hostname: string, type: string,
 *   project_id: string|number|null, current_task: string|null,
 *   last_heartbeat: string|null}>} input.workers - already visibility-scoped
 *   by the caller (same filter GET /api/workers applies) — this module does
 *   not know about auth
 * @param {Record<string|number, {primary_cli: string|null, primary_ok: boolean|null,
 *   secondary_cli: string|null, secondary_ok: boolean|null}>} [input.providers] -
 *   keyed by project id; omitted entries are treated as unconfigured
 * @param {number} [input.now] - injected clock (ms since epoch), defaults to Date.now()
 * @returns {{
 *   projects: Array<{id: string|number, name: string, repo_path: string,
 *     tracksByLane: Record<string, number>, workerCount: number}>,
 *   workers: Array<{id: string|number, hostname: string, type: string,
 *     project_id: string|number|null, current_task: string|null,
 *     last_heartbeat: string|null, online: boolean}>,
 *   providers: Record<string|number, object>,
 *   generatedAt: string,
 * }}
 */
export function buildInstanceState({ projects = [], tracks = [], workers = [], providers = {}, now = Date.now() } = {}) {
  const workersWithOnline = workers.map(w => ({
    ...w,
    online: !isWorkerOffline({ last_heartbeat: w.last_heartbeat }, now),
  }));

  const workerCountByProject = new Map();
  for (const w of workersWithOnline) {
    if (w.project_id == null) continue;
    workerCountByProject.set(w.project_id, (workerCountByProject.get(w.project_id) ?? 0) + 1);
  }

  const tracksByProject = new Map();
  for (const t of tracks) {
    if (!tracksByProject.has(t.project_id)) tracksByProject.set(t.project_id, {});
    const byLane = tracksByProject.get(t.project_id);
    const lane = t.lane || 'unknown';
    byLane[lane] = (byLane[lane] ?? 0) + 1;
  }

  const projectSnapshots = projects.map(p => ({
    id: p.id,
    name: p.name,
    repo_path: p.repo_path,
    tracksByLane: tracksByProject.get(p.id) ?? {},
    workerCount: workerCountByProject.get(p.id) ?? 0,
  }));

  return {
    projects: projectSnapshots,
    workers: workersWithOnline,
    providers,
    generatedAt: new Date(now).toISOString(),
  };
}

/**
 * D3's compact digest — a deterministic, non-LLM projection of the
 * snapshot, injected into a manager session's opening turn (Phase 5's
 * REQ-14). Bounded to a hard character budget (TC-1.7) so it stays cheap
 * at realistic scale.
 *
 * @param {ReturnType<typeof buildInstanceState>} state
 * @param {number} [maxChars]
 * @returns {string}
 */
export function buildStateDigest(state, maxChars = 900) {
  const lines = [`LaneConductor instance snapshot (${state.generatedAt}):`];
  for (const p of state.projects) {
    const laneCounts = Object.entries(p.tracksByLane)
      .map(([lane, count]) => `${lane}:${count}`)
      .join(' ');
    lines.push(`- ${p.name} (project ${p.id}): ${laneCounts || 'no tracks'}; workers=${p.workerCount}`);
  }
  const onlineWorkers = state.workers.filter(w => w.online).length;
  lines.push(`Workers: ${onlineWorkers}/${state.workers.length} online.`);
  lines.push('Call `lc state --json` for the full snapshot (worker detail, provider status, gaps).');

  let digest = lines.join('\n');
  if (digest.length > maxChars) {
    digest = digest.slice(0, maxChars - 3) + '...';
  }
  return digest;
}

/**
 * Convenience helper for building the instance state digest from local filesystem
 * without requiring direct DB connection.
 */
export function buildLocalStateDigest({ projectRoot = process.cwd(), project = null, now = Date.now(), maxChars = 900 } = {}) {
  const pId = project?.id ?? 1;
  const pName = project?.name ?? basename(projectRoot);
  const projects = [{ id: pId, name: pName, repo_path: projectRoot }];
  const tracks = [];
  const tracksDir = join(projectRoot, 'conductor', 'tracks');
  if (existsSync(tracksDir)) {
    for (const d of readdirSync(tracksDir)) {
      if (!/\d+/.test(d) || d.startsWith('_duplicate-') || d.startsWith('_quarantine-')) continue;
      const indexPath = join(tracksDir, d, 'index.md');
      if (existsSync(indexPath)) {
        try {
          const content = readFileSync(indexPath, 'utf8');
          const laneMatch = content.match(/\*\*Lane\*\*:\s*([^\n]+)/i);
          const lane = laneMatch ? laneMatch[1].trim().toLowerCase() : 'backlog';
          const trackNumMatch = d.match(/(\d+)/);
          tracks.push({
            project_id: pId,
            track_number: trackNumMatch ? trackNumMatch[1] : d,
            lane,
          });
        } catch { /* skip unreadable */ }
      }
    }
  }
  const workers = [{
    id: 1,
    hostname: 'local',
    type: 'worker',
    project_id: pId,
    current_task: null,
    last_heartbeat: new Date(now).toISOString(),
    online: true,
  }];
  const state = buildInstanceState({ projects, tracks, workers, now });
  return buildStateDigest(state, maxChars);
}

