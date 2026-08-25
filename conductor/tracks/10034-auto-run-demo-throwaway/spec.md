# Spec: Auto-run demo (throwaway)

## Problem Statement

The `**Auto Run**` gate (track 10017) and the sync+poll worker's auto-claim loop
(track 1042) are both implemented and unit-tested, but nobody has watched them
work together **live** on a real project. Unit tests prove the predicate
`isTrackClaimable()` returns the right boolean; they cannot show that a card
actually moves on the board, on its own, with no human touching it.

This track is that live demonstration. It is deliberately throwaway: it produces
**no product code**. Its deliverable is recorded, reproducible evidence that a
queued, opted-in track gets picked up autonomously — plus whatever defects the
live run surfaces that the mocked tests do not.

## Scope

**In scope**
- Driving this track itself through one autonomous claim cycle on the live
  `local-api` worker, and recording what was observed.
- Recording the negative case (a track *without* `**Auto Run**: yes` is left
  alone) so the demo shows a gate, not just a spawn.
- Discarding the track afterwards.

**Out of scope (explicitly not this track's job)**
- Any change to `conductor/laneconductor.sync.mjs`, `claim-scope.mjs`, the UI, or
  the CLI. If the demo surfaces a defect, it gets **written down here and filed
  as its own track** — not fixed under a throwaway demo track.
- Adding to the auto_run test suite. That already exists
  (`conductor/tests/track-10017-auto-run.test.mjs`,
  `track-10017-auto-run-phase7-e2e.test.mjs`); duplicating it here would be
  busywork.

## Requirements

- **REQ-1** — With a sync+poll worker running (`worker.mode` = `sync+poll`, i.e.
  started without `--sync-only`), a track whose `index.md` carries
  `**Lane Status**: queue` and `**Auto Run**: yes` is claimed and spawned by the
  worker with no human action of any kind.
- **REQ-2** — The claim is observable from outside the worker process: the
  Kanban card at `localhost:8090` moves to a running state, and `lc status`
  reflects the same lane/status.
- **REQ-3** — The negative case holds: a queued track with `**Auto Run**: no`
  (or no `**Auto Run**` marker at all — the default) is **not** claimed while
  the same worker runs, and is still sitting in `queue` at the end.
- **REQ-4** — The whole demo is reproducible from the recorded evidence: exact
  commands run, exact worker log lines, and the observed board state.
- **REQ-5** — Teardown leaves no residue: track folder, DB row, and any git lock
  are gone, and the worker keeps running cleanly afterwards.

## Observations already banked (from this track's own history)

Recording these here because they *are* the demo — this track has been sitting
in the auto-claim loop since creation, and the loop has already told us two
things the mocked tests do not:

1. **The `main`-mode dirty-checkout guard works, and is loud.**
   `conversation.md` holds **19 consecutive identical** system comments:
   *"Main-mode run blocked — the primary checkout has unrelated uncommitted
   changes outside this track's folder …"*. The guard itself is correct
   behaviour (it refused to run `main`-mode work over someone else's dirty
   tree). What it does *not* have is any dedup or backoff: it re-posts the same
   line verbatim on every poll cycle, so a blocked track floods its own
   conversation and, downstream, the Inbox.
   → **Open item, not fixed here.** Candidate follow-up track: collapse repeated
   identical blocked-run notices (post once, then stay quiet until the blocking
   condition changes). Flagged for a human to decide.

2. **A blocked claim is not a failed claim.** The worker kept re-attempting each
   cycle and eventually ran once the checkout was clean, with no retry-count
   exhaustion and no human unblock needed. That is the intended behaviour and is
   worth having on record.

3. **`conductor/.sync.log` has grown to ~2.8 GB with no rotation.** Noticed while
   setting up the observation surfaces for this demo. It is large enough that
   `cat`-ing it is itself a hazard, and it will keep growing for as long as any
   worker runs. This is unrelated to `**Auto Run**` but is a real operational
   problem on this machine right now.
   → **Open item, not fixed here.** Candidate follow-up track: rotate/cap the
   worker log (size-based rotation, or hand it to the existing Pino/Pinorama
   pipeline rather than an unbounded stdout redirect). Note that observation 1's
   per-cycle repeated comments feed directly into this — the two follow-ups are
   related but separable.

## Acceptance Criteria

Each criterion is something a person can watch happen. None of them is satisfied
by a stub, a log line asserting "not implemented", or a passing mock.

- [ ] **AC-1** — With the worker running in `sync+poll` and no human input, this
      track visibly moves out of `queue` on the board at `localhost:8090`, and a
      CLI process is actually spawned for it (confirmed in the worker log).
- [ ] **AC-2** — `lc status` shows the same lane/status as the board at the same
      moment (the two views agree).
- [ ] **AC-3** — A second queued track without `**Auto Run**: yes` is still in
      `queue`, unclaimed, after the worker has claimed this one — proving the
      gate gates.
- [ ] **AC-4** — `conversation.md` on this track contains a written record of the
      run: the commands used, the worker log lines for claim + spawn, and the
      observed board state.
- [ ] **AC-5** — Any defect the live run surfaces is written into this spec's
      *Observations* section with a named follow-up, rather than fixed in place.
- [ ] **AC-6** — After teardown, `conductor/tracks/10034-*/` does not exist, the
      DB has no row for track 10034, no `10034` git lock remains, and
      `lc worker status` still reports the worker healthy.

## Notes

- Project mode is `local-api` (collector at `http://127.0.0.1:8091`), so both the
  DB and the Kanban UI are available for observation. The demo does not need
  `remote-api`.
- This track's `**Track Kind**` is `feature` (it is not a defect fix), which
  keeps its workspace default at `branch`. Its current run is `main`-mode only
  because that was set deliberately for this session — it writes nothing outside
  its own folder either way.
