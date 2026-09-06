# Spec: Track 10076 — Done-lane merged-ness reads git, not `lane_action_status` alone

## Problem Statement

Two independent computations answer the same question — "has this track's
code actually shipped?" — and they are free to disagree:

1. **`worktree-audit.mjs`'s `classification`** (`mergeable` / `stranded` /
   `conflicted` / `pr-open` / `open` / `detached`), derived from real git
   state plus, for pr-mode tracks, GitHub's own PR state. This is what the
   Worktrees panel renders.
2. **`tracks.lane_action_status`** within the `done` lane
   (`queue` / `running` / `waiting` / `success` / `failure`), app-tracked
   bookkeeping. This is what `KanbanBoard.jsx`'s `DONE_LANE_STATUS_CONFIG`
   renders.

Confirmed live on track 10065: its merge attempt correctly failed
(unrelated git history, refused to force through), landing at
`done:failure`. `DONE_LANE_STATUS_CONFIG` mapped only `queue`→"Unmerged"
and `waiting`→"PR open", so `failure` fell through to the base config's
generic "❌ Failed" — invisible under the "Unmerged" heading the done lane
exists to surface — while the Worktrees panel correctly still showed the
track as needing a merge. A stopgap `failure` entry was committed directly
to `KanbanBoard.jsx` (`ffeaf510`) to fix that one case. The architectural
gap it papers over is untouched.

**The gap is not only cosmetic.** `lane_action_status` is also what decides
whether the merge action ever runs again: the auto-launch queue claims
`done:queue`, and `TrackCard.jsx`'s ▶ control renders only for
`done` + `queue`/`failure`. A track that is genuinely unmerged but sitting
at `done:success` is therefore not merely mislabelled — it is *unreachable*.
Nothing will ever re-merge it, and the board reports it as shipped. That
exact state already has a named remedy in this repo
(`planDoneLaneMigration`'s `requeue-done-success` rule, track 10035
REQ-11), but that remedy only ever runs as a **one-time manual sweep**
(`lc worktrees migrate-done-lane`). Nothing runs it continuously, so the
state it corrects can simply re-occur the next day.

## Design Principle (confirmed with the user)

Git — and, for pr-mode tracks, GitHub's PR-merged state, not raw local
ahead/behind, which lags a merge — is the source of truth for "has this
track's code actually shipped." The DB converges to git, never the reverse.

This is deliberately **narrow**. Which *lane* a track occupies
(plan/implement/review/quality-gate/done) is legitimate workflow state
that only the app can know, and git has no opinion on it. The claim is
scoped to one question inside one lane: *within `done`, is it actually
merged?* That one is a git/GitHub fact, and `worktree-audit.mjs` already
computes it correctly for both merge modes.

## The `null` trap (the single most important constraint)

`worktree_class` is already present on `GET /api/projects/:id/tracks`
(added by track 10018, still wired, just unused by the board since 10035).
It is `null` in **three situations that mean completely different things**:

| Why it's null | What it actually means |
|---|---|
| `auditWorktrees` omits fully-merged branches entirely | **Shipped.** The good case. |
| Track never had a branch (`workspace: main`, non-dev, pre-`implement`) | **Nothing to merge.** Also fine. |
| No worker heartbeat within 60s / `local-fs` mode / worker down | **No signal at all.** |

`fetchWorktreeRows()` only reads workers whose `last_heartbeat` is inside a
60-second window, and `refreshWorktreeSummaryCache()` returns early under
`getIsLocalFs()`. So with the worker stopped, *every* track's
`worktree_class` is `null` — indistinguishable, today, from "everything is
merged." Reading `null` as "merged" would turn a stopped worker into a
board that silently reports every unmerged track as shipped. That is
strictly worse than the bug being fixed.

Therefore: `null` means **no signal**, never "merged", and the third row
above must be made *distinguishable* at the payload level rather than
inferred.

## Requirements

- **REQ-1** — A single shared, pure classifier decides the done-lane
  display bucket from `(lane_action_status, worktree_class,
  classification_available)`. It lives in `conductor/services/` (the
  established home for pure logic shared across worker/server/UI — see
  `merge-mode.mjs`, already imported by `NewTrackModal.jsx`) so the board,
  the Lane Focus view, and any future consumer cannot each grow their own
  copy. No consumer re-derives the bucket inline.

- **REQ-2** — `GET /api/projects/:id/tracks` distinguishes "no
  classification signal" from "classification says nothing to merge". The
  tracks payload carries an explicit availability flag derived from whether
  `fetchWorktreeRows()` found any live-reporting worker at all, alongside
  the existing per-track `worktree_class`. Absent that flag, REQ-1's
  classifier is required to fall back.

- **REQ-3** — When the classification is available and positively says a
  done-lane track is unmerged (`mergeable`, `stranded`, `conflicted`,
  `pr-open`), the board groups it as unmerged regardless of its
  `lane_action_status`. `pr-open` groups as "PR open"; the other three
  group as "Unmerged", with the label distinguishing never-attempted
  (`queue`) from attempted-and-failed (`failure`).

- **REQ-4** — When the classification is unavailable, the board falls back
  to today's `lane_action_status`-only table, which must keep producing
  today's labels exactly — including the `failure`→"Unmerged" entry the
  stopgap added. Behaviour with the worker down is never worse than it is
  today.

- **REQ-5** — The self-heal is continuous, not a one-time sweep. The
  reconciler applies `planDoneLaneMigration`'s existing
  `requeue-done-success` decision on its normal cycle: a track at
  `done:success` whose branch is positively classified unmerged is written
  back to `done:queue`, in the primary checkout's `index.md` and patched to
  the collector, with a `system` comment recording why. The decision
  predicate is shared with the migration command, not reimplemented — the
  two can never drift.

- **REQ-6** — The self-heal is **one-directional**. It may demote
  `done:success` → `done:queue` on a positive unmerged classification. It
  may **never** promote anything to `done:success` from an *absent*
  classification, because absence is ambiguous (see the `null` trap). The
  merged→success direction stays owned by the code paths that actually
  observe a merge land: `reconcileWorktrees()` and `reconcilePrTracks()`.

- **REQ-7** — The self-heal routes its write through
  `shouldBlockLaneWrite()` like every other worker marker-write site, and
  skips any track holding a live lock in `.conductor/locks/` — it must
  never rewrite state out from under a merge action that is running right
  now.

- **REQ-8** — The `ffeaf510` stopgap is folded into REQ-1's classifier as
  its fallback table, not left as a parallel second mechanism, and not
  reverted (its behaviour is the correct fallback). After this track there
  is exactly one place that decides a done-lane bucket.

- **REQ-9** — `LaneFocusView.jsx` shows the same done-lane labels as the
  board. It currently imports only `LANE_STATUS_CONFIG` and never
  `DONE_LANE_STATUS_CONFIG`, so its done-lane status chips and filter read
  "Queued"/"Failed" where the board reads "Unmerged" — a second, already-
  live instance of exactly the drift this track is about, found during
  this planning pass.

- **REQ-10** — Audit and document, in `plan.md`, every other consumer of a
  "merged" assumption. Findings from this planning pass, to be confirmed or
  corrected during implementation:
  - `GET /api/inbox` buckets purely from comment author + leading emoji and
    `waiting_for_reply`. It has **no** merged-ness assumption. No change.
  - `TrackCard.jsx`'s ▶ control and `DonePrLink` gate on
    `lane_action_status` only. Both are fixed *transitively* by REQ-5 —
    once the status is corrected, the affordances appear. No independent
    change, but a regression test pins the transitive behaviour.

## Non-Goals

- Changing what any lane other than `done` means, or how any lane is
  assigned. Git is not being made authoritative for lane membership.
- Replacing `lane_action_status`. It stays the queue/claim/retry field it
  is; this track only stops it from being the *sole* answer to "is it
  merged" and makes it converge to git when it disagrees.
- Persisting the classification into a `tracks` column. It stays derived
  and live; a stored copy would be a third computation free to drift.
- Widening the 60-second worker-heartbeat freshness window, or making the
  API compute the classification itself. The worker remains the only
  process that shells out to git.
- Anything about track 10052's Hosting-rewrite gap or 10061's version
  handshake, despite the shared "silent drift" family.

## Acceptance Criteria

- [ ] With the worker running, a done-lane track whose branch is genuinely
      unmerged appears under the board's "Unmerged" heading, whichever of
      `queue` / `failure` / `success` its `lane_action_status` holds —
      matching what the Worktrees panel shows for the same track at the
      same moment.
- [ ] A pr-mode done-lane track with an open PR appears under "PR open" and
      keeps its GitHub link.
- [ ] With the worker stopped, the board renders exactly the labels it
      renders today. No track silently becomes "shipped" because the
      classification went away.
- [ ] A track parked at `done:success` with an unmerged branch is moved
      back to `done:queue` by the running worker within one reconcile
      cycle, without anyone invoking `lc worktrees migrate-done-lane`, and
      a `system` comment on the track says why.
- [ ] That same track, once requeued, shows its ▶ merge control on the card
      and is claimable by the auto-launch queue — i.e. it is reachable
      again, not just relabelled.
- [ ] A track whose merge action is running right now, holding its lock, is
      left untouched by the self-heal.
- [ ] The Lane Focus view's done-lane labels and status filter match the
      board's.
- [ ] Grepping the UI finds exactly one place deciding a done-lane bucket;
      `DONE_LANE_STATUS_CONFIG` is no longer independently consulted by any
      component.
- [ ] `cd ui && npm test` passes, including the pre-existing
      `KanbanBoard.test.jsx` cases, which keep asserting today's labels.

## Open Question for Review (non-blocking)

REQ-2 adds an availability flag to the tracks payload. The alternative —
having the API omit `worktree_class` entirely (`undefined`) when no worker
reported, versus `null` when a worker reported and this track had no
unmerged branch — needs no new field, but leans on a `null`/`undefined`
distinction surviving JSON serialization, which it does not. The flag is
the recommendation; noting the alternative was considered and rejected for
that reason.
