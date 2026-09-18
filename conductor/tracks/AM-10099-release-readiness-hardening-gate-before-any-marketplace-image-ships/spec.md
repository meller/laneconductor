# Spec: Release readiness — hardening gate before any marketplace image ships

## Problem Statement

This track is the **gate**, not a feature: nothing ships to a marketplace
with a test suite that cannot be trusted or with known lane-state
corruption paths still live. `AM-10098` (the v1.5 standalone VM image)
carries `**Depends On**: 10099` precisely so that this gate blocks it.

Scope items (a)–(h) were confirmed in-session by the author. **Every one
was independently re-verified against the real codebase during this
planning pass**, with file/line evidence recorded below. Two further
defects were discovered while verifying them and are filed as (i) and (j),
clearly marked as additions for the author to accept or drop.

### (a) AM-10089 was marked `done:success` with zero of its 25 files fixed

**Confirmed.** Every commit mentioning track 10089 touches only its own
`index.md`:

```
3b8e578d Track 10089: success (exit: 0)          .../index.md | 4 ++--
19f451d1 chore(track-10089): sync files before…  .../index.md | 6 +++---
2c2a823f Track 10089: success (exit: 0)          .../index.md | 6 +++---
```

An audit of all 25 files listed in `AM-10089/spec.md`'s "Files In Scope"
shows **25 of 25 still unprotected** — no `isolated-worker.mjs` import, no
`git init`, no `mkdtempSync`:

| Signal | Files having it |
|---|---|
| imports `helpers/isolated-worker.mjs` | 0 / 25 |
| any `git init` in the file | 0 / 25 |
| any `mkdtempSync` sandbox | 0 / 25 |

The mechanism AM-10089 documented is unchanged: a test that spawns the real
worker against an ungitted sandbox **nested inside the repo**
(`join(ROOT, '.test-tmp-…')`) lets `resolvePrimaryRepoRoot`'s upward `.git`
walk find the *worktree's* git dir, and the worker then `process.chdir()`s
into the **primary checkout** before doing its relative-path reads/writes
of `conductor/workflow.json`, `conductor/tracks/**`, and
`.laneconductor.json`. That is a confirmed live corruption path (it
destroyed the primary checkout's `workflow.json` twice during AM-10089's
own investigation), and for a track's own `implement`/`quality-gate` lane
action — which runs its tests from `.worktrees/NNN` — it is the **normal**
case, not an edge case.

This item is therefore a **hard prerequisite for (b)**: see REQ-2.

### (b) The baseline is red, and partly invisible

**Confirmed, and worse than reported.** Measured this session
(`cd ui && npx vitest run`):

```
Test Files  15 failed | 120 passed (135)
     Tests  39 failed | 911 passed (950)
```

The reported "~39 failing vitest cases" is exact. But **two of the 15
failed files fail at collection, not assertion** — their tests never run
at all and so are absent from the 39:

| File | Cases never executed | Collection error |
|---|---|---|
| `server/tests/api-routes.test.mjs` | 36 | `No "execFile" export is defined on the "child_process" mock` |
| `server/tests/bug-to-test.test.mjs` | 10 | same |

Root cause is known and small: `ui/server/index.mjs:3` imports
`execFile` (added for the track-10080 `git ls-files` manifest work), but
neither file's `vi.mock('child_process', …)` factory returns it. So the
true signal loss is **39 failing + 46 silently unexecuted = 85 cases**.

Full measured triage inventory:

| File | Failing | Dominant symptom |
|---|---|---|
| `src/pages/WorkflowSettings.test.jsx` | 10 | `lane-provider-select` testid absent |
| `server/tests/auth.test.mjs` | 9 | auth never enabled → expected 401, got 200 |
| `server/tests/track-1116-model-override.test.mjs` | 7 | route 404s; `syncTrackToFile is not a function` |
| `server/tests/track-1084-assignee.test.mjs` | 2 | 500 Internal Server Error |
| `server/tests/track-1102-f15-lane-reset-dispatch.test.mjs` | 2 | dispatches when it must not |
| `src/components/ChatView.wizard.test.jsx` | 2 | expected 0 POSTs, got 1 |
| `server/tests/api-keys.test.mjs` | 1 | 500 ≠ 200 |
| `server/tests/track-1033-worker-auth.test.mjs` | 1 | 500 ≠ 200 |
| `server/tests/track-10037-worker-last-track.test.mjs` | 1 | SQL lacks `ORDER BY last_used_at DESC` |
| `server/tests/track-1102-f5-ui-dispatch.test.mjs` | 1 | dispatches when it must not |
| `server/tests/track-1119-app-url.test.mjs` | 1 | `app_url` not in query |
| `src/components/ChatView.queued.test.jsx` | 1 | copy assertion |
| `src/components/NewProjectModal.test.jsx` | 1 | placeholder absent |
| `server/tests/api-routes.test.mjs` | (36 unrun) | mock missing `execFile` |
| `server/tests/bug-to-test.test.mjs` | (10 unrun) | mock missing `execFile` |

The `track-1102-f5`/`f15` pair is called out separately because those two
assert that the server does **not** dispatch when a sync+poll worker
exists — a failure there is a *real* double-dispatch bug, not a fixture
drift, and must not be quarantined.

**`local-api-e2e.test.mjs` is genuinely non-deterministic**, not simply
failing — two consecutive runs at the same commit:

```
run 1:  # pass 4   # fail 2
run 2:  # pass 3   # fail 3
```

**Discovered while measuring this:** a track worktree has no
`ui/node_modules`, so `npx vitest run` from `.worktrees/NNN` dies with
`Cannot find package '@vitejs/plugin-react'` — it never reaches a single
test. Every `implement`/`quality-gate` lane action on a `branch`-mode
track is therefore structurally unable to run the project's main test
suite. This is in scope for (b): a gate that cannot be executed where the
work happens is not a gate.

### (c) `lc worker run <track> --worker-number N` is unusable, for two independent reasons

**Both confirmed.**

**(c1) The flag value is parsed as a second track number.** `bin/lc.mjs`
in the `worker run` branch:

```js
const tracks = subArgs.filter(a => !a.startsWith('--'));
```

The filter drops flag *names* but keeps flag *values*. For
`lc worker run 10094 --worker-number 900094`, `subArgs` is
`['10094','--worker-number','900094']` → `tracks = ['10094','900094']`,
reproducing the reported log line `scoped to track(s) 10094, 900094`
exactly. This is the same defect class as (g) — both are argv parsing in
`bin/lc.mjs` — and should share one helper.

**(c2) The AM-10093 base-worker cap refuses the scoped run.** The cap
(`conductor/laneconductor.sync.mjs`, the `findLiveBaseIdentities` /
`decideWorkerIdentityCap` block) is gated only on
`!getIsLocalFs() && !isManager`. It has **no exemption for a claim-scoped
run**. `lc worker run` is a thin foreground wrapper over
`--only-tracks … --once` and registers as `worker_number` 1 — a *base*
identity per `classifyWorkerIdentity` (anything `< 100000`). So whenever
the ordinary standing worker is alive — the normal state — the default
cap of 1 makes `decideWorkerIdentityCap` return `allow:false` and the run
exits 1. The command SKILL.md calls "**Normally what you want**" cannot
run at all alongside the worker it is meant to complement. (The reported
`--worker-number 900094` was evidently an attempt to dodge this by
landing in the claim-scoped band — which then tripped (c1).)

### (d) The `Auto Run` gate contradicts its own documentation

**Confirmed.** `conductor/claim-scope.mjs`:

```js
if (onlyTracks && !onlyTracks.has(n)) return false;
if (!autoRun && !waitingForReply) return false;     // ← applies unconditionally
```

SKILL.md states the gate "never applies to `lc worker run <track>` or
explicit dispatch (`worker_dispatch`), which are direct human/manager
instructions, not auto-picking from the open queue." Because
`lc worker run` is implemented *as* `--only-tracks … --once`, it flows
through this identical predicate and IS gated. Combined with `--once`, the
observable result is a run that claims nothing and exits reporting
`no queued or running track matched […]` — indistinguishable from a typo'd
track number. Code and doc must be made to agree; this spec takes the
position that the **doc is right** (REQ-6), because a named single track
passed by a human is an instruction, not queue auto-pick.

### (e) A DB→FS pull overwrote a human-owned marker — live, on this very track

**Confirmed, with this track as the specimen.** The author committed all
five roadmap tracks with `**Auto Run**: no` (commit `4a1d31ec`, and the
commit message says so: "chained with Depends On and Auto Run off"). Today:

```
human-authored (4a1d31ec): **Auto Run**: no
worker-synced  (74a03802): **Auto Run**: yes
on disk now             : **Auto Run**: yes
```

The flip is isolated to this one track; its four siblings are untouched:

```
 10098 | plan | queue   | 0 | f | direct
 10099 | plan | running | 0 | t | direct     ← flipped
 10100 | plan | queue   | 0 | f | direct
 10101 | plan | queue   | 0 | f | direct
 10102 | plan | queue   | 0 | f | direct
```

The writer is **not** the sync worker — `updateIndexMDFromDB` never emits
an `Auto Run` marker at all. It is the **API server's** `syncTrackToFile`
(`ui/server/index.mjs`, the `updates.auto_run !== undefined` branch),
which unconditionally replaces the file's marker with the DB's boolean.

Provenance explains how the DB came to hold `t`: the row's
`created_at` is `2026-09-13 20:31:48`, i.e. after the junk
`lc new --help` track of item (g) (created 20:24) and before the author's
roadmap commit (20:33:51). Track creation writes `**Auto Run**: yes`
unconditionally (`ui/server/utils.mjs`), so the junk track's default
became the DB row for number 10099, survived deletion of the junk folder,
and was then pushed back over the author's committed `no`. **This is why
the stale `--help` planning session was able to auto-run on this folder
at all** — items (e) and (g) are one causal chain, not two coincidences.

The same row also shows the AM-10093 R4 regeneration hazard is still
loaded: `author` and `created_by_email` are **empty in the DB** while
`index.md` carries `**Author**: AM` and `**Created By**: …`. The marker
set survived this particular pull, but any full regeneration from DB
fields would drop both, exactly as observed on AM-10098.

The general defect: **DB→FS writers treat every column as authoritative,
including markers whose authority belongs to the file/human.** `Auto Run`,
`Author`, `Created By`, `Type`, `Merge Mode`, `Depends On`, and the `# H1`
title are author-owned; `Lane`, `Lane Status`, `Progress`, and `Phase` are
machine-owned. Track 1081 (summary-marker corruption) is the adjacent
precedent.

### (f) Merges never restart the long-running worker/API, so fixes ship dead

**Confirmed.** `conductor/services/worktree-merge.mjs` contains no restart
step and no staleness check — `grep -n "restart"` returns nothing. The
(e) incident's proximate cause was exactly this: the worker had started
Sep 12 13:21, the fix merged 15:32, and the process was never restarted,
so it kept executing pre-fix code for hours.

A detector already exists —
`conductor/services/worker-code-staleness.mjs`
(`classifyWorkerStaleness`, consumed by `laneconductor.sync.mjs`) — and it
classifies `critical` when a commit since the worker's `code_sha` touched
`laneconductor.sync.mjs`, `conductor/services/**`, or `constants.mjs`.
**But it has never once fired**: `grep -c worker-staleness` over the live
`conductor/.sync.log` returns `0`. So (f) is not "build a detector"; it is
"find out why the existing alarm is silent, then put its verdict somewhere
a human or the merge action actually sees, and close the loop with a
restart." This is the alarm-vs-seatbelt split that module's own header
describes.

### (g) `lc new` folds flags into the title, and `--help` is swallowed as data

**Confirmed, unchanged.** `bin/lc.mjs`:

```js
// Collect all args after 'new' up to the first --flag.      ← comment is false
const typeIdx = args.indexOf('--type');
const rawPositional = typeIdx !== -1 ? args.slice(1, typeIdx) : args.slice(1);
```

Only `--type` bounds the slice, so `--workspace`, `--merge-mode` and
`--auto-run` — all three documented in this command's own usage string one
screen below — land in `rawPositional`, corrupting the title and folder
slug and silently discarding the description. Separately, `--help` is
handled in exactly **one** place, and only when it is `args[0]`:

```js
if (!command || command === '--help' || command === '-h' || command === 'help') {
```

There are **40** `command === …` dispatch branches; none of the other 39
handles it, so free-text subcommands write the flag as data — which is how
a track titled `--help` came to exist, be auto-planned, and overwrite this
track's folder.

A full spec and 5-phase plan for this item were written in the stale
session the author describes in `conversation.md` and recovered from
`git show 4a1d31ec:…/spec.md` as the author instructed. That work is
sound, was validated against the real CLI, and is **adopted wholesale**
into REQ-9/REQ-10 and Phases 5–6 below, including its confirmed defect
table (D1/D2/D3), its blast-radius table, and its finding that
`track-10035-new-track-flags.test.mjs` passes over D2 because it asserts
folder names by substring (`d.includes('direct-auto-track')`) rather than
exactly.

### (h) The `Depends On` auto-launch gate accepts `done:queue`

**Confirmed.** `conductor/laneconductor.sync.mjs`:

```js
const unmet = dependsOn.filter(dep => laneStatusByTrackNumber[dep] !== 'done');
```

Lane `done` alone is not "shipped": since track 10035, reaching
`done:queue` means quality-gated and *queued for the merge action*, with
the code not yet on `main`. The correct precedent is already in this
codebase — `conductor/services/dependency-resume.mjs`:

```js
return state.lane === 'done' && state.laneActionStatus === 'success';
```

whose module header explains exactly why. The two dependency gates
disagree, and the weaker one governs this roadmap: `AM-10098` carries
`**Depends On**: 10099` and would be released by this gate the moment
10099 hit `done:queue`, before this very hardening work had merged.

### (i) Unrotated logs — DISCOVERED, author to accept or drop

Not in (a)–(h). Found while grepping the live worker log for (f):

```
3.9G  conductor/.sync.log
1.1G  ui/.api.log
```

5 GB of logs, and `grep -niE "logrotate|rotate|maxsize|truncat"` over
`bin/lc.mjs` and `conductor/services/logger.mjs` finds **no rotation
logic anywhere**. Filed here because this track is explicitly the gate
before a marketplace image, and the image this gates (`AM-10098`) is
specified as a 16 GB VM: unbounded logs fill that disk within weeks and
take the appliance down. Cheap to fix, catastrophic to ship.

### (j) This track's own `Auto Run` was restored during planning

Acting on (e)'s finding and the author's explicit instruction in
`conversation.md` ("Track is deliberately Auto Run: no; plan on request
only"), this planning session restored `**Auto Run**: no` in `index.md`
**and** corrected the DB row, since a file-only fix is reverted by the
next DB→FS sync. Recorded here as a spec item so the correction is
auditable rather than silent. No other track state was modified.

## Requirements

- **REQ-1**: Every one of AM-10089's 25 in-scope test files is made
  structurally immune to cwd-normalization redirecting its spawned
  worker/CLI into the primary checkout — preferably via
  `helpers/isolated-worker.mjs`'s `makeSandbox()`/`startIsolatedWorker()`,
  minimally via a real `git init -q` of a sandbox created under
  `os.tmpdir()`. A comment or `.gitignore` entry does not satisfy this.
- **REQ-2**: REQ-1 lands **before** any `node --test` baseline is
  measured. Measuring first is itself the corruption vector, so the
  ordering is a requirement, not a preference.
- **REQ-3**: `cd ui && npx vitest run` reports **zero failing tests and
  zero collection errors**. Each of the 15 currently-failing files is
  triaged in `plan.md` as *real bug* (fixed) or *environment/fixture
  drift* (fixed or quarantined), with a written reason per file.
- **REQ-4**: Quarantining is permitted only with (i) an inline
  `it.skip`/`describe.skip` carrying a reason referencing this track and
  (ii) a row in `plan.md`'s triage table. `track-1102-f5-ui-dispatch` and
  `track-1102-f15-lane-reset-dispatch` may **not** be quarantined — they
  guard a real double-dispatch invariant and must be fixed or escalated.
- **REQ-5**: The project's vitest suite is runnable from inside a track
  worktree, so `implement`/`quality-gate` lane actions can actually run
  it. `local-api-e2e.test.mjs`'s non-determinism is either fixed or
  explicitly quarantined under REQ-4.
- **REQ-6**: `lc worker run <track> [--worker-number N]` works: the flag
  value is never read as a track number, the run is exempt from the
  base-worker identity cap, and it claims its named track **regardless of
  that track's `**Auto Run**` value**. SKILL.md's existing claim becomes
  true rather than being softened to match the code.
- **REQ-7**: The auto-launch path is unchanged by REQ-6. A track with
  `**Auto Run**: no` claimed from the *open queue* still must not run;
  only an explicitly-named track (`lc worker run`, `worker_dispatch`) may
  bypass the marker. `--only-tracks` alone continues to narrow only.
- **REQ-8**: No DB→FS writer may overwrite an author-owned marker with a
  DB value. Author-owned: the `# H1` title, `Problem`, `Type`, `Author`,
  `Created By`, `Auto Run`, `Merge Mode`, `Depends On`. Machine-owned:
  `Lane`, `Lane Status`, `Progress`, `Phase`. A DB column that is null or
  empty never blanks a populated marker.
- **REQ-9**: `lc <subcommand> --help` / `-h` prints that subcommand's help
  and exits 0 with **no side effects** — no track, file, DB row, comment
  or lane move — for all 40 dispatch branches. `lc help <sub>` is an
  alias; `--` terminates option parsing; an unknown subcommand with
  `--help` falls back to top-level help.
- **REQ-10**: `lc new` treats every `--`-prefixed token as a positional
  boundary, so title and description survive `--type`, `--workspace`,
  `--merge-mode` and `--auto-run` intact; the "multiple unquoted words"
  warning fires only for genuinely unquoted input; a flag-like title is
  rejected rather than turned into a folder name.
- **REQ-11**: A merge to `main` cannot silently leave stale worker/API
  processes serving pre-merge code. Either the done-lane merge restarts
  them or it emits a warning that reaches a human. The existing
  `worker-code-staleness.mjs` verdict is reused, and its current
  never-fires condition is diagnosed and fixed.
- **REQ-12**: The `Depends On` auto-launch gate requires lane `done`
  **and** `lane_action_status: success`, matching
  `dependency-resume.mjs`. A missing/unknown dependency still fails
  closed.
- **REQ-13** *(item (i), droppable)*: Worker and API logs are bounded by
  size with rotation, defaulting to a total well under 1 GB.
- **REQ-14**: The full pre-existing suite passes; no requirement here is
  satisfied by weakening or deleting an existing assertion. Assertions
  strengthened for this track (notably
  `track-10035-new-track-flags.test.mjs`'s substring folder check) are
  called out in `plan.md`.
- **REQ-15**: Running this track's own test work leaves the primary
  checkout's `conductor/workflow.json` intact and no orphaned
  `laneconductor.sync.mjs` processes behind.

## Acceptance Criteria

Each is a user-observable outcome. None is satisfiable by a stub, and none
asserts a placeholder.

- [ ] **AC-1**: All 25 AM-10089 files spawn workers only against sandboxes
      that resolve `resolvePrimaryRepoRoot(sandbox) === sandbox`. Audit
      command shows 25/25 protected (currently 0/25).
- [ ] **AC-2**: With the test suite driven from inside `.worktrees/NNN`,
      the primary checkout's `conductor/workflow.json` is byte-identical
      before and after, and still has all 5 lanes.
- [ ] **AC-3**: A regression test spawns a worker whose sandbox sits under
      a linked worktree and asserts the worker does **not** chdir into the
      primary checkout — it fails if REQ-1's protection is reverted.
- [ ] **AC-4**: `cd ui && npx vitest run` exits 0: `0 failed`, 135/135
      files collected, and total run cases ≥ 996 (950 today + the 46
      previously unexecuted).
- [ ] **AC-5**: `server/tests/api-routes.test.mjs` and
      `bug-to-test.test.mjs` each report their full case count as run
      (36 and 10), not skipped.
- [ ] **AC-6**: `npx vitest run` executes to completion from inside a
      track worktree.
- [ ] **AC-7**: `local-api-e2e.test.mjs` passes 6/6 on **5 consecutive
      runs** (proving determinism, not one lucky pass) — or is quarantined
      per REQ-4 with its flake documented.
- [ ] **AC-8**: With the ordinary worker running, `lc worker run <track>
      --worker-number 7` logs `scoped to track(s) <track>` — one number,
      not two — starts, and exits 0 when done.
- [ ] **AC-9**: The same command succeeds on a track whose `index.md` says
      `**Auto Run**: no`, and its log shows the track claimed.
- [ ] **AC-10**: The same track left in `queue` with `**Auto Run**: no` is
      **not** picked up by a plain `lc worker start --sync-and-work`
      (REQ-7 regression).
- [ ] **AC-11**: SKILL.md's `lc worker run` / `--only-tracks` description
      matches observed behavior, verified by a test that reads the doc
      claim and exercises the code path.
- [ ] **AC-12**: A DB row with `auto_run = true`, empty `author`, and
      empty `created_by_email` pulled onto an `index.md` that has
      `**Auto Run**: no`, `**Author**: AM`, `**Created By**: …` leaves all
      three file markers **unchanged**, and the `# H1`, `Problem` and
      `Type` intact.
- [ ] **AC-13**: The machine-owned markers still sync: a DB row with a new
      `lane_status`/`progress_percent` does update `**Lane**` and
      `**Progress**`.
- [ ] **AC-14**: `lc new --help` and `lc new -h` print `new` usage, exit 0,
      and create no track folder and no `file_sync_queue.md` entry.
- [ ] **AC-15**: `lc new "My Title" "My desc" --merge-mode pr` yields
      title exactly `My Title`, description exactly `My desc`, folder slug
      ending `-my-title`, `**Merge Mode**: pr`, and **no** "unquoted
      words" warning. Same for `--workspace main` and `--auto-run no`.
- [ ] **AC-16**: Table-driven over all 40 dispatch branches: each returns
      exit 0 and non-empty, subcommand-specific help for `--help`. Spot
      checks do not satisfy this.
- [ ] **AC-17**: `lc reportaBug --help` creates no track;
      `lc comment <NNN> --help` appends nothing to `conversation.md`;
      `lc updateTrack <NNN> --help` appends nothing to `plan.md` and
      leaves the lane unchanged.
- [ ] **AC-18**: `lc comment <NNN> -- --help` appends the literal `--help`
      (the `--` escape hatch works).
- [ ] **AC-19**: `lc new` rejects a flag-like title with a non-zero exit
      and a clear message, creating nothing.
- [ ] **AC-20**: A worker started before a commit that touches
      `conductor/services/**` is reported as stale **somewhere a human
      sees** — merge output, a track comment, or the UI — not only in
      `.sync.log`. Demonstrated end to end, with the observation recorded.
- [ ] **AC-21**: After a done-lane merge, either the worker/API are
      confirmed restarted (new pids serving post-merge code) or the merge
      emitted the AC-20 warning. A merge that does neither fails this.
- [ ] **AC-22**: A track with `**Depends On**: N` stays queued while N is
      `done:queue`, and auto-launches once N reaches `done:success`. A
      `Depends On` naming a nonexistent track stays blocked.
- [ ] **AC-23** *(REQ-13, droppable)*: With rotation configured, a worker
      writing sustained output keeps its log directory under the
      configured cap, verified by driving real output past the threshold.
- [ ] **AC-24**: `conductor/quality-gate.md`'s commands all run green, and
      `ps aux | grep laneconductor.sync.mjs` shows no orphans after the
      suite.
- [ ] **AC-25**: This track's `index.md` reads `**Auto Run**: no` and its
      DB row reads `auto_run = f`, still in agreement after a full worker
      sync cycle (proves AC-12 in situ on the original specimen).

## Non-Goals / Decisions

- **Not** fixing AM-10091's `Depends On` gate beyond REQ-12's
  `done:success` tightening. Broader dependency semantics stay with that
  track.
- **Not** addressing AM-10098's REQ-2 (the API binding all interfaces with
  auth disabled). Cross-referenced by the author and a real today-risk for
  any LAN-reachable install, but **owned by the standalone track**. This
  gate only records the dependency.
- **Not** re-opening AM-10089. It is superseded in place: this track does
  the work its acceptance criteria claimed, and should note AM-10089's
  `done:success` as false.
- **Not** adding a CLI framework (commander/yargs) for REQ-9/REQ-10 —
  disproportionate across 40 branches. Per-subcommand help is added
  alongside the existing top-level template literal.
- **Not** renaming or restructuring any track folder.
- **Accepted trade-off (REQ-9)**: a bare `--help` after a free-text
  subcommand always reads as a help request; posting it literally needs
  `--`. A quoted string merely *containing* `--help` is one argv token and
  is unaffected.
- **Deferred, explicitly, with no satisfiable criterion here**: making
  `local-api-e2e`'s non-determinism a permanent structural fix if REQ-4
  quarantine is chosen instead. Phase 3 carries it as an unchecked task;
  this track cannot reach `done` claiming flake-freedom it only skipped.

## Data Model Changes

None. No schema change and no migration. One **data** correction, already
applied and recorded as item (j): `tracks.auto_run` set back to `false`
for track 10099 to match the author's committed intent.
