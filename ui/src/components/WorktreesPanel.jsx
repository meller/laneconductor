import { useState, useEffect, useCallback, useRef } from 'react';
import { useApi } from '../hooks/useApi.js';
import { computeWorktreeStats } from '../lib/worktreeStats.js';
import { nextArmedState } from '../lib/armedConfirm.js';
import { removeKey, mergeKey, completeKey, forceKey, discardKey, aiResolveKey, computeStaleKeys } from '../lib/worktreePendingKeys.js';

const REC_STYLE = {
  warning: 'bg-amber-950/30 border-amber-800/60 text-amber-300',
  action: 'bg-blue-950/30 border-blue-800/60 text-blue-300',
  info: 'bg-gray-900 border-gray-800 text-gray-400',
};
const REC_ICON = { warning: '⚠', action: '→', info: 'ℹ' };

const CLASS_LABEL = { stranded: 'Stranded', conflicted: 'Conflicted', mergeable: 'Mergeable', open: 'Open', detached: 'Detached' };
const CLASS_DOT = { stranded: 'bg-red-500', conflicted: 'bg-amber-500', mergeable: 'bg-green-500', open: 'bg-gray-500', detached: 'bg-purple-500' };

function WorktreeStatsHeader({ rows, onRefresh, refreshing }) {
  const stats = computeWorktreeStats(rows);
  if (stats.total === 0) return null;
  return (
    <div className="flex flex-col gap-3 mb-2" data-testid="worktree-stats-header">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold text-gray-100">{stats.total}</span>
          <span className="text-xs text-gray-500 uppercase tracking-wider font-bold">Worktrees</span>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {Object.entries(stats.counts).filter(([, n]) => n > 0).map(([cls, n]) => (
            <span key={cls} className="flex items-center gap-1.5 text-xs text-gray-400">
              <span className={`w-2 h-2 rounded-full ${CLASS_DOT[cls]}`} />
              {n} {CLASS_LABEL[cls]}
            </span>
          ))}
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={refreshing}
            data-testid="refresh-worktrees-btn"
            title="Force a fresh git audit — the server cache normally only re-checks every 60s, so this catches worktrees/branches removed outside this panel (e.g. via git directly) immediately"
            className="text-[10px] px-2.5 py-1 border rounded font-bold uppercase tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed border-gray-700 bg-gray-900 text-gray-400 hover:bg-gray-800 hover:text-gray-200 ml-auto"
          >
            {refreshing ? 'Refreshing…' : '↻ Refresh'}
          </button>
        )}
        {stats.totalDirty > 0 && (
          <span className="text-[11px] text-gray-600 ml-auto">
            {stats.totalDirty} dirty file{stats.totalDirty === 1 ? '' : 's'} total across all worktrees
          </span>
        )}
      </div>
      {stats.recommendations.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {stats.recommendations.map((rec, i) => (
            <div key={i} className={`text-xs px-3 py-1.5 rounded-lg border flex items-center gap-2 ${REC_STYLE[rec.level]}`}>
              <span className="shrink-0">{REC_ICON[rec.level]}</span>
              <span>{rec.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Track 1114 (found live): `window.confirm()` never surfaced in this
// app's runtime — clicking "Remove worktree" produced zero dispatch, zero
// error, zero visible feedback ("nothing happens"), confirmed by checking
// worker_dispatch directly after a real click: no new row at all, meaning
// the click handler ran but exited at the (silently-failing) confirm gate.
// Two-step in-DOM confirm instead of a native dialog — first click arms
// it (distinct label/color, auto-disarms after 4s if not confirmed),
// second click while armed actually fires. No dependency on a browser
// API that may not be reliable in every embedding context.
function useArmedConfirm() {
  const [armedKey, setArmedKey] = useState(null);
  const timerRef = useRef(null);
  const request = (key, action) => {
    clearTimeout(timerRef.current);
    const { armedKey: next, shouldFire } = nextArmedState(armedKey, key);
    setArmedKey(next);
    if (shouldFire) {
      action();
    } else {
      timerRef.current = setTimeout(() => setArmedKey(null), 4000);
    }
  };
  return { armedKey, request };
}

// Track 1112 Phase 7: project-level worktree visibility, WorkersList.jsx's
// grid-layout pattern. Primary surface for "N unmerged branches, nobody
// noticed" — a per-track-only view would need clicking into every track to
// see the same thing (see TrackDetailPanel's inline strip for that
// secondary, detail-level view of this same data).

const CLASS_BADGE = {
  stranded: { label: 'Stranded', icon: '🔴', className: 'bg-red-950/40 text-red-300 border-red-800/80' },
  conflicted: { label: 'Conflicted', icon: '🟠', className: 'bg-amber-950/40 text-amber-300 border-amber-800/80' },
  mergeable: { label: 'Mergeable', icon: '🟢', className: 'bg-green-950/40 text-green-300 border-green-800/80' },
  open: { label: 'Open', icon: '⚪', className: 'bg-gray-900 text-gray-400 border-gray-800' },
  detached: { label: 'Detached', icon: '🟣', className: 'bg-purple-950/40 text-purple-300 border-purple-800/80' },
};

// stranded -> conflicted -> mergeable -> open, per the design decision —
// the rows that need a human's attention float to the top.
const CLASS_SORT_ORDER = { stranded: 0, conflicted: 1, mergeable: 2, detached: 3, open: 4 };

// Track 1114 Phase 18a: Phase 17's getConflictPaths() already computes
// this list to decide the `conflicted` classification — was discarded
// right after. Surfacing it here is the only new data; resolving is left
// to the human (or Phase 18b's AI-resolve action) — this block never
// mutates anything itself. Once genuinely resolved and pushed, the next
// audit cycle reclassifies the row `mergeable` on its own; no separate
// "I'm done" action needed.
function ConflictDetails({ row }) {
  const [copied, setCopied] = useState(false);
  const paths = row.conflict_paths || [];
  const snippet = [
    `cd "${row.worktree_path || `.worktrees/${row.track}`}"`,
    'git fetch origin',
    'git merge origin/main',
    '# resolve the conflicts below, then:',
    'git add -A && git commit',
    `git push origin ${row.branch || `track-${row.track}`}`,
  ].join('\n');

  return (
    <div className="text-[11px] bg-amber-950/10 border border-amber-900/40 rounded-lg p-2.5 flex flex-col gap-1.5">
      <span className="text-amber-400 font-bold uppercase tracking-wider text-[10px]">
        Conflicts with main {paths.length > 0 ? `(${paths.length} file${paths.length === 1 ? '' : 's'})` : ''}
      </span>
      {paths.length > 0 ? (
        <ul className="font-mono text-gray-400 leading-relaxed max-h-20 overflow-y-auto">
          {paths.map(p => <li key={p} className="truncate">{p}</li>)}
        </ul>
      ) : (
        <span className="text-gray-500">File list unavailable — restart the worker or wait for the next refresh to pick up Phase 18a.</span>
      )}
      <button
        onClick={() => {
          navigator.clipboard?.writeText(snippet).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          });
        }}
        data-testid="copy-resolve-commands-btn"
        title="Copies a git command sequence to check out the worktree, merge main, and resolve locally"
        className="self-start text-[10px] px-2 py-0.5 border border-gray-700 bg-gray-900 text-gray-400 hover:bg-gray-800 hover:text-gray-200 rounded font-bold uppercase tracking-wider transition-colors"
      >
        {copied ? 'Copied!' : 'Copy resolve commands'}
      </button>
    </div>
  );
}

function WorktreeRow({ row, onMerge, merging, onSelectTrack, onRemove, removing, onAutoComplete, autoCompleting, onForceMerge, forceMerging, onDiscard, discarding, onAiResolve, aiResolving }) {
  const { armedKey, request } = useArmedConfirm();
  const badge = CLASS_BADGE[row.class] || CLASS_BADGE.open;
  const canMerge = row.class === 'mergeable' || row.class === 'stranded';
  const isConflicted = row.class === 'conflicted';
  // Track 1114: initially scoped to `detached` only, widened after
  // finding real backlog-lane rows in this repo's own data — they turned
  // out to be leftover test fixtures from this project's own concurrency/
  // E2E suite (track-10000/10001/10002: real git branches+worktrees the
  // tests create for isolation, not always cleaned up after). No reason
  // to gate by class at all: `git worktree remove --force` only ever
  // discards that worktree's own uncommitted changes, never the branch
  // or its commits, regardless of what class the row is. The risk (and
  // the confirm text) scales with class, not availability.
  //
  // Found live: gating on `row.worktree_path || row.branch` kept the
  // button showing for rows whose worktree was ALREADY removed (branch
  // alone doesn't mean a live worktree exists — an `open` row's branch
  // persists after its worktree is gone, since remove-worktree only ever
  // deletes the working directory, never the branch). Clicking it then
  // just fails with "not-found" every time — confusing, since nothing
  // about the row visually signals there's nothing left to remove.
  // worktree_path alone is the real signal.
  const canRemove = Boolean(row.worktree_path);
  // Complete & Merge is for rows still genuinely mid-pipeline (`open`
  // with a real track) — mergeable/stranded already have their own
  // direct "Merge to main"; conflicted needs manual resolution first;
  // detached has no track to run lane actions against at all.
  const canAutoComplete = row.class === 'open' && row.track;
  // Track 1114: explicitly requested — "not recommended, but allow it."
  // Skips review/quality-gate's real verification entirely; distinct from
  // Complete & Merge, which runs them for real. Same `open`+track gate.
  const canForceMerge = row.class === 'open' && row.track;
  // Track 1114 Phase 15: any row with a real track can be discarded —
  // unlike Complete/Force Merge this is deliberately NOT gated to `open`;
  // a `mergeable`/`stranded` track can just as legitimately turn out to
  // be unwanted work someone decided not to ship. `conflicted` can be
  // discarded too — there's nothing to resolve if it's never merging.
  // `detached` has no track to move to backlog against.
  const canDiscard = Boolean(row.track);
  // Track 1114 Phase 18b: only a real content conflict with a live
  // worktree to run the merge in — Phase 17 already auto-resolves the
  // bookkeeping-only case, so a `conflicted` row reaching here is
  // genuinely one AI resolution could help with.
  const canAiResolve = isConflicted && row.track && row.worktree_path;
  // A row's five actions can conflict with each other (e.g. force-merging
  // while a Complete & Merge sequence is still running) — while ANY one
  // is pending for this row, the rest are disabled too, not just the one
  // that was clicked.
  const rowBusy = merging || removing || autoCompleting || forceMerging || discarding || aiResolving;

  return (
    <div
      className={`border rounded-xl p-4 flex flex-col gap-3 transition-colors shadow-sm ${row.class === 'stranded' ? 'bg-red-950/10 border-red-900/50' : 'bg-gray-900 border-gray-800 hover:border-gray-700'
        }`}
      data-testid="worktree-row"
    >
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="flex items-center gap-2">
            {/* Track 1114: each row maps 1:1 to a track — clicking should
                jump straight there, same pattern as the Workers view's
                current-task deep link. Rows with no track (detached
                scratch worktrees) aren't linkable. */}
            {row.track && onSelectTrack ? (
              <button
                onClick={() => onSelectTrack(row.track)}
                className="font-semibold text-gray-200 hover:text-blue-400 hover:underline"
                title="Open this track"
              >
                #{row.track} ↗
              </button>
            ) : (
              <span className="font-semibold text-gray-200">{row.track ? `#${row.track}` : row.branch || 'unknown'}</span>
            )}
            {row.host && (
              <span className="text-[9px] font-mono text-gray-600 bg-black/30 px-1.5 py-0.5 rounded border border-gray-800">
                {row.host}
              </span>
            )}
          </div>
          {row.title && <span className="text-xs text-gray-400 truncate">{row.title}</span>}
        </div>
        <span className={`flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border shrink-0 ${badge.className}`}>
          <span>{badge.icon}</span>
          <span>{badge.label}</span>
        </span>
      </div>

      <div className="grid grid-cols-4 gap-2 text-center">
        <div className="flex flex-col">
          <span className="text-[9px] text-gray-600 uppercase font-bold">Lane</span>
          <span className="text-[11px] text-gray-300">{row.lane ? `${row.lane}:${row.lane_status ?? '?'}` : '—'}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[9px] text-gray-600 uppercase font-bold">Ahead</span>
          <span className="text-[11px] text-gray-300 font-mono">{row.ahead ?? '—'}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[9px] text-gray-600 uppercase font-bold">Behind</span>
          <span className="text-[11px] text-gray-300 font-mono">{row.behind ?? '—'}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[9px] text-gray-600 uppercase font-bold">Dirty</span>
          <span className="text-[11px] text-gray-300 font-mono">{row.dirty ?? '—'}</span>
        </div>
      </div>

      {isConflicted && (
        <ConflictDetails row={row} />
      )}

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-800/50 flex-wrap">
        {canAutoComplete && (
          <button
            onClick={() => request(`complete:${row.track}`, () => onAutoComplete(row))}
            disabled={rowBusy}
            data-testid="complete-and-merge-btn"
            title="Runs this track's remaining lane actions for real (review, quality-gate, ...) and merges once it reaches done:success. Stops and leaves it for you if any stage genuinely fails — no auto-retry."
            className={`text-[10px] px-2.5 py-1 border rounded font-bold uppercase tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${armedKey === `complete:${row.track}`
              ? 'border-blue-500 bg-blue-800/60 text-white'
              : 'border-blue-800/60 bg-blue-950/30 text-blue-300 hover:bg-blue-900/40'
              }`}
          >
            {autoCompleting ? 'Running…' : armedKey === `complete:${row.track}` ? 'Click again to run' : 'Complete & merge'}
          </button>
        )}
        {canForceMerge && (
          <button
            onClick={() => request(`force:${row.track}`, () => onForceMerge(row))}
            disabled={rowBusy}
            data-testid="force-merge-btn"
            title="Marks this track done and merges it WITHOUT running review or quality-gate — not recommended. Only the branch's own uncommitted-work risk applies; use Complete & Merge instead unless you specifically want to skip verification."
            className={`text-[10px] px-2.5 py-1 border rounded font-bold uppercase tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${armedKey === `force:${row.track}`
              ? 'border-amber-400 bg-amber-800/60 text-white'
              : 'border-amber-800/60 bg-amber-950/30 text-amber-400 hover:bg-amber-900/40'
              }`}
          >
            {forceMerging ? 'Merging…' : armedKey === `force:${row.track}` ? 'Click again to skip checks' : 'Force merge (skip checks)'}
          </button>
        )}
        {canMerge && (
          <button
            onClick={() => onMerge(row)}
            disabled={rowBusy}
            data-testid="merge-to-main-btn"
            className="text-[10px] px-2.5 py-1 border border-green-800/60 bg-green-950/30 text-green-300 hover:bg-green-900/40 disabled:opacity-50 disabled:cursor-not-allowed rounded font-bold uppercase tracking-wider transition-colors"
          >
            {merging ? 'Merging…' : 'Merge to main'}
          </button>
        )}
        {isConflicted && (
          <span
            className="text-[10px] px-2.5 py-1 border border-gray-800 text-gray-600 rounded font-bold uppercase tracking-wider cursor-not-allowed"
            title="This branch conflicts with main — resolve locally (see the file list above) or try AI resolve"
          >
            Merge to main
          </span>
        )}
        {canAiResolve && (
          <button
            onClick={() => request(`ai-resolve:${row.track}`, () => onAiResolve(row))}
            disabled={rowBusy}
            data-testid="ai-resolve-conflict-btn"
            title="Runs a real merge in this worktree and has an AI session resolve the conflict markers, then merges — review the resulting merge commit afterward, this is not guaranteed correct."
            className={`text-[10px] px-2.5 py-1 border rounded font-bold uppercase tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${armedKey === `ai-resolve:${row.track}`
              ? 'border-purple-400 bg-purple-800/60 text-white'
              : 'border-purple-800/60 bg-purple-950/30 text-purple-300 hover:bg-purple-900/40'
              }`}
          >
            {aiResolving ? 'Resolving…' : armedKey === `ai-resolve:${row.track}` ? 'Click again — review after' : 'AI resolve conflict'}
          </button>
        )}
        {canDiscard && (
          <button
            onClick={() => request(`discard:${row.track}`, () => onDiscard(row))}
            disabled={rowBusy}
            data-testid="discard-track-btn"
            title="Removes the worktree (branch/commits stay recoverable) and moves this track to backlog with an abandonment note — never merges it. Use when the work is genuinely not wanted, not just paused."
            className={`text-[10px] px-2.5 py-1 border rounded font-bold uppercase tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${armedKey === `discard:${row.track}`
              ? 'border-slate-400 bg-slate-700/60 text-white'
              : 'border-slate-700 bg-slate-900/40 text-slate-400 hover:bg-slate-800/50'
              }`}
          >
            {discarding ? 'Discarding…' : armedKey === `discard:${row.track}` ? 'Click again to discard' : 'Discard (no merge)'}
          </button>
        )}
        {canRemove && (
          <button
            onClick={() => request(`remove:${row.worktree_path || row.branch}`, () => onRemove(row))}
            disabled={rowBusy}
            data-testid="remove-worktree-btn"
            title="Discards this worktree's uncommitted changes — the branch/commits (if any) are not deleted"
            className={`text-[10px] px-2.5 py-1 border rounded font-bold uppercase tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${armedKey === `remove:${row.worktree_path || row.branch}`
              ? 'border-red-500 bg-red-800/60 text-white'
              : 'border-red-900/60 bg-red-950/20 text-red-400 hover:bg-red-900/30'
              }`}
          >
            {removing ? 'Removing…' : armedKey === `remove:${row.worktree_path || row.branch}` ? 'Click again to remove' : 'Remove worktree'}
          </button>
        )}
      </div>
    </div>
  );
}

// Track 1114 Phase 6 (found live: "removing in progress needs to show so
// we can't push anything twice"): the four actions in this panel are all
// async dispatches a worker processes over seconds-to-minutes, but the
// UI's busy state previously only covered the POST call itself — a
// fraction of a second. A user had no way to tell a dispatch was actually
// still running, and could re-click and create a duplicate/conflicting
// one on the same row. Pending keys now persist until the row's real
// outcome shows up in the next poll (or a bounded timeout, so a button
// never gets stuck disabled forever if something goes wrong client-side).
const PENDING_TIMEOUT_MS = 3 * 60 * 1000;

function usePendingActions() {
  const [pending, setPending] = useState({}); // key -> timer id
  const start = (key) => {
    setPending(prev => {
      if (prev[key]) clearTimeout(prev[key]);
      const timer = setTimeout(() => {
        setPending(p => { const { [key]: _, ...rest } = p; return rest; });
      }, PENDING_TIMEOUT_MS);
      return { ...prev, [key]: timer };
    });
  };
  const clear = (key) => {
    setPending(prev => {
      if (!prev[key]) return prev;
      clearTimeout(prev[key]);
      const { [key]: _, ...rest } = prev;
      return rest;
    });
  };
  return { pendingKeys: pending, start, clear };
}

export function WorktreesPanel({ projectId, onSelectTrack, onGoToWorkers }) {
  const { apiFetch } = useApi();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const { pendingKeys, start: startPending, clear: clearPending } = usePendingActions();
  const [error, setError] = useState(null);
  // Track 1114 Phase 16: found live — a refresh failing with "no worker
  // available for this project" left the user stuck with only an error
  // banner, no way forward short of leaving the panel to go check worker
  // status by hand. Distinct from `error` (which drives whether the
  // banner renders at all) so only THIS specific failure offers the
  // deep-link — any other refresh error just shows the plain message.
  const [noWorkerAvailable, setNoWorkerAvailable] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchRows = useCallback(() => {
    if (!projectId) return;
    apiFetch(`/api/projects/${projectId}/worktrees`)
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        const next = Array.isArray(data) ? data : [];
        // A pending action's row either vanished (removed, or merged —
        // merged rows drop out of this list entirely since they're no
        // longer unmerged relative to main) or is still present but no
        // longer what we dispatched against — either way, once it's not
        // the SAME pending state, clear it rather than waiting out the
        // full timeout. Cheap re-derivation each poll; the set is tiny.
        for (const key of computeStaleKeys(pendingKeys, next)) {
          clearPending(key);
        }
        setRows(next);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, pendingKeys, clearPending]);

  // Found live: rows stuck showing "Removing…" indefinitely (well past
  // any real completion) with no clear reason why. Root cause — the poll
  // interval below was set up once at mount with `[projectId]` as its
  // only dep (deliberately, to avoid resetting the 10s timer on every
  // pendingKeys change), but that also froze which `fetchRows` closure it
  // called: the interval kept invoking the ORIGINAL closure from mount,
  // which had captured `pendingKeys` as `{}` forever — so the "clear
  // anything no longer present" check above was always comparing against
  // an empty snapshot and could never find anything to clear, no matter
  // how many polls ran. Only the 3-minute safety timeout was ever freeing
  // a row, which reads as "stuck" for the entire wait. A ref keeps the
  // interval's target pointed at whatever the CURRENT fetchRows closure
  // is on every tick, without needing to recreate the timer itself.
  const fetchRowsRef = useRef(fetchRows);
  useEffect(() => { fetchRowsRef.current = fetchRows; }, [fetchRows]);

  useEffect(() => {
    setLoading(true);
    fetchRowsRef.current();
    const id = setInterval(() => fetchRowsRef.current(), 10000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Fire-and-forget: creates a refresh-worktrees dispatch, doesn't wait for
  // the worker to actually claim/run it. Shared by the manual button
  // (which does wait, below) and the background interval (which doesn't).
  const triggerBackendRefresh = useCallback(() => {
    if (!projectId) return Promise.resolve(null);
    return apiFetch(`/api/projects/${projectId}/worktrees/refresh`, { method: 'POST' }).catch(() => null);
  }, [projectId, apiFetch]);

  // Found live: the panel's own 10s poll only re-reads the server's
  // cached worktree summary — it never told the worker to re-audit git.
  // refreshWorktreeSummaryCache() only runs on its own 60s timer, so
  // anything done outside this panel's buttons (a raw `git worktree
  // remove`, a branch deleted by hand) could sit stale here for up to a
  // minute even while actively watching this view. Nudging a refresh
  // every 30s while the panel is mounted bounds that staleness without
  // hammering the dispatch table — best-effort and silent, not tied to
  // the `refreshing` button state.
  useEffect(() => {
    if (!projectId) return;
    const id = setInterval(() => { triggerBackendRefresh(); }, 30000);
    return () => clearInterval(id);
  }, [projectId, triggerBackendRefresh]);

  async function handleRefresh() {
    setError(null);
    setNoWorkerAvailable(false);
    setRefreshing(true);
    try {
      const res = await triggerBackendRefresh();
      if (res && !res.ok) throw new Error((await res.json().catch(() => ({}))).error || await res.text());
      // The dispatch is claimed by the worker's own poll loop, not
      // instant — give it a moment before re-reading; the regular 10s
      // poll picks up the result regardless if this fires too early.
      setTimeout(() => fetchRowsRef.current(), 3000);
    } catch (err) {
      setError(`Failed to refresh: ${err.message}`);
      // Matches the API's exact wording (ui/server/index.mjs dispatch
      // route: "no worker available for this project to run <action> on")
      // — the one refresh failure with an actual next step available.
      if (err.message.includes('no worker available')) setNoWorkerAvailable(true);
    } finally {
      setTimeout(() => setRefreshing(false), 3000);
    }
  }

  async function handleMerge(row) {
    if (!row.track) return;
    setError(null);
    startPending(mergeKey(row));
    try {
      const res = await apiFetch(`/api/projects/${projectId}/dispatch`, {
        method: 'POST',
        body: JSON.stringify({ action: 'merge-worktree', payload: { track_number: row.track } }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || await res.text());
      fetchRows();
    } catch (err) {
      setError(`Failed to dispatch merge for #${row.track}: ${err.message}`);
      clearPending(mergeKey(row));
    }
  }

  async function handleRemove(row) {
    if (!row.worktree_path && !row.branch) return;
    // Destructive and irreversible for that worktree's OWN uncommitted
    // changes (branch/commits are never touched). Confirmation is the
    // row's own two-step armed button (see useArmedConfirm above) — a
    // native window.confirm() here silently never surfaced in this app's
    // runtime, found live: a real click produced zero dispatch, zero
    // error, zero feedback, confirmed by checking worker_dispatch
    // directly afterward.
    const label = row.track ? `#${row.track}` : (row.branch || row.worktree_path);
    setError(null);
    startPending(removeKey(row));
    try {
      const res = await apiFetch(`/api/projects/${projectId}/dispatch`, {
        method: 'POST',
        body: JSON.stringify({ action: 'remove-worktree', payload: { branch: row.branch, worktree_path: row.worktree_path } }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || await res.text());
      fetchRows();
    } catch (err) {
      setError(`Failed to dispatch remove for "${label}": ${err.message}`);
      clearPending(removeKey(row));
    }
  }

  async function handleAutoComplete(row) {
    if (!row.track) return;
    setError(null);
    startPending(completeKey(row));
    try {
      const res = await apiFetch(`/api/projects/${projectId}/dispatch`, {
        method: 'POST',
        body: JSON.stringify({ action: 'auto-complete-track', payload: { track_number: row.track } }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || await res.text());
      // Multi-stage and can take a long time — pending state stays until
      // the row either disappears (merged) or the 3-minute safety timeout
      // fires, whichever comes first (a real multi-stage run can legitimately
      // run longer than 3 minutes per stage, but at that point the live
      // Transcript/track panel is the better place to watch it, not a
      // disabled button in this list).
      fetchRows();
    } catch (err) {
      setError(`Failed to dispatch auto-complete for #${row.track}: ${err.message}`);
      clearPending(completeKey(row));
    }
  }

  async function handleDiscard(row) {
    if (!row.track) return;
    setError(null);
    startPending(discardKey(row));
    try {
      const res = await apiFetch(`/api/projects/${projectId}/dispatch`, {
        method: 'POST',
        body: JSON.stringify({ action: 'discard-track', payload: { track_number: row.track } }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || await res.text());
      fetchRows();
    } catch (err) {
      setError(`Failed to dispatch discard for #${row.track}: ${err.message}`);
      clearPending(discardKey(row));
    }
  }

  async function handleAiResolve(row) {
    if (!row.track) return;
    setError(null);
    startPending(aiResolveKey(row));
    try {
      const res = await apiFetch(`/api/projects/${projectId}/dispatch`, {
        method: 'POST',
        body: JSON.stringify({ action: 'ai-resolve-conflict', payload: { track_number: row.track } }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || await res.text());
      // Runs a real merge + a full Claude turn inside the worktree — can
      // take minutes, not seconds. Same bounded-pending pattern as
      // Complete & Merge; the row's own class flips once the next audit
      // cycle sees the outcome (merged → drops out, still conflicted →
      // stays, unchanged).
      fetchRows();
    } catch (err) {
      setError(`Failed to dispatch AI-resolve for #${row.track}: ${err.message}`);
      clearPending(aiResolveKey(row));
    }
  }

  async function handleForceMerge(row) {
    if (!row.track) return;
    setError(null);
    startPending(forceKey(row));
    try {
      const res = await apiFetch(`/api/projects/${projectId}/dispatch`, {
        method: 'POST',
        body: JSON.stringify({ action: 'merge-worktree', payload: { track_number: row.track, force: true } }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || await res.text());
      fetchRows();
    } catch (err) {
      setError(`Failed to dispatch force-merge for #${row.track}: ${err.message}`);
      clearPending(forceKey(row));
    }
  }

  const sorted = [...rows].sort((a, b) => (CLASS_SORT_ORDER[a.class] ?? 9) - (CLASS_SORT_ORDER[b.class] ?? 9));
  const hosts = [...new Set(rows.map(r => r.host).filter(Boolean))];
  const groupByHost = hosts.length > 1;

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-500 text-sm">Loading worktrees…</div>;
  }

  if (!rows.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-center px-6">
        <div className="w-16 h-16 rounded-full bg-gray-900 border border-gray-800 flex items-center justify-center mb-4 shadow-inner">
          <span className="text-2xl opacity-50">🌳</span>
        </div>
        <h3 className="text-gray-300 font-medium mb-1">No Unmerged Worktrees</h3>
        <p className="text-gray-500 text-sm max-w-xs leading-relaxed">
          Every worktree for this project is either fully merged or hasn't reported yet — a worker needs at least
          one heartbeat to populate this list.
        </p>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          data-testid="refresh-worktrees-btn"
          className="mt-4 text-[10px] px-2.5 py-1 border rounded font-bold uppercase tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed border-gray-700 bg-gray-900 text-gray-400 hover:bg-gray-800 hover:text-gray-200"
        >
          {refreshing ? 'Refreshing…' : '↻ Refresh'}
        </button>
        {error && (
          <div className="text-xs text-red-400 bg-red-950/30 border border-red-900/50 rounded px-3 py-2 mt-3 max-w-xs flex flex-col gap-2 items-start">
            <span>{error}</span>
            {noWorkerAvailable && onGoToWorkers && (
              <button
                onClick={onGoToWorkers}
                data-testid="go-to-workers-btn"
                className="text-[10px] px-2.5 py-1 border border-blue-800/60 bg-blue-950/30 text-blue-300 hover:bg-blue-900/40 rounded font-bold uppercase tracking-wider transition-colors"
              >
                Go to Workers →
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  const renderGroup = (groupRows) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {groupRows.map((row, i) => (
        <WorktreeRow
          key={`${row.host || ''}-${row.track || row.branch || i}`}
          row={row}
          onMerge={handleMerge}
          merging={Boolean(pendingKeys[mergeKey(row)])}
          onSelectTrack={onSelectTrack ? (track) => onSelectTrack(projectId, track) : null}
          onRemove={handleRemove}
          removing={Boolean(pendingKeys[removeKey(row)])}
          onAutoComplete={handleAutoComplete}
          autoCompleting={Boolean(pendingKeys[completeKey(row)])}
          onForceMerge={handleForceMerge}
          forceMerging={Boolean(pendingKeys[forceKey(row)])}
          onDiscard={handleDiscard}
          discarding={Boolean(pendingKeys[discardKey(row)])}
          onAiResolve={handleAiResolve}
          aiResolving={Boolean(pendingKeys[aiResolveKey(row)])}
        />
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <WorktreeStatsHeader rows={rows} onRefresh={handleRefresh} refreshing={refreshing} />
      {error && (
        <div className="text-xs text-red-400 bg-red-950/30 border border-red-900/50 rounded px-3 py-2 flex items-center gap-3 flex-wrap">
          <span>{error}</span>
          {noWorkerAvailable && onGoToWorkers && (
            <button
              onClick={onGoToWorkers}
              data-testid="go-to-workers-btn"
              className="text-[10px] px-2.5 py-1 border border-blue-800/60 bg-blue-950/30 text-blue-300 hover:bg-blue-900/40 rounded font-bold uppercase tracking-wider transition-colors"
            >
              Go to Workers →
            </button>
          )}
        </div>
      )}
      {groupByHost
        ? hosts.map(host => (
          <div key={host} className="flex flex-col gap-4">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest pl-1">{host}</h3>
            {renderGroup(sorted.filter(r => r.host === host))}
          </div>
        ))
        : renderGroup(sorted)}
    </div>
  );
}
