import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Merges the status markers a worktree's index.md just had written into it
// (by the exit handler, after a lane action finishes) onto the primary
// checkout's own copy of the same file — everything else about the primary
// copy's structure/body is left untouched.
//
// Lane and Lane Status are included deliberately (Track 1112 dogfood
// incident, 2026-08-14): when a track runs in a worktree, the exit handler
// only ever writes Lane/Lane Status into the WORKTREE's copy — this merge is
// the only thing that ever reaches the primary checkout for that track, so
// excluding them left the primary checkout frozen at its pre-run lane for
// the track's entire time in that worktree.
//
// `skipStatusMarkers` (Track 1102 F21, 2026-08-20): a reused per-cycle
// worktree's Lane/Lane Status stays at whatever the PREVIOUS cycle's exit
// handler last wrote until THIS cycle's own exit handler runs — nothing
// updates it mid-run. A caller merging mid-run (the periodic doc-sync pass,
// as opposed to the exit handler or a restart-orphan reconciliation, both of
// which only ever run once a run has genuinely ended) must not let that
// stale value overwrite the dispatcher's freshly-written "running" marker
// on primary — confirmed live on track 10019's review and quality-gate
// dispatches, both closed out by reconcileActiveDispatch() reading a
// clobbered "success" while the real agent process was still alive. Every
// other marker (Progress/Phase/Summary/Waiting for reply) has no such
// hazard — nothing treats those as a completion signal — so they still flow
// through for mid-run freshness, which is the whole point of that pass.
export function mergeIndexMarkers(existingContent, artifactContent, { skipStatusMarkers = false, trustRunningStatus = true } = {}) {
  const markerPatterns = [
    { re: /\*\*Lane\*\*:\s*[^\n]+/i, isStatusMarker: true },
    // Track 10053 (2026-09-03), UI-confirmed: skipStatusMarkers blocked
    // EVERY Lane Status update during a mid-run sync, including the one
    // value that can never be the track-10019 hazard this guard exists
    // for. That hazard is specifically a REUSED worktree's stale TERMINAL
    // status (success/failure/queue, left over from a PREVIOUS cycle's
    // exit handler) clobbering the dispatcher's freshly-written "running"
    // on primary. "running" itself can't be that stale leftover — an exit
    // handler only ever leaves a worktree in a terminal state, never
    // "running"; the only way a worktree's OWN copy reads "running" is
    // because the run genuinely in progress right now put it there. Live
    // symptom this fixes: the Kanban card's running-indicator
    // (TrackCard.jsx) gates on lane_action_status === 'running', driven
    // by this same primary-copy marker — with it always skipped mid-run,
    // an actively-committing session with a live worktree, a live
    // process, and a live git lock showed as "⏳ Queued for automation"
    // for its entire run, indistinguishable from actually stuck.
    {
      re: /\*\*Lane Status\*\*:\s*[^\n]+/i,
      isStatusMarker: true,
      // 'waiting' extended in alongside 'running' (2026-09-03, same day):
      // confirmed live on track 10053 — an implement session that
      // auto-advanced all the way to `done` and then genuinely paused,
      // asking a human to authorize a real production-deploy step, went
      // from primary-shows-queue straight into ANOTHER not-yet-exempted
      // value with no visible "running" window in between (the doc-sync
      // tick interval lost the race against how fast the auto-complete
      // chain moved). 'waiting' has the same non-hazard property running
      // does for MOST of its life — LaneActionStatus.WAITING's own
      // definition (constants.mjs) is deliberately narrower than a bare
      // terminal status ("nothing left for a WORKER to do", not "nothing
      // left to do at all"): a track sitting there is exactly the case a
      // human most needs the UI to surface, not hide behind "queued".
      // Trade-off accepted narrowly, not blanket: unlike 'running',
      // 'waiting' CAN legitimately be an exit handler's own terminal
      // write (a pr-mode done-lane merge that opened a PR) sitting stale
      // in a reused worktree — but even stale, it does not trip
      // reconcileActiveDispatch's dangerous path (that guard only
      // special-cases 'running' as "definitely still going"; it does not
      // treat 'waiting' as a completion signal to act on), so the actual
      // track-10019 hazard (wrongly closing a live dispatch) still can't
      // recur through this exception.
      //
      // Found live 2026-09-05 (tracks 10064/10065/10067): the "an exit
      // handler only ever leaves a worktree in a terminal state, never
      // running" premise above assumes a run that ends WITHOUT ever
      // exiting cleanly is impossible — but that is exactly what a crash
      // or a restart-orphaned dispatch is: no exit handler ever ran, so
      // "running" is left behind as stale as any terminal value would be.
      // Once the orphan-reconciler (conductor/services/orphaned-dispatch.mjs)
      // correctly writes a terminal status onto primary for exactly that
      // case, this exception let the worktree's own still-"running" copy
      // immediately clobber it back on the very next doc-sync tick — a
      // fight the reconciler can never win, repeating forever. `trustRunningStatus`
      // is real, independent evidence (this worker's own runningTrackMap,
      // or a live run marker) that a run is actually still going, supplied
      // by the caller — never re-derived from the worktree's own claim,
      // since that claim is exactly what's in question.
      allowDuringSkip: (matchedText) => trustRunningStatus && /running|waiting/i.test(matchedText),
    },
    { re: /\*\*Progress\*\*:\s*[^\n]+/i },
    { re: /\*\*Phase\*\*:\s*[^\n]+/i },
    { re: /\*\*Summary\*\*:\s*[^\n]+/i },
    // Track 10020: unlike the other markers, a track can legitimately go
    // its whole life without ever needing "Waiting for reply" until the
    // moment it first does (e.g. a dispatched lane action hitting a
    // genuine blocking question for the first time) — "not already present
    // in primary" is the NORMAL case for that first occurrence, not a sign
    // of reshaping the file. Silently dropping it here undid the exit
    // handler's own correctly-written marker and the DB patch that
    // depended on it: caught live on track 1102, where the marker landed
    // in the worktree's copy and the worker_dispatch completion PATCH
    // correctly included waiting_for_reply: true, but this merge step
    // dropped it from primary's copy, and the very next syncTrack() call —
    // reading primary's now marker-less file — overwrote the DB back to
    // waiting_for_reply: false, silently undoing the Inbox fix.
    { re: /\*\*Waiting for reply\*\*:\s*[^\n]+/i, alwaysInject: true },
    // Track 10055: same first-occurrence reasoning as **Waiting for reply**
    // above — a track has no `**Waiting Reason**` until the first time a lane
    // action parks, so "not already present in primary" is the normal case
    // for the write that matters most. Dropping it would leave primary
    // showing a paused card with no explanation of what unblocks it, which
    // is the state this marker exists to prevent.
    { re: /\*\*Waiting Reason\*\*:\s*[^\n]+/i, alwaysInject: true },
  ];

  let merged = existingContent;
  for (const { re, isStatusMarker, alwaysInject, allowDuringSkip } of markerPatterns) {
    const m = artifactContent.match(re);
    if (isStatusMarker && skipStatusMarkers && !(allowDuringSkip && m && allowDuringSkip(m[0]))) continue;
    if (!m) continue;
    if (re.test(merged)) {
      merged = merged.replace(re, m[0]);
    } else if (alwaysInject) {
      merged = merged.trim() + `\n${m[0]}\n`;
    }
    // Every other marker: if it isn't present in the existing file, don't
    // inject it — preserve the file's own structure rather than reshaping
    // it. (Lane/Lane Status/Progress/Phase/Summary are set at track
    // creation, so this gap essentially never applies to them.)
  }
  return merged;
}

// Shared by mergeIndexMarkers' own marker table and the skipUnchanged
// mtime-override below, so the two can never drift on what a status line
// looks like.
const LANE_STATUS_RE = /\*\*Lane Status\*\*:\s*([^\n]+)/i;

const MERGE_ONLY_ARTIFACTS = new Set(['index.md']);
// Track 10019 (REQ-10 / D3): conversation.md is deliberately NOT in this
// list. It has two independent writers — the UI/human posts comments
// straight into the PRIMARY's copy, while the agent appends its own turns
// to the WORKTREE's copy — so a blind copy in either direction eats
// whichever side wrote more recently. This was a live data-loss bug: a
// human comment posted mid-run was silently overwritten by the worktree's
// (comment-less) copy at run end, and the shrink guard never caught it
// (one lost line stays well above its size thresholds). The existing
// `.conv-cursor` machinery (see laneconductor.sync.mjs's conversation
// sync) is this file's sole owner; nothing in this module may touch it.
const ARTIFACTS = ['index.md', 'plan.md', 'spec.md', 'test.md', 'quality-gate.md'];

// Copies a worktree's track-doc artifacts back onto the primary checkout's
// copy of the same track — index.md via mergeIndexMarkers() (status markers
// only, body preserved), everything else full-replace, both gated by a
// "does the incoming version look suspiciously truncated" safety check.
//
// Extracted out of the exit-handler's inline block (Track 1112, 2026-08-14)
// so the SAME logic can also run from a startup reconciliation pass (Track
// 1110 Phase 6, 2026-08-14): if the sync worker process restarts while a
// dispatch's child CLI is still running, the child keeps running and
// finishes on its own, but the worker's in-memory `on('exit')` listener for
// it is gone — nothing ever calls this. Making it a standalone function lets
// a reconciliation pass call the identical code path later instead of
// re-deriving a parallel, easy-to-drift copy of the same safety-guard logic.
//
// `resolveTrackFolder` is injected rather than imported — it lives in
// laneconductor.sync.mjs and depends on that module's own track-metadata
// state (ambiguous-folder quarantining), which this module has no business
// knowing about.
//
// `skipUnchanged` (track 10019 / REQ-9, default false — existing
// exit-handler and orphan-reconcile callers keep their exact prior
// behavior: always attempt every artifact that exists). The periodic
// mid-run sync pass (syncWorktreeDocsToprimary, below) passes `true` so a
// quiet repo with N live worktrees costs zero reads/writes for files
// nobody touched since the last pass — mtime comparison, source strictly
// newer than dest to copy.
//
// `skipped` (track 10019 / REQ-11) records every artifact the shrink guard
// declined, with enough detail (file, reason, both sizes) for a caller to
// log it and mark the track's docs as possibly stale — see Phase 5's
// syncWorktreeDocsToprimary usage.
export function copyWorktreeArtifactsToPrimary({ worktreePath, trackNumber, isSuccess, primaryRoot, resolveTrackFolder, skipUnchanged = false, skipStatusMarkers = false, trustRunningStatus = true }) {
  const mainTracksDir = join(primaryRoot, 'conductor', 'tracks');
  const wtTracksDir = join(worktreePath, 'conductor', 'tracks');
  const wtTrackDir = existsSync(wtTracksDir) ? resolveTrackFolder(wtTracksDir, trackNumber) : null;
  if (!wtTrackDir) return { copied: [], destDir: null, skipped: [] };

  mkdirSync(mainTracksDir, { recursive: true });
  let mainTrackDir = existsSync(mainTracksDir) ? resolveTrackFolder(mainTracksDir, trackNumber) : null;
  if (!mainTrackDir) {
    // Planning agent created the dir inside the worktree — copy whole dir to main
    mainTrackDir = wtTrackDir;
    mkdirSync(join(mainTracksDir, mainTrackDir), { recursive: true });
  }
  const destDir = join(mainTracksDir, mainTrackDir);
  const copied = [];
  const skipped = [];

  for (const file of ARTIFACTS) {
    const src = join(wtTracksDir, wtTrackDir, file);
    const dest = join(destDir, file);
    if (!existsSync(src)) continue;

    if (skipUnchanged && existsSync(dest)) {
      const srcMtime = statSync(src).mtimeMs;
      const destMtime = statSync(dest).mtimeMs;
      if (srcMtime <= destMtime) {
        // Everything except index.md: mtime is a sound "nothing changed"
        // signal, because this merge is that file's only writer on primary.
        if (!MERGE_ONLY_ARTIFACTS.has(file)) continue;

        // index.md is the exception, and mtime LIES for it (found live
        // 2026-09-04, tracks 1121/10063/10064 all stuck showing `queue` on
        // the board while their worktrees said `running` with live agents).
        // The primary copy has OTHER writers: the FS->DB push and the DB->FS
        // pull chase each other every ~10s, rewriting it and bumping its
        // mtime constantly. A worktree's index.md only changes when the
        // agent itself writes it — a minute or more apart. So primary is
        // almost always "newer", this guard skips forever, and mergeIndexMarkers
        // (including its running/waiting exception) is never even reached.
        // The status therefore never leaves the worktree.
        //
        // Compare the marker itself instead of the timestamp. index.md is a
        // few KB and only read when mtime already said "skip", so the cost is
        // one small read per live worktree per pass.
        let srcStatus, destStatus;
        try {
          srcStatus = readFileSync(src, 'utf8').match(LANE_STATUS_RE)?.[1]?.trim();
          destStatus = readFileSync(dest, 'utf8').match(LANE_STATUS_RE)?.[1]?.trim();
        } catch {
          continue; // unreadable right now — next pass gets a clean look
        }
        if (!srcStatus || srcStatus === destStatus) continue;

        // Only ever let a LIVE status win an mtime-losing race. A terminal
        // status (success/failure/queue) sitting in a reused worktree is the
        // exact track-10019 hazard skipStatusMarkers exists to block, and
        // must not sneak in through this door — same rule as
        // mergeIndexMarkers' own allowDuringSkip exception. And, same as
        // that exception (found live 2026-09-05, tracks 10064/10065/10067),
        // "running" in the worktree's own copy is only trustworthy evidence
        // of a genuinely live run when the caller has independently verified
        // one — never on the worktree's say-so alone, since a crashed run
        // leaves "running" behind exactly as statically as a clean exit
        // leaves a terminal value.
        if (!trustRunningStatus || !/^(running|waiting)$/i.test(srcStatus)) continue;
      }
    }

    if (MERGE_ONLY_ARTIFACTS.has(file) && existsSync(dest)) {
      const artifact = readFileSync(src, 'utf8');
      const merged = mergeIndexMarkers(readFileSync(dest, 'utf8'), artifact, { skipStatusMarkers, trustRunningStatus });

      const artifactStats = statSync(src);
      const existingStats = statSync(dest);
      const lineCount = artifact.split('\n').length;
      // Suspicious if < 10 lines OR < 50% of existing OR < 500 bytes for markdown files
      const isSuspicious = (lineCount < 10) || (artifactStats.size < existingStats.size * 0.5 && existingStats.size > 100);

      if (isSuspicious && !isSuccess) {
        skipped.push({ file, reason: 'suspicious-shrink', incomingSize: artifactStats.size, existingSize: existingStats.size });
        continue;
      }
      writeFileSync(dest, merged, 'utf8');
    } else {
      const srcStats = statSync(src);
      const destStats = existsSync(dest) ? statSync(dest) : { size: 0 };
      const isSuspicious = srcStats.size < destStats.size * 0.5 && destStats.size > 200;

      if (isSuspicious && !isSuccess) {
        skipped.push({ file, reason: 'suspicious-shrink', incomingSize: srcStats.size, existingSize: destStats.size });
        continue;
      }
      copyFileSync(src, dest);
    }
    copied.push(file);
  }

  return { copied, destDir, skipped };
}
