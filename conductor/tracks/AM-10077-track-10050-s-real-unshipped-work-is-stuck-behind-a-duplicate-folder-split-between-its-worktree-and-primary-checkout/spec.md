# Spec: Reconcile Track 10050's Split State And Land Its Unshipped Worktree-Base Fix

## Problem Statement

Track 10050 ("Worktree Base Freshness — Start Track Branches From origin/main")
carries a complete, tested Phase 1–5 implementation that has never reached
`main`. It is simultaneously recorded as `done:success` in the database — which
this project's own docs define as "the code is actually reachable from local
`main`" — while the bug it fixes is still live in `main` today. Nothing
surfaced the contradiction because the track's state is split across three
copies of its own `index.md`, each authoritative for a different field, and
none authoritative overall.

### Investigation findings (all verified 2026-09-07)

**F1 — The three copies, and what each one actually knows.**

| Copy | Progress / Phase | Lane Status | Merge Mode | Written by |
|------|------------------|-------------|------------|------------|
| Branch `track-10050` (`TU-10050-.../index.md`) | `100%` / "Implementation complete — all 5 phases done" | `queue` | **absent** | the lane-action sessions that ran in the worktree |
| Primary checkout `TU-10050-.../index.md` | `0%` / `New` | `success` | `direct` | DB→FS pull |
| Primary checkout `10050-.../index.md` (bare, no prefix) | `0%` / `New` | `success` | `direct` | DB→FS pull, into a stale duplicate folder |

The split is **not** a race between two writers over the same fields. Each side
is the only writer of a different set of fields, and neither ever learns the
other's:

- **Progress / Phase / Track Kind** are written by the lane-action session,
  which runs inside the worktree and commits to the topic branch. They reach
  the primary checkout only via the worktree→primary artifact merge, which runs
  at merge time — and this track never merged. So the primary copy is
  permanently stuck at the pre-implementation `0% / New`.
- **Merge Mode** originates in the database (`tracks.merge_mode`) and is
  written to disk by the DB→FS pull, which by design only ever writes the
  primary checkout. It therefore can never appear on the topic branch. Git
  history confirms this: the marker entered the primary copy in
  `31470d4a` / `b7b9bf4e`, both `chore(...): sync ... DB->FS` commits, never in
  a `feat(track-10050)` commit.

So the correct answer to "which copy is authoritative" is **neither — provenance
is per-field**, and the reconciliation has to be field-level.

**F2 — The `direct` merge mode is trustworthy.** The track's own problem
statement flagged this as unclear. It is not: `tracks.merge_mode = 'direct'`
holds in the database for 10050 *and* for its whole sibling batch
(10049/10051/10052), which is a deliberate uniform setting, not duplicate-folder
noise. The `direct` intent predates and is independent of the folder confusion.

**F3 — The DB's `done:success` is false, and is the reason this sat unnoticed.**
The database row reads `lane_status=done, lane_action_status=success,
progress_percent=0, current_phase='New'`. Per `conductor/workflow.md`,
`done:success` means the code is reachable from `main`. It is not. The branch's
own copy is more honest (`done:queue` — awaiting the merge action). The
`0% / New` alongside `success` is internally contradictory on its face and
should have been detectable as such.

**F4 — The work is still wanted; all three defects it fixes are live on `main`.**
Verified directly against the current primary checkout:

- `conductor/laneconductor.sync.mjs:4458` still passes `startPoint: 'HEAD'`.
- The same call site then rebuilds the git command by hand with `HEAD`
  hardcoded back into the ternary, silently discarding whatever start point
  `resolveWorktreeAddArgs` decided. Two renderings of one decision, free to
  disagree. This is the more insidious half of the bug and is present verbatim.
- `conductor/lock.mjs:138` still hardcodes `origin/main`, which breaks any repo
  whose default branch is not named `main`.
- `conductor/services/worktree-start-point.mjs` and
  `conductor/services/main-branch.mjs` do not exist on `main`.
  (`conductor/services/worktree-create-args.mjs` does exist — it predates 10050,
  which only extended it.)

**F5 — The branch cannot be merged, only ported.** `git merge-base main
track-10050` returns empty: the two histories share **no** common ancestor. This
is the same rewrite discontinuity already documented inside
`conductor/services/worktree-audit.mjs`. A plain `git merge` or `lc worktrees
merge 10050` would present a 58,000-line diff spanning 292 unrelated files. The
real work is four commits (`d509f623`, `dfcaf2d1`, `2dca319e`, `1f6f6b2d`)
totalling roughly 900 lines, most of it in new files. Fortunately the target
call site in `main`'s `laneconductor.sync.mjs` is still textually near-identical
to the branch's pre-fix version, so the port is small despite the drift.

**F6 — The merge-mode misread is general, not specific to 10050.**
`readTrackStateFromBranch()` in `conductor/services/worktree-audit.mjs` reads
`**Merge Mode**` "straight off the branch tip" and defaults a missing marker to
`pr`. Given F1, the marker structurally cannot be on the branch for any track
whose merge mode came from the database. Sampling six tracks with live
worktrees found three (10050, 10067, 1119) with the marker present in the
primary checkout and absent on the branch — each of them silently
misclassified as `pr`, and each offered the wrong "Run Merge Action" flow in
the Worktrees panel. This mirrors exactly the PR-fields fallback added in
`e84a27eb` on 2026-09-06, and generalises it.

**F7 — Folder debris.** Six directories in the primary checkout claim track
10050: the registered `TU-10050-...`, a bare `10050-...`, two
`_duplicate-10050-...`, and two `_quarantine-10050-...`. `tracks-metadata.json`
registers exactly one (`conductor/tracks/TU-10050-...`), which is also what
`lc track-dir 10050` resolves. All four `_duplicate`/`_quarantine` copies are
degenerate `plan/queue/0%` stubs with a two-line `spec.md`. The bare
`10050-...` copy is a DB→FS-pull artifact with no plan, no test, and a stub
spec. None carries unique content.

## Requirements

- **REQ-1** — Establish and record `conductor/tracks/TU-10050-...` as the single
  folder for track 10050, and remove the five redundant directories from the
  primary checkout. Nothing unique may be lost; verify per-file before deleting.
- **REQ-2** — Reconcile 10050's state field-by-field per F1, producing one
  `index.md` in the surviving folder that carries the branch's real
  implementation state (`Progress: 100%`, the real `Phase`, `Track Kind: bug`)
  and the DB's `Merge Mode: direct`.
- **REQ-3** — Correct 10050's false `done:success`. Until its code is actually
  on `main`, its lane status must not claim success. It moves to `done:queue`
  (awaiting merge) and the database row must agree with the file.
- **REQ-4** — Port 10050's implementation onto `main` for real: the new service
  modules and their tests, plus the `laneconductor.sync.mjs` and `lock.mjs`
  call-site changes. Port by transplant, not by `git merge` — F5.
- **REQ-5** — After the port, `createWorktree()` must base a genuinely new
  track branch on a resolved start point, and must render the git command from
  that resolved decision rather than rebuilding it with `HEAD`. An existing
  branch must still never be reset onto a fresher base (track 1114's data-loss
  regression must not return).
- **REQ-6** — After the port, `conductor/lock.mjs` must resolve the default
  branch rather than hardcoding `origin/main`.
- **REQ-7** — The start-point resolution must remain best-effort: an
  unreachable origin, a missing remote, or a corrupt ref degrades to the local
  default branch (and then to `HEAD`), never throws, and never blocks a track
  from running.
- **REQ-8** — `readTrackStateFromBranch()` must fall back to the primary
  checkout's `**Merge Mode**` marker when the branch's own copy has none, before
  falling back to the `pr` default. The branch's marker, when present, still
  wins.
- **REQ-9** — REQ-8 must not regress the existing PR-fields fallback
  (`e84a27eb`) or the no-merge-base handling that tracks 9997/10011/10067 depend
  on.
- **REQ-10** — Close out track 10050 itself: once REQ-4 lands, 10050's work is
  shipped and its unmergeable branch and worktree are removed, with the
  supersession recorded on the track.

### Note: Phase 2 touches two fundamental docs

10050's Phase 4–5 commit also added a "Worktree base resolution" section to
`conductor/product.md` and a companion paragraph to `conductor/workflow.md`,
and REQ-4's port carries those over. This is flagged for visibility, not as a
conflict: both additions **document** the new resolution mechanism and
explicitly preserve the existing track-1114 guarantee (a resumed branch is
never re-based). Neither contradicts anything currently in those files. If a
reviewer disagrees that these belong in the fundamental docs, that is a
judgment call to make before Phase 2 lands, not after.

## Non-Goals

- Fixing the underlying DB→FS pull behaviour that keeps rewriting the primary
  checkout's `index.md` with a stale `0% / New`. That is the general
  worktree→primary state-propagation gap; this track only reconciles 10050's
  instance of it and makes the audit read the right field. A durable fix is a
  separate effort.
- Auditing or reconciling 10050's sibling tracks (10049/10051/10052), which the
  database shows in the same `0% / New` + `done:success` shape. Named here so
  the pattern is on record, not fixed here.
- Any change to the DB→FS pull's single-writer rule, or to which checkout the
  pull targets.

## Acceptance Criteria

- [x] `lc track-dir 10050` resolves `conductor/tracks/TU-10050-...`, and that is
      the only directory under `conductor/tracks/` matching track 10050.
      Verified 2026-09-07: `lc track-dir 10050` prints exactly that path,
      exit 0; only two `10050`-matching entries under `conductor/tracks/`
      are `TU-10050-...` itself and track 10077's own folder (which merely
      contains "10050" in its slug).
- [x] Track 10050's `index.md` in the primary checkout shows `Progress: 100%`,
      the real completed phase, `Track Kind: bug`, and `Merge Mode: direct`
      together in one file. Verified — all four present together in
      `TU-10050-.../index.md`.
- [x] A developer starting a new track gets a branch based on the freshest base
      that loses no local commits — confirmed by creating a real worktree with
      the worker after the port and observing the branch's actual base commit,
      not by reading the diff. Verified 2026-09-07 by invoking the actual
      ported `probeWorktreeStartPoint()`/`renderWorktreeAddCommand()` for real
      against the live primary checkout (not a fixture): resolved
      `startPoint: 'main'` (reason `local-ahead`), rendered
      `git worktree add -B track-999999-verification-scratch <path> main`,
      and the new branch's HEAD matched `main`'s HEAD exactly. Scratch
      worktree/branch removed after.
- [x] Creating a worktree for a track whose branch already exists leaves that
      branch's existing commits intact. Covered by TC-13
      (`track-10050-worktree-base-e2e.test.mjs`) against a real git repo —
      passing.
- [x] With `origin` unreachable, worktree creation still succeeds, using the
      local default branch. Covered by TC-14/TC-15 in the same suite, against
      real disposable repos (a genuinely unreachable remote URL, and a repo
      with no local main ref) — both passing.
- [x] `conductor/lock.mjs` works in a repository whose default branch is not
      named `main`. Covered by TC-17 (`track-10050-lock-cli.test.mjs`, a real
      `master`-default repo) — passing.
- [ ] The Worktrees panel shows track 10050 with its real merge mode, and does
      not offer the GitHub-PR flow for it. Confirmed by looking at the panel in
      the running UI, not by unit test alone. **Not yet literally
      confirmed in the running UI** — the production API server still serves
      `main`, which does not have this track's fix until track 10077 itself
      merges (implement runs on its own branch/worktree, never main
      directly). Substitute verification performed instead: invoked the
      patched `auditWorktrees()` directly against the real primary
      checkout's live git state, which is the exact function the panel's
      data ultimately comes from — it now resolves `mergeMode: 'direct'` for
      track 10050 (previously `pr`). Literal panel confirmation to be done
      once this track reaches `main`.
- [x] Tracks 10067 and 1119, which have the same branch-missing/primary-present
      marker shape, also report `direct` rather than `pr` in the panel.
      10067 confirmed via the same direct `auditWorktrees()` call — resolves
      `mergeMode: 'direct'`. 1119 is no longer a candidate at all: it's
      already fully merged into `main` (excluded by the audit's own
      "fully merged, nothing to report" early continue), so the fallback
      doesn't need to apply to it.
- [x] Track 10050's database row and its `index.md` agree on lane status, and
      neither claims `done:success` before the code is on `main`. Both read
      `done`/`queue` — corrected the DB row directly (it still held the
      stale `success`/`0%`/`New` state despite an earlier session's commit
      message claiming otherwise) and re-queried to confirm the write
      landed.
- [x] Track 10050's branch and worktree are gone, and the supersession is
      recorded on the track. `git branch --list track-10050` and
      `git worktree list` both confirm removal; the supersession comment is
      in `TU-10050-.../conversation.md`.
- [ ] `grep -rn "resolveWorktreeStartPoint\|probeWorktreeStartPoint" conductor/`
      finds the ported implementation in the primary checkout.

## Data Model Changes

None. `tracks.merge_mode`, `tracks.lane_status`, and
`tracks.lane_action_status` already exist; REQ-3 corrects a row's values, not
the schema.
