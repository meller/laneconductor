# Tests: Track 10034 — Auto-run demo (throwaway)

This track ships no code, so there is nothing new to unit-test. "Testing" here
means **running the live demo and confirming the observed behaviour** — plus
re-running the existing auto_run suite as a regression baseline, so a live
failure can be attributed to the environment rather than to the gate logic.

## Test Commands

```bash
# Regression baseline — the auto_run gate's existing suite (owned by track 10017)
node --test conductor/tests/track-10017-auto-run.test.mjs
node --test conductor/tests/track-10017-auto-run-phase7-e2e.test.mjs

# Worker mode + health (must read AUTOMATIC / sync+poll AND be RUNNING)
node bin/lc.mjs worker status

# Start an AUTOMATIC worker — note: MANUAL/--sync-only is the CLI default,
# so --sync-and-work is REQUIRED or nothing will ever be claimed
node bin/lc.mjs worker start --sync-and-work

# Board / status views
node bin/lc.mjs status
curl -s http://127.0.0.1:8091/api/projects/1/tracks | python3 -m json.tool

# Worker log (see caution in TC-2 — this file is very large)
node bin/lc.mjs logs worker
```

## Test Cases

### Feature: Autonomous claim of an opted-in queued track (REQ-1, REQ-2)

- [ ] **TC-1: Worker is genuinely in AUTOMATIC mode** — run
      `node bin/lc.mjs worker status`.
      Expected: `Mode: AUTOMATIC (sync+poll)` **and** `✅ RUNNING`.
      *At the time this plan was written it reported `❌ STOPPED`, so the worker
      must be started with `--sync-and-work` first.* A MANUAL worker claims
      nothing and would produce a false negative for every case below.

- [ ] **TC-2: Worker claims track 10034 with no human action** — set
      `**Lane Status**: queue` on this track, then stop touching it and watch
      the log.
      Expected: log lines naming track `10034` showing the claim and an actual
      CLI spawn.
      ⚠️ `conductor/.sync.log` is ~2.8 GB — never `cat` it. Use
      `tail -f conductor/.sync.log | grep 10034` or `node bin/lc.mjs logs worker`.

- [ ] **TC-3: Board reflects the claim** — open `localhost:8090`.
      Expected: the 10034 card is no longer in a queued state; it shows as
      running. Capture a screenshot.

- [ ] **TC-4: Views agree** — run `node bin/lc.mjs status` and the
      `curl .../api/projects/1/tracks` call at the same moment as TC-3.
      Expected: CLI, API, and board all report the same lane and status for
      10034. A disagreement is a finding — record it, don't paper over it.

### Feature: The `**Auto Run**` gate actually gates (REQ-3)

- [ ] **TC-5: Non-opted-in track is left alone** — `node bin/lc.mjs new
      "auto-run negative control" "scratch"`, leave its `index.md` with **no**
      `**Auto Run**` marker, put it in `queue`.
      Expected: after the worker has claimed 10034 and run several more poll
      cycles, this track is **still** `queue` and its number never appears in a
      claim/spawn line in the worker log.

- [ ] **TC-6: Opt-in is what flips it** — add `**Auto Run**: yes` to that same
      scratch track.
      Expected: it is now claimed on a subsequent cycle. This is the control that
      proves TC-5's non-claim was caused by the marker and not by the worker
      being idle, busy, or misconfigured. Delete the scratch track afterwards
      (`node bin/lc.mjs delete <id>`).

### Feature: Clean teardown (REQ-5)

- [ ] **TC-7: Track is fully removed** — after a human confirms the evidence is
      captured, run `node bin/lc.mjs delete 10034`.
      Expected: `ls conductor/tracks/ | grep 10034` returns nothing; the API
      track list contains no `10034`; no `10034` lock file remains under the
      locks dir.

- [ ] **TC-8: Worker survives the deletion** — `node bin/lc.mjs worker status`
      immediately after TC-7.
      Expected: still `✅ RUNNING`, no crash or error spew in the log from the
      folder disappearing underneath it. (A crash here would be a real defect
      worth its own track.)

## Acceptance Criteria

- [ ] Both existing auto_run test files pass before the live demo begins
      (baseline is green, so any live failure is attributable)
- [ ] TC-1 … TC-8 all observed and recorded in `conversation.md`
- [ ] Evidence captured: verbatim worker log lines + board screenshot
- [ ] No regressions: no source file outside `conductor/tracks/10034-*/` is
      modified by this track (`git status` proves it)
