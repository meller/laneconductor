import { useState, useEffect, useCallback, useRef } from 'react';
import { useApi } from '../hooks/useApi.js';
import { computeWorktreeStats } from '../lib/worktreeStats.js';
import { nextArmedState } from '../lib/armedConfirm.js';
import { removeKey, mergeKey, completeKey, discardKey, computeStaleKeys } from '../lib/worktreePendingKeys.js';
import { isWorktreeRowRunning } from '../lib/worktreeRunState.js';

const REC_STYLE = {
  warning: 'bg-amber-950/30 border-amber-800/60 text-amber-300',
  action: 'bg-blue-950/30 border-blue-800/60 text-blue-300',
  info: 'bg-gray-900 border-gray-800 text-gray-400',
};
const REC_ICON = { warning: '⚠', action: '→', info: 'ℹ' };

const CLASS_LABEL = { stranded: 'Stranded', conflicted: 'Conflicted', mergeable: 'Mergeable', open: 'Open', detached: 'Detached', 'pr-open': 'PR Open' };
const CLASS_DOT = { stranded: 'bg-red-500', conflicted: 'bg-amber-500', mergeable: 'bg-green-500', open: 'bg-gray-500', detached: 'bg-purple-500', 'pr-open': 'bg-blue-500' };

// Track 10018: pr_status -> a small checks indicator shown on pr-open rows.
// Deliberately separate from CLASS_BADGE (which is about the row's overall
// classification) — this is specifically "what is GitHub telling us about
// this PR right now."
const PR_STATUS_BADGE = {
  open: { label: 'Checks pending', icon: '⏳', className: 'bg-gray-900 text-gray-400 border-gray-800' },
  'checks-failed': { label: 'Checks failed', icon: '❌', className: 'bg-red-950/40 text-red-300 border-red-800/80' },
  conflicted: { label: 'Conflicts with main', icon: '🟠', className: 'bg-amber-950/40 text-amber-300 border-amber-800/80' },
  closed: { label: 'Closed unmerged', icon: '🚫', className: 'bg-red-950/40 text-red-300 border-red-800/80' },
  merged: { label: 'Merged — cleanup pending', icon: '✅', className: 'bg-green-950/40 text-green-300 border-green-800/80' },
  error: { label: 'Failed to open', icon: '⚠️', className: 'bg-red-950/40 text-red-300 border-red-800/80' },
};

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
  'pr-open': { label: 'PR Open', icon: '🔵', className: 'bg-blue-950/40 text-blue-300 border-blue-800/80' },
};

// stranded -> conflicted -> pr-open -> mergeable -> open, per the design
// decision — the rows that need a human's attention float to the top.
// pr-open sits just below stranded/conflicted since an open PR is
// specifically parked awaiting a human decision, same spirit as those two.
const CLASS_SORT_ORDER = { stranded: 0, conflicted: 1, 'pr-open': 2, mergeable: 3, detached: 4, open: 5 };

// Track 10018: mode badge shown on every row regardless of classification —
// lets you tell at a glance which rows will fly through on auto-merge vs
// pause for PR review, without needing to click into the track.
const MERGE_MODE_BADGE = {
  pr: { label: 'PR', className: 'bg-blue-950/40 text-blue-300 border-blue-800/60' },
  direct: { label: 'DIRECT', className: 'bg-gray-900 text-gray-400 border-gray-800' },
};

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

function WorktreeRow({ row, onMerge, merging, onSelectTrack, onRemove, removing, onAutoComplete, autoCompleting, onDiscard, discarding, onPreview, isPreviewing, previewLoading, highlighted }) {
  const { armedKey, request } = useArmedConfirm();
  // Deep link from a Done-lane card's "View in Worktrees" — this panel can
  // hold dozens of rows across every unmerged track, so landing on it
  // without actually surfacing the one the user clicked through for would
  // defeat the point of the link.
  const rowRef = useRef(null);
  useEffect(() => {
    if (highlighted) rowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlighted]);
  const badge = CLASS_BADGE[row.class] || CLASS_BADGE.open;
  const isConflicted = row.class === 'conflicted';
  // Track 10018: the pr-mode approval station.
  const isPrOpen = row.class === 'pr-open';
  const modeBadge = MERGE_MODE_BADGE[row.merge_mode] || MERGE_MODE_BADGE.pr;
  const prStatusBadge = row.pr_status ? PR_STATUS_BADGE[row.pr_status] : null;
  // Track 10035: merging is a standard lane action now (the done lane's
  // own `/laneconductor merge`) — one "Run merge action" button replaces
  // the old Merge to main / Create PR / AI Resolve trio. Covers every
  // shape of "this track's merge action needs to (re-)run": a plain
  // unmerged direct-mode branch (mergeable/stranded), a conflicted one
  // (the merge action resolves real conflicts in-session now — REQ-4,
  // there is no separate AI-resolve action anymore), and a pr-mode track
  // that hasn't opened its PR yet (no pr_number — the merge action is what
  // opens it, replacing the old standalone "Create PR" button). Excluded
  // once a PR is open and awaiting human approval on GitHub (`pr-open` +
  // pr_number) — DonePrLink-equivalent block below is the affordance then.
  const canRunMergeAction = Boolean(row.track)
    && (row.class === 'mergeable' || row.class === 'stranded' || row.class === 'conflicted'
      || (isPrOpen && !row.pr_number));
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
  const hasWorktreeToPreview = Boolean(row.worktree_path);
  // Complete & Merge is for rows still genuinely mid-pipeline (`open`
  // with a real track) — mergeable/stranded/conflicted/pr-open-without-PR
  // already get the standard "Run merge action" button above; detached has
  // no track to run lane actions against at all. Track 10035: relabeled
  // (see the button below) — it no longer merges itself, it just runs the
  // remaining lane actions and lands the track at done:queue, where the
  // standard merge action (same one the button above dispatches) takes
  // over like it does for any other track.
  const canAutoComplete = row.class === 'open' && row.track;
  // Track 1114 Phase 15: any row with a real track can be discarded —
  // deliberately NOT gated to `open`; a `mergeable`/`stranded` track can
  // just as legitimately turn out to be unwanted work someone decided not
  // to ship. `conflicted` can be discarded too — there's nothing to
  // resolve if it's never merging. `detached` has no track to move to
  // backlog against.
  const canDiscard = Boolean(row.track);
  // A row's actions can conflict with each other (e.g. running the merge
  // action while a Complete & Merge sequence is still running) — while ANY
  // one is pending for this row, the rest are disabled too, not just the
  // one that was clicked.
  const rowBusy = merging || removing || autoCompleting || discarding;
  // Track 10024: "running" for the purposes of the transcript deep-link below
  // — either this tab just dispatched something (rowBusy) or the server's own
  // audit says the track's lane_status is running (e.g. a plain lane
  // re-dispatch started elsewhere, or state that survived a page reload).
  const isRunning = isWorktreeRowRunning({ row, busy: rowBusy });

  return (
    <div
      ref={rowRef}
      className={`border rounded-xl p-4 flex flex-col gap-3 transition-colors shadow-sm ${highlighted ? 'ring-2 ring-blue-500' : ''} ${row.class === 'stranded' ? 'bg-red-950/10 border-red-900/50' : 'bg-gray-900 border-gray-800 hover:border-gray-700'
        }`}
      data-testid="worktree-row"
      data-track={row.track ?? ''}
      data-highlighted={highlighted ? 'true' : 'false'}
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
                onClick={() => onSelectTrack(row.track, { transcript: isRunning })}
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
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Track 10024: the row's "Running…" state used to be decorative
              text on a disabled action button — nothing to click, no way to
              see what the run is actually doing. This badge is clickable and
              reuses the same onSelectTrack path the #<track> ↗ link already
              uses, just with transcript:true attached, so it opens
              TrackDetailPanel with the existing Phase 4 Transcript drawer
              already expanded instead of a closed one. If the run already
              finished or never really started (stale lane_status after a
              crash), the drawer's own "No transcript yet." empty state
              covers it — nothing new built for that case. */}
          {isRunning && onSelectTrack && (
            <button
              onClick={() => onSelectTrack(row.track, { transcript: true })}
              data-testid="worktree-running-badge"
              title="Watch this track's live session transcript. If the run already finished (or the badge is stale after a crash), the transcript will simply be empty."
              className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border border-orange-800/70 bg-orange-950/40 text-orange-300 hover:bg-orange-900/50 transition-colors"
            >
              <span className="animate-pulse">●</span>
              <span>Running…</span>
            </button>
          )}
          {/* Track 10018: shown on every row, not just pr-open — lets you
              tell at a glance which rows will auto-merge vs pause for
              review without clicking in. */}
          <span
            className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${modeBadge.className}`}
            title={row.merge_mode === 'direct' ? 'Auto-merges on done:success' : 'Opens a PR for review on done:success'}
            data-testid="merge-mode-badge"
          >
            {modeBadge.label}
          </span>
          <span className={`flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${badge.className}`}>
            <span>{badge.icon}</span>
            <span>{badge.label}</span>
          </span>
        </div>
      </div>

      {isPrOpen && row.pr_number && (
        <div className="flex items-center gap-2 -mt-1">
          <a
            href={row.pr_url || undefined}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-blue-400 hover:text-blue-300 hover:underline font-mono"
            data-testid="pr-link"
          >
            PR #{row.pr_number} ↗
          </a>
          {prStatusBadge && (
            <span
              className={`flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${prStatusBadge.className}`}
              data-testid="pr-status-badge"
            >
              <span>{prStatusBadge.icon}</span>
              <span>{prStatusBadge.label}</span>
            </span>
          )}
        </div>
      )}

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
            title="This will send the track to an automatic worker to complete it — is that OK? Runs the remaining lane actions for real (review, quality-gate, ...) and lands it at done:queue; also marks it auto_run so the standard merge action (and any future queue work) can be picked up automatically, starting a sync+poll worker first if none is running. Stops and leaves it for you if any stage genuinely fails — no auto-retry."
            className={`text-[10px] px-2.5 py-1 border rounded font-bold uppercase tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${armedKey === `complete:${row.track}`
              ? 'border-blue-500 bg-blue-800/60 text-white'
              : 'border-blue-800/60 bg-blue-950/30 text-blue-300 hover:bg-blue-900/40'
              }`}
          >
            {autoCompleting ? 'Running…' : armedKey === `complete:${row.track}` ? 'Click again to run' : 'Complete'}
          </button>
        )}
        {/* Track 10035: the done lane's standard lane action — same
            single button whether the branch is a plain unmerged one, a
            conflicted one (resolved in-session now, REQ-4), or a pr-mode
            track whose PR hasn't been opened yet. Replaces the old Merge
            to main / Create PR / AI Resolve / Force Merge buttons. */}
        {canRunMergeAction && (
          <button
            onClick={() => onMerge(row)}
            disabled={rowBusy}
            data-testid="run-merge-action-btn"
            title={isConflicted
              ? 'Runs the merge action — it fetches main, resolves the conflict in-session, and merges (or opens/updates the PR in pr-mode)'
              : row.merge_mode === 'direct'
                ? 'Runs the merge action — merges this branch into main'
                : 'Runs the merge action — pushes the branch and opens a PR for review'}
            className="text-[10px] px-2.5 py-1 border border-green-800/60 bg-green-950/30 text-green-300 hover:bg-green-900/40 disabled:opacity-50 disabled:cursor-not-allowed rounded font-bold uppercase tracking-wider transition-colors"
          >
            {merging ? 'Running…' : 'Run merge action'}
          </button>
        )}
        {isPrOpen && row.pr_number && (
          <span
            className="text-[10px] px-2.5 py-1 border border-gray-800 text-gray-600 rounded font-bold uppercase tracking-wider cursor-not-allowed"
            title={row.pr_status === 'merged' ? 'PR merged — cleanup runs on the next reconcile pass' : 'Waiting on GitHub — approve/merge the PR there (see the PR link above)'}
          >
            Awaiting PR
          </span>
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
            disabled={rowBusy || isPreviewing}
            data-testid="remove-worktree-btn"
            title={isPreviewing
              ? 'This worktree is currently being previewed by the dev server — return to main first'
              : "Discards this worktree's uncommitted changes — the branch/commits (if any) are not deleted"}
            className={`text-[10px] px-2.5 py-1 border rounded font-bold uppercase tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${armedKey === `remove:${row.worktree_path || row.branch}`
              ? 'border-red-500 bg-red-800/60 text-white'
              : 'border-red-900/60 bg-red-950/20 text-red-400 hover:bg-red-900/30'
              }`}
          >
            {removing ? 'Removing…' : armedKey === `remove:${row.worktree_path || row.branch}` ? 'Click again to remove' : 'Remove worktree'}
          </button>
        )}
        {/* Track 10018 Phase 5: swaps the project's single dev server to
            run against this worktree instead of the primary checkout —
            "shift, test, approve" from the Worktrees panel. */}
        {hasWorktreeToPreview && (
          <button
            onClick={() => onPreview(row)}
            disabled={rowBusy || previewLoading || isPreviewing}
            data-testid="preview-btn"
            title={isPreviewing
              ? 'The dev server is already running this worktree'
              : 'Stops the current dev server and restarts it pointed at this worktree, so you can test the branch before approving it'}
            className={`text-[10px] px-2.5 py-1 border rounded font-bold uppercase tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isPreviewing
              ? 'border-purple-500 bg-purple-900/40 text-purple-300'
              : 'border-purple-800/60 bg-purple-950/20 text-purple-400 hover:bg-purple-900/30'
              }`}
          >
            {isPreviewing ? '● Previewing' : previewLoading ? 'Starting…' : 'Preview'}
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

export function WorktreesPanel({ projectId, onSelectTrack, onGoToWorkers, highlightTrack }) {
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
    // Found live 2026-09-06: with "All Projects" selected, projectId is
    // falsy and this used to bail out with a bare `return` — `loading`
    // (set true by the effect below on every projectId change) was never
    // set back to false, so the panel showed "Loading worktrees…"
    // indefinitely, with no error and no way to tell it wasn't just slow.
    if (!projectId) { setRows([]); setLoading(false); return; }
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

  // Track 10018 Phase 5: separate, simple poll for dev-server preview
  // state — deliberately NOT folded into fetchRows' interval above, whose
  // ref-indirection exists to work around a specific pendingKeys
  // stale-closure bug that has nothing to do with this endpoint; keeping
  // this poll independent avoids re-risking that same bug class here.
  const [previewTrack, setPreviewTrack] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  useEffect(() => {
    if (!projectId) return;
    const fetchPreview = () => {
      apiFetch(`/api/projects/${projectId}/dev-server/status`)
        .then(r => r.ok ? r.json() : null)
        .then(data => setPreviewTrack(data?.preview_track ?? null))
        .catch(() => { });
    };
    fetchPreview();
    const id = setInterval(fetchPreview, 5000);
    return () => clearInterval(id);
  }, [projectId, apiFetch]);

  async function handlePreview(row) {
    if (!row.worktree_path) return;
    setError(null);
    setPreviewLoading(true);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/dev-server/start`, {
        method: 'POST',
        body: JSON.stringify({ preview_cwd: row.worktree_path, preview_track: row.track }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || await res.text());
      const data = await res.json();
      setPreviewTrack(data.preview_track ?? row.track);
    } catch (err) {
      setError(`Failed to start preview for #${row.track}: ${err.message}`);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleReturnToMain() {
    setError(null);
    setPreviewLoading(true);
    try {
      // No preview_cwd → the endpoint falls back to the project's own
      // repo_path, exactly the "swap back to primary" half of the design.
      const res = await apiFetch(`/api/projects/${projectId}/dev-server/start`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || await res.text());
      setPreviewTrack(null);
    } catch (err) {
      setError(`Failed to return to main: ${err.message}`);
    } finally {
      setPreviewLoading(false);
    }
  }

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

  // Track 10035: merging is a standard lane action now — this dispatches
  // it exactly the way TrackCard's own ▶ run button does (re-queue +
  // dispatch whatever lane action the track is currently sitting at),
  // rather than the old bespoke 'merge-worktree'/'create-pr' dispatch
  // actions. Works identically for a plain unmerged branch, a conflicted
  // one, or a pr-mode track with no PR yet — the merge action itself forks
  // on merge_mode/conflict state (SKILL.md's `/laneconductor merge`).
  async function handleMerge(row) {
    if (!row.track) return;
    setError(null);
    startPending(mergeKey(row));
    try {
      const res = await apiFetch(`/api/projects/${projectId}/tracks/${row.track}/implement`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || await res.text());
      fetchRows();
    } catch (err) {
      setError(`Failed to run the merge action for #${row.track}: ${err.message}`);
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

  // Track 10017 Phase 7: "Complete & Merge" already ran a track through the
  // full pipeline via explicit dispatch, independent of auto_run. This
  // connects the two: confirming the button now also (a) marks the track
  // auto_run:true, so a future queue-status lane on it can be picked up by
  // ordinary polling too, not just this one dispatch, and (b) makes sure a
  // sync+poll worker actually exists to act on that flag going forward —
  // otherwise auto_run:true would be a no-op setting nobody ever reads.
  // The row's existing two-step armed button (see useArmedConfirm) is
  // already this action's confirmation gate — a native window.confirm()
  // doesn't reliably fire in this app's runtime (see the Remove-button
  // comment above), so this reuses that same pattern rather than adding a
  // second dialog on top of it.
  async function ensurePollingWorker() {
    try {
      const res = await apiFetch(`/api/projects/${projectId}/workers`);
      if (!res.ok) return;
      const workers = await res.json();
      const hasPoller = (workers || []).some(w => w.mode === 'sync+poll' && w.type !== 'manager');
      if (hasPoller) return;
      await apiFetch(`/api/projects/${projectId}/workers/start-new`, {
        method: 'POST',
        body: JSON.stringify({ sync_and_work: true }),
      });
    } catch {
      // Best-effort: failing to provision a poller must not block the
      // dispatch this click already committed to — auto-complete-track
      // reaches the track's worker_dispatch inbox regardless of mode.
    }
  }

  async function handleAutoComplete(row) {
    if (!row.track) return;
    setError(null);
    startPending(completeKey(row));
    try {
      await apiFetch(`/api/projects/${projectId}/tracks/${row.track}/auto-run`, {
        method: 'PATCH',
        body: JSON.stringify({ auto_run: true }),
      }).catch(() => { });
      await ensurePollingWorker();
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

  const sorted = [...rows].sort((a, b) => (CLASS_SORT_ORDER[a.class] ?? 9) - (CLASS_SORT_ORDER[b.class] ?? 9));
  const hosts = [...new Set(rows.map(r => r.host).filter(Boolean))];
  const groupByHost = hosts.length > 1;

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-500 text-sm">Loading worktrees…</div>;
  }

  if (!projectId) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-center px-6">
        <div className="w-16 h-16 rounded-full bg-gray-900 border border-gray-800 flex items-center justify-center mb-4 shadow-inner">
          <span className="text-2xl opacity-50">🌳</span>
        </div>
        <h3 className="text-gray-300 font-medium mb-1">Select a Project</h3>
        <p className="text-gray-500 text-sm max-w-xs leading-relaxed">
          Worktrees are per-project — pick a specific project above to see its unmerged branches.
        </p>
      </div>
    );
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
          highlighted={Boolean(highlightTrack) && String(row.track ?? '') === String(highlightTrack)}
          onMerge={handleMerge}
          merging={Boolean(pendingKeys[mergeKey(row)])}
          onSelectTrack={onSelectTrack ? (track, opts) => onSelectTrack(projectId, track, opts) : null}
          onRemove={handleRemove}
          removing={Boolean(pendingKeys[removeKey(row)])}
          onAutoComplete={handleAutoComplete}
          autoCompleting={Boolean(pendingKeys[completeKey(row)])}
          onDiscard={handleDiscard}
          discarding={Boolean(pendingKeys[discardKey(row)])}
          onPreview={handlePreview}
          isPreviewing={Boolean(row.track) && String(row.track) === String(previewTrack)}
          previewLoading={previewLoading}
        />
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <WorktreeStatsHeader rows={rows} onRefresh={handleRefresh} refreshing={refreshing} />
      {/* Track 10018 Phase 5: always visible while a preview is active, so
          it's impossible to forget the dev server isn't pointed at main
          right now — the whole point of the persistent badge/banner pair. */}
      {previewTrack && (
        <div
          className="text-xs text-purple-300 bg-purple-950/30 border border-purple-800/60 rounded px-3 py-2 flex items-center justify-between gap-3"
          data-testid="preview-banner"
        >
          <span>🔬 Dev server is running track #{previewTrack}'s worktree</span>
          <button
            onClick={handleReturnToMain}
            disabled={previewLoading}
            data-testid="return-to-main-btn"
            className="text-[10px] px-2.5 py-1 border border-purple-700/60 bg-purple-900/40 text-purple-300 hover:bg-purple-800/50 disabled:opacity-50 disabled:cursor-not-allowed rounded font-bold uppercase tracking-wider transition-colors shrink-0"
          >
            {previewLoading ? 'Switching…' : 'Return to main'}
          </button>
        </div>
      )}
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
