# Spec: Out-of-band git sync + worktree visibility/merge

## Problem Statement

Two confirmed gaps in how LaneConductor relates to git. Both were checked
against live state on this machine at planning time (2026-08-13), not
assumed.

### Gap 1 — per-track worktrees are completely invisible

`git worktree list` → **48 worktrees**. `git branch --no-merged main` →
**44 branches** carrying commits that exist nowhere but in `.worktrees/`.
`grep -rn worktree ui/src ui/server/index.mjs` returns only a path-isolation
*test* file — there is no API endpoint, no UI panel, and no `lc` subcommand
that lists worktrees or their merge state. The only way to see any of this
is raw `git` in a terminal.

### Gap 2 — the automatic merge path has two real bugs

Planning-time audit of all 44 unmerged branches (see Audit Findings below)
found 3 branches whose track is already at `**Lane**: done` /
`**Lane Status**: success` and yet never merged. Two distinct causes:

- **RC-A — merge is gated on the worktree directory existing.**
  `mergeAndRemoveWorktree` (`conductor/laneconductor.sync.mjs:3327`) returns
  early at `if (!existsSync(worktreePath))` *before* attempting any merge.
  But the branch outlives the directory: once a worktree is removed by any
  other path (`removeWorktree` on failure, `per-lane` lifecycle, manual
  `git worktree remove`, `git worktree prune`), the branch is stranded
  permanently and no later run can ever merge it. Confirmed on tracks
  **1044** and **1059** — both `done:success`, both `wt=no`, both unmerged.

- **RC-B — merge only fires from one specific code path.**
  It is called only from `spawnCli`'s exit handler, under
  `lifecycle === 'per-cycle' && targetLane === 'done' && isSuccess`
  (`laneconductor.sync.mjs:3912`). `targetLane` comes from `resolveTransition`
  on *this worker's own action*. Every other route to `done` — a human
  dragging the card in the UI, `lc move NNN done`, an agent writing
  `**Lane**: done` into `index.md`, or a quality-gate run that completed on a
  different machine — leaves the branch unmerged forever. Confirmed on track
  **1099**: `done:success`, worktree present, branch touches exactly one file
  (`conductor/tracks/1099-.../index.md`) with **zero** overlap against the
  dirty working tree, so a merge would have succeeded cleanly — it was simply
  never attempted.

### Gap 3 — nothing detects out-of-band git activity

The only git-network call in the worker is `git fetch origin <main> --quiet`
(`laneconductor.sync.mjs:3108`, mirrored in `conductor/lock.mjs:40,149` and
`conductor/agent-runtime.mjs:71,137`), and it runs *only* while claiming a
git lock. `fetch` updates remote-tracking refs and nothing more — nothing
pulls, merges, or re-syncs FS→DB from a change that originated in git. A
third party pushing directly to the remote is invisible to every worker
until some unrelated lock claim happens to fetch, and even then nobody looks
at the result.

## Audit Findings (Phase 1 — performed at planning time 2026-08-13; **corrected 2026-08-13 during Phase 2 implementation**)

**Correction**: the original classification below checked each branch
against **main's current** `index.md` lane state. That's the wrong
source — it's exactly the mistake this same investigation caught (and
self-corrected) on track 1084 earlier the same day: main's current state
answers "where is this track now," not "does this specific branch still
represent unmerged, wanted work." A branch can show up as looking `done`
purely because main progressed the track *independently, through a
different path*, while the branch itself never got that far. The
question that actually matters is what the **branch's own tip commit**
says, cross-checked against whether main has since re-progressed the
same track's lane independently (i.e. the merge-base's lane differs from
main's current lane for that track).

Rebuilt as `conductor/services/worktree-audit.mjs` (Phase 2, TDD, 6
passing tests including one written specifically to catch this class of
mistake) and re-run against this repo's real, current 44 branches:

| Class | Count | Meaning |
|-------|-------|---------|
| `open` (not done:success on its own branch tip, or main independently re-progressed the same track since) | 42 | Working as designed, or superseded by later work on main — neither is a bug, and neither needs recovery. |
| `mergeable` (branch tip is done:success, worktree present, clean 3-way merge) | 2 (1053, 1069) | **Genuine pending merges** — this IS the actionable backlog. |
| `stranded` / `conflicted` | 0 | None currently. |

**What this means for tracks 1044/1059/1099** (the original write-up's
RC-A/RC-B examples): verified directly against `git show <ref>:<path>`
for all three — **none of their own branch tips ever reached
`done:success`** (1044/1059 stop at `quality-gate:queue`; 1099 stops at
whatever its last real commit was). Main reached `done:success` for all
three through a *separate* path. These branches are stale/superseded —
same conclusion the original write-up's own "orphaned-source sweep"
paragraph already reached for 1059 specifically ("already present in
main by another route... stale/superseded, not lost"), which was in
direct tension with that same write-up's RC-A table calling 1059
"permanently stranded" two paragraphs earlier. This correction resolves
that contradiction: 1059 (and 1044, 1099) are `open`/superseded, not
`stranded` — nothing to rescue, safe to eventually prune once each is
individually confirmed to carry no unique source changes (1059 already
confirmed by the original sweep; 1044/1099 not yet individually swept —
folded into Phase 2's remaining work below).

**RC-A and RC-B as *mechanisms* are still real and still worth fixing**
— `mergeAndRemoveWorktree`'s early-return on a missing directory, and the
single-exit-handler-only merge trigger, are genuine gaps confirmed by
reading the code directly (`laneconductor.sync.mjs:3327`,
`:3912`). What changed is the **evidence for how often they fire in
practice** on this specific machine right now: 0 currently-stranded
branches, not 3. The fixes are still worth making (an 1104-shaped
incident is proven possible via commit `902ee2f`), just not urgent
backlog-clearing the way the original numbers implied.

**Conclusion, corrected:** today's damage is visibility only — 0
lifecycle-bug casualties currently sitting in this repo, and no
currently-unrecovered code loss. The loss mode is still proven, not
hypothetical (commit `902ee2f`, `.worktrees/1104`) — invisibility is
still what turns a five-minute fix into a partial loss when it does
happen. That case for Phase 2 (visibility) and Phase 3 (lifecycle fixes,
as prevention rather than backlog-clearing) is unchanged; only the
"3 branches need rescuing right now" framing was wrong.

## Solution

Four capabilities, ordered so each is independently useful:

1. **`lc worktrees`** — a local, zero-infrastructure listing of every
   worktree with its track, lane, commits ahead/behind main, dirty-file
   count, and a classification (`mergeable` / `open` / `stranded` /
   `conflicted`). Works in every mode including `local-fs`, needs no API,
   no DB, no UI.
2. **Lifecycle fix + reconciler** — fix RC-A and RC-B in the worker so the
   common case stops producing stranded branches at all, and add a
   reconciliation pass that catches branches stranded by *any* route.
3. **Manual merge** — `lc worktrees merge <track>` for the exceptional case
   (and for retroactively clearing the existing backlog).
4. **Out-of-band git detection** — periodic fetch + divergence reporting,
   with auto-pull only when provably safe.

### Design decisions (made at planning, with rationale)

**D-1 — CLI before UI.** Worktrees are physically per-machine; the API can
be remote. A local `lc` command needs no reporting protocol and is the only
option that works in `local-fs`. The UI panel (Phase 7) layers on top by
having the worker report its inventory through the existing
`/worker/heartbeat` call (`laneconductor.sync.mjs:877`) — it does not
replace the CLI.

**D-2 — Reconcile on lane state, not on exit-handler side effects.** RC-B
exists because merging is a side effect of one transition. The reconciler
instead asks a state question — *"is this branch's track at `done:success`,
and is the branch unmerged?"* — which is true regardless of how the track
got there. This is what makes it robust to UI drags and cross-machine
quality gates.

**D-3 — Never merge a branch whose worktree is missing *silently*, but do
merge it.** RC-A's guard is inverted: branch existence is the precondition
for merging; worktree existence is the precondition for *removing the
worktree*. Split those two checks.

**D-4 — Detect-and-surface for out-of-band pushes; auto-pull only on a
provably safe fast-forward.** The main repo working tree is routinely dirty
(104 modified files at audit time, mostly `conductor/tracks/**/index.md`
churn from the sync worker itself). A blind `git pull` there could clobber
uncommitted state or start a merge nobody asked for. Auto-pull is therefore
gated on: (a) local `main` is strictly behind `origin/main` with no
divergence, (b) fast-forward is possible, and (c) no tracked file that the
incoming commits touch is dirty locally. Anything else is reported, never
acted on.

**D-5 — Merges happen in a scratch worktree, not the primary checkout.**
`mergeAndRemoveWorktree` currently runs `git checkout <main>` and `git merge`
in `process.cwd()` — the shared primary working copy, with its 100+ dirty
files and possibly a human sitting in it. That is both a correctness hazard
(merge aborts on dirty overlap) and a concurrency hazard (two workers, one
checkout). New merge code uses a dedicated ephemeral worktree for the merge
and leaves the primary checkout untouched.

## Requirements

- **REQ-1**: `lc worktrees` lists every worktree under `.worktrees/` with:
  track number, track title, current lane + lane status, commits ahead of
  main, commits behind main, uncommitted-file count, and classification
  (`mergeable` | `open` | `stranded` | `conflicted`). Also lists **branches
  with no worktree** (`track-*` unmerged, directory gone) — those are exactly
  the RC-A stranded cases and are invisible to `git worktree list`.
- **REQ-2**: `lc worktrees` works with `mode: local-fs` (reads lane state
  from `index.md`, never requires an API or DB) and adds no new dependency.
- **REQ-3**: RC-A fixed — `mergeAndRemoveWorktree` merges a branch whose
  worktree directory is absent, and only skips the *directory removal* step
  in that case.
- **REQ-4**: RC-B fixed — a `reconcileWorktrees()` pass runs on the worker's
  heartbeat and merges any `track-NNN` branch whose track is at
  `done` + `success` and which is unmerged, regardless of which code path
  moved it there. Idempotent; a no-op when there is nothing to do.
- **REQ-5**: Reconciliation is conservative: it never merges a branch whose
  track is not `done:success`, never force-deletes a branch it did not
  successfully merge, and on merge conflict leaves branch + worktree intact,
  reports the conflict, and moves on to the next branch.
- **REQ-6**: `lc worktrees merge <track>` merges one branch on demand,
  including the stranded (`wt=no`) case, and reports what it did. Refuses,
  with an explanatory message, when the track is not at `done:success`
  unless `--force` is passed.
- **REQ-7**: All merge operations run in an ephemeral scratch worktree (D-5);
  the primary checkout's branch and dirty files are unchanged by any merge.
  Verified by asserting `git rev-parse --abbrev-ref HEAD` and
  `git status --porcelain` in the primary checkout are unchanged across a
  merge.
- **REQ-8**: The worker periodically fetches `origin/<main>` on a configurable
  interval (`git.fetch_interval_ms` in `.laneconductor.json`, default 300000,
  `0` disables) and records local-vs-remote divergence (ahead/behind counts).
- **REQ-9**: When local `main` is behind `origin/main`, the divergence is
  surfaced to the user — in `lc worktrees` output (or `lc git status`) and
  in the worker log — naming the commit count and whether a safe
  fast-forward is available.
- **REQ-10**: Auto-pull fires only under all of D-4's conditions, and after a
  successful pull the worker re-syncs any `conductor/tracks/**/index.md`
  changed by the pulled commits so out-of-band track state reaches the DB.
- **REQ-11**: When conditions for a safe pull are not met, the worker takes
  no git-mutating action and says why (diverged / dirty overlap / conflict
  risk). It must never leave the primary checkout mid-merge.
- **REQ-12** *(Phase 7, may be deferred)*: The UI shows the project's
  worktree inventory (project-scoped, not per-worker — see D-6), with a
  merge action that dispatches to the assignee's own worker via 1084's
  existing continuity-first routing rather than an arbitrary idle worker.
- **REQ-13** *(Phase 7)*: `TrackDetailPanel` shows the single worktree
  belonging to that track (if any) as a secondary, detail-level view of the
  same data REQ-12 lists project-wide.

**D-6 — the worktree panel is project-scoped, not worker-scoped.**
`.worktrees/` lives at the shared repo checkout's `process.cwd()`, not
inside any individual worker process's private state, so every worker for a
project on the same host reports an identical list — the heartbeat is a
transport, not a per-worker-owned resource. `GET
/api/projects/:id/worktrees` (not `/api/workers/:id/worktrees`), deduped
across workers on one host, grouped by host when more than one has reported.

**D-7 — the merge button reuses the existing dispatch mechanism, not a new
one.** `action: 'merge-worktree'` on the existing `POST
/api/projects/:id/dispatch` (same `worker_dispatch` table, poll loop, and
`PATCH /worker-dispatch/:id` result path already used by
`deploy`/`build`/`provision-worker`, `ui/server/index.mjs:3187`). The target
`worker_id` is resolved via 1084's `resolveAssignee`/`resolvePinnedWorkers`
(`ui/server/index.mjs:3801`), keeping continuity-first stickiness rather than
picking any idle worker — consistent with how every other track-scoped
dispatch already routes, even though a git merge itself needs no LLM
context.

## Acceptance Criteria

Each criterion describes something a person can observe. None is satisfied
by a stub.

- [ ] AC-1: Running `lc worktrees` in this repo prints a row for every one
      of the 48 worktrees and for every unmerged `track-*` branch with no
      worktree, with a non-placeholder ahead/behind/dirty count on each row.
- [ ] AC-2: In that output, tracks **1044** and **1059** appear classified
      `stranded` (branch unmerged, no worktree) and **1099** appears
      classified `mergeable` — matching the audit above, computed by the
      code, not hardcoded.
- [ ] AC-3: `lc worktrees` produces the same listing with the project set to
      `mode: local-fs` and no API or database reachable.
- [ ] AC-4: `lc worktrees merge 1099` merges `track-1099` into `main`, and
      afterwards `git branch --no-merged main` no longer lists it.
- [ ] AC-5: `lc worktrees merge 1044` merges the stranded branch even though
      `.worktrees/1044` does not exist (the RC-A case that is impossible
      today).
- [ ] AC-6: Immediately before and after any merge, the primary checkout's
      `git rev-parse --abbrev-ref HEAD` and `git status --porcelain` output
      are byte-identical — the merge did not touch the shared checkout.
- [ ] AC-7: With a track moved to `done:success` by a UI drag (not by a
      worker action), a running worker merges its branch within one
      reconciliation interval, and the worker log names the branch it merged.
- [ ] AC-8: A branch deliberately conflicting with `main` is left unmerged
      and its worktree intact after reconciliation; the conflict is reported;
      the next reconciliation pass still processes other branches normally.
- [ ] AC-9: After a commit is pushed to `origin/main` from outside
      LaneConductor, a running worker reports the divergence (commit count +
      whether a fast-forward is safe) within one fetch interval, observed in
      the worker log and in the CLI output.
- [ ] AC-10: In the safe case (clean fast-forward, no dirty overlap), the
      worker pulls and a track whose `index.md` changed only in that pushed
      commit shows its new lane in the database.
- [ ] AC-11: In the unsafe case (local `main` diverged, or a dirty file
      overlaps the incoming commits), the worker performs no merge/pull, the
      repo is not left mid-merge (`git status` shows no `MERGING` state), and
      the reason is stated.
- [ ] AC-12: The existing worktree-lifecycle tests
      (`conductor/tests/track-1035-worktree-lifecycle.test.mjs`) still pass.
- [ ] AC-13 *(Phase 7)*: The project's Worktrees panel lists the same rows
      as `lc worktrees` for that project, and clicking "Merge to main" on a
      `mergeable` row creates a `worker_dispatch` row with
      `action = 'merge-worktree'` whose `worker_id` is the assignee's own
      worker (per 1084's `resolveAssignee`/`resolvePinnedWorkers`), not
      merely the first idle worker for the project.

## Out of scope for this track (explicitly deferred, not "done")

- **UI worktree panel + merge button (REQ-12, REQ-13)** — Phase 7 remains
  unchecked in `plan.md` if not implemented. Per the done-gate, this track
  cannot be marked `done` at 100% while Phase 7 is open; it would land at
  `review` with the remaining phase named.
- Retroactively merging the existing 41 legitimately-open branches. They
  belong to tracks that are not finished; they resolve normally as those
  tracks reach `done`.
- Multi-machine worktree coordination (worktrees are per-machine; nothing
  here tries to merge another machine's branch).

## Data Model Changes

None required for Phases 1–6. Phase 7 (if implemented) adds a
`worker_worktrees` JSON payload to the existing worker heartbeat — no new
table; it is reported state, not durable record.

## Configuration

New optional keys in `.laneconductor.json` (all backward compatible; absent
means default):

```json
{
  "git": {
    "fetch_interval_ms": 300000,
    "auto_pull": true,
    "reconcile_worktrees": true
  }
}
```

- `fetch_interval_ms: 0` disables out-of-band detection entirely.
- `auto_pull: false` keeps detection/reporting but never pulls.
- `reconcile_worktrees: false` keeps the RC-A/RC-B fixes but disables the
  background pass (manual `lc worktrees merge` still works).
