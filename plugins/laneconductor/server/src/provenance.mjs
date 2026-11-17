// REQ-10/11/12: provenance, freshness and the one-line summary. The freshness rules are the spec's,
// fixed and deterministic so tests can pin them.
import { fail } from './errors.mjs';

const HOUR = 3600_000;
const DAY = 24 * HOUR;

export function computeFreshness({ backend = 'local', dirtyPaths = [], upstream = null, now, cache = null, headTime = null }) {
  const stale = [];
  const possibly = [];
  if (upstream && upstream.behind > 0) stale.push('behind_upstream');
  if (cache?.rate_limited) stale.push('served_from_cache_rate_limited');
  if (upstream && upstream.ahead > 0) possibly.push('unpushed_local_commits');
  if (upstream) {
    const t = upstream.lastFetchAt ? Date.parse(upstream.lastFetchAt) : NaN;
    if (!Number.isFinite(t) || now - t > HOUR) possibly.push('last_fetch_older_than_1h');
  } else if (backend === 'local') {
    possibly.push('no_upstream');
  }
  if (dirtyPaths.length > 0) possibly.push('dirty_state_files');
  if (backend === 'github' && headTime && now - Date.parse(headTime) > DAY) possibly.push('remote_head_older_than_24h');
  if (cache && cache.age_s > 60) possibly.push('cache_age_over_60s');
  const reasons = [...stale, ...possibly];
  const freshness = stale.length ? 'stale' : possibly.length ? 'possibly_stale' : 'fresh';
  return { freshness, stale_reasons: reasons };
}

export function formatAge(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function provenanceLine(p, now) {
  const short = p.commit ? p.commit.slice(0, 7) : 'no commits';
  const tree = p.dirty_paths?.length ? `${p.dirty_paths.length} uncommitted state file${p.dirty_paths.length === 1 ? '' : 's'}` : 'clean';
  let up;
  if (p.upstream) {
    const fetched = p.upstream.last_fetch_at ? `last fetch ${formatAge(now - Date.parse(p.upstream.last_fetch_at))} ago` : 'never fetched';
    up = `${p.upstream.ref}: ahead ${p.upstream.ahead}, behind ${p.upstream.behind}; ${fetched}`;
  } else {
    up = 'no upstream';
  }
  const base = `LaneConductor state as of ${short} on ${p.branch} (${p.backend}, ${tree}); ${up}.`;
  return p.freshness === 'fresh' ? base : `${base} Freshness: ${p.freshness} (${p.stale_reasons.join(', ')}).`;
}

/** Builds the provenance block for a response from any StateStore. */
export async function buildProvenance(store, { now = Date.now() } = {}) {
  const desc = store.describe();
  let head;
  let fr;
  try {
    head = await store.head();
    fr = await store.freshness();
  } catch (err) {
    throw err.code ? err : fail('BACKEND_UNAVAILABLE', `Could not read repository state: ${err.message}`);
  }
  const { freshness, stale_reasons } = computeFreshness({
    backend: desc.backend, dirtyPaths: fr.dirtyPaths, upstream: fr.upstream, now, cache: fr.cache ?? null, headTime: head.commitTime,
  });
  const p = {
    backend: desc.backend,
    repo: desc.repo,
    branch: desc.branch,
    commit: head.commit,
    commit_time: head.commitTime,
    read_at: new Date(now).toISOString(),
    dirty_paths: fr.dirtyPaths,
    upstream: fr.upstream
      ? { ref: fr.upstream.ref, ahead: fr.upstream.ahead, behind: fr.upstream.behind, last_fetch_at: fr.upstream.lastFetchAt }
      : null,
    cache: fr.cache ?? { served_from_cache: false, age_s: 0 },
    freshness,
    stale_reasons,
    ...(fr.checkoutBranch && fr.checkoutBranch !== desc.branch ? { checkout_branch: fr.checkoutBranch } : {}),
  };
  p.line = provenanceLine(p, now);
  return p;
}

/** Adds tool-level reasons (e.g. a regenerated summary) to a provenance block, at least `possibly_stale`. */
export function withReasons(p, reasons, now) {
  const extra = reasons.filter((r) => !p.stale_reasons.includes(r));
  if (!extra.length) return p;
  const next = { ...p, stale_reasons: [...p.stale_reasons, ...extra], freshness: p.freshness === 'stale' ? 'stale' : 'possibly_stale' };
  next.line = provenanceLine(next, now);
  return next;
}
