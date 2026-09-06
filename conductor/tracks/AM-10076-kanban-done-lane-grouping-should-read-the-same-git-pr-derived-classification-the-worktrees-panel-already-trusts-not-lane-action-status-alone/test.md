# Tests: Track 10076 — Done-lane merged-ness reads git, not `lane_action_status` alone

## Test Commands

```bash
# Phase 1 + 4 — pure module and worker reconciler (node:test, zero deps)
env -u NODE_TEST_CONTEXT node --test conductor/tests/track-10076-done-lane-bucket.test.mjs
env -u NODE_TEST_CONTEXT node --test conductor/tests/track-10076-reconcile-done-status.test.mjs

# Phase 2 + 3 — server payload and React components (Vitest)
cd ui && npm test -- KanbanBoard
cd ui && npm test -- LaneFocusView
cd ui && npm test -- track-10076

# Full suites, before claiming done
cd ui && npm test
env -u NODE_TEST_CONTEXT node --test conductor/tests/*.test.mjs
```

> `env -u NODE_TEST_CONTEXT` is required for every `node --test` invocation
> in this repo (documented on track 1096). Omitting it produces spurious
> failures unrelated to the change.

## Test Cases

### TC-1 — `resolveDoneLaneBucket` (Phase 1, pure)

- [ ] TC-1.1: lane `implement`, any inputs — expected: returns `null`, so
      callers fall through to `LANE_STATUS_CONFIG` untouched.
- [ ] TC-1.2: `done`, `laneActionStatus: 'success'`, `worktreeClass:
      'mergeable'`, available — expected: "Unmerged" bucket,
      `source: 'git'`. The classification overrides a `success` status.
- [ ] TC-1.3: `done`, `'failure'`, `'conflicted'`, available — expected:
      "Unmerged — merge failed", so attempted-and-failed stays visually
      distinct from never-attempted.
- [ ] TC-1.4: `done`, `'waiting'`, `'pr-open'`, available — expected:
      "PR open" bucket, not "Unmerged".
- [ ] TC-1.5: `done`, `'success'`, `worktreeClass: null`,
      `classificationAvailable: true` — expected: plain "Success". A live
      worker reporting no unmerged branch is the genuine shipped case.
- [ ] TC-1.6: `done`, `'success'`, `worktreeClass: null`,
      `classificationAvailable: false` — expected: plain "Success" via the
      **fallback** table, `source: 'lane_action_status'`. Same label as
      TC-1.5 but must be reached by the other path — this is the `null`
      trap; a shared code path here would hide it.
- [ ] TC-1.7: `done`, `'queue'`, unavailable — expected: "Unmerged"
      (today's `DONE_LANE_STATUS_CONFIG` behaviour preserved).
- [ ] TC-1.8: `done`, `'failure'`, unavailable — expected: "Unmerged —
      merge failed". This pins the `ffeaf510` stopgap's behaviour after it
      moves into the shared module (REQ-4/REQ-8).
- [ ] TC-1.9: `done`, `'success'`, `worktreeClass: 'mergeable'`,
      `classificationAvailable: false` — expected: plain "Success". A stale
      classification is not trusted when the availability flag says the
      signal is gone; `available: false` short-circuits regardless of what
      `worktreeClass` still holds.
- [ ] TC-1.10: `worktreeClass: 'open'` or `'detached'`, done lane —
      expected: falls through to the status table. Neither is a
      done-lane unmerged signal.
- [ ] TC-1.11: the exported unmerged-classification constant is the exact
      set `planDoneLaneMigration` uses — expected: importing it into
      `done-lane-migration.mjs` changes no migration behaviour (existing
      `track-10035-migration.test.mjs` still passes untouched).

### TC-2 — tracks payload availability flag (Phase 2, server)

- [ ] TC-2.1: a worker heartbeat inside the 60s window reporting one
      unmerged track — expected: that track has `worktree_class:
      'mergeable'` and `worktree_class_available: true`; every other track
      has `worktree_class: null` and `worktree_class_available: true`.
- [ ] TC-2.2: no worker heartbeat inside the window — expected: every track
      has `worktree_class: null` and `worktree_class_available: false`.
- [ ] TC-2.3: worker present but `worktrees` column is SQL NULL — expected:
      treated as no signal (`available: false`), not as an empty
      "everything merged" report.
- [ ] TC-2.4: `GET /api/projects/:id/worktrees` returns the same array
      shape as before — expected: no regression from
      `fetchWorktreeRows()`'s new `{ rows, available }` return.

### TC-3 — Board and Lane Focus rendering (Phase 3, Vitest + RTL)

- [ ] TC-3.1: done track, `lane_action_status: 'success'`,
      `worktree_class: 'mergeable'`, available — expected: rendered under
      the "Unmerged" group heading, **not** "Success". This is the
      architectural fix; TC-3.2 is the originally-reported symptom.
- [ ] TC-3.2: done track, `'failure'`, `worktree_class: 'conflicted'` —
      expected: "Unmerged — merge failed" (track 10065's live case).
- [ ] TC-3.3: done track, `'waiting'`, `worktree_class: 'pr-open'`,
      `pr_url` set — expected: "PR open" heading and the GitHub link still
      renders on the card.
- [ ] TC-3.4: `worktree_class_available: false` across the board —
      expected: byte-identical group headings to today for every
      `lane_action_status`. **The existing `KanbanBoard.test.jsx` cases
      must pass unmodified**; if a change to them is needed, REQ-4 has been
      violated.
- [ ] TC-3.5: non-done lanes with a stray `worktree_class` set — expected:
      unchanged "Queued"/"Failed"/etc. labels; the resolver never applies
      outside `done`.
- [ ] TC-3.6: `LaneFocusView` on the done lane — expected: status chips
      read "Unmerged"/"PR open", matching the board (REQ-9). Currently they
      read "Queued"/"Waiting"; this test fails before the change.
- [ ] TC-3.7: `LaneFocusView` done-lane filter set to the unmerged bucket —
      expected: selects exactly the tracks the board groups as unmerged,
      including a `success`-status one that git says is unmerged.
- [ ] TC-3.8: grep assertion — expected: `DONE_LANE_STATUS_CONFIG` is not
      imported or defined anywhere outside the shared module (REQ-8, one
      decision point).

### TC-4 — Continuous self-heal (Phase 4, worker)

Real-git fixture repo, in the style of
`conductor/tests/track-1112-worktree-audit.test.mjs`.

- [ ] TC-4.1: track at `done:success` with an unmerged, unlocked
      `track-NNN` branch — expected: after one reconcile cycle,
      `index.md` reads `**Lane Status**: queue` and one `system` comment
      names the classification.
- [ ] TC-4.2: same track, second cycle — expected: no second comment, no
      repeated write. Idempotent (the trap `reconcilePrTracks()`
      documents).
- [ ] TC-4.3: same track but with a live lock at
      `.conductor/locks/NNN.lock` naming this machine and a running PID —
      expected: completely untouched. Never rewrite under a running merge
      (REQ-7).
- [ ] TC-4.4: lock file present but naming a dead PID — expected: treated
      as orphaned, self-heal proceeds. Mirrors
      `mainHasReopenedTrackIndependently`'s liveness reasoning.
- [ ] TC-4.5: track at `done:queue` with an unmerged branch — expected: no
      action. Already correct, nothing to heal.
- [ ] TC-4.6: track at `done:queue` whose branch **is** fully merged
      (`auditWorktrees` omits it entirely) — expected: **not** promoted to
      `success`. Demote-only; absence is never evidence of a merge (REQ-6).
      This is the test that would catch the most dangerous possible
      regression in this track.
- [ ] TC-4.7: `shouldBlockLaneWrite()` returns blocked — expected: no
      write, no comment, no collector patch.
- [ ] TC-4.8: track at `implement:success` with an unmerged branch —
      expected: untouched. The self-heal is done-lane-scoped.
- [ ] TC-4.9: `local-fs` mode — expected: the `index.md` write still
      happens (no collector patch attempted, no crash).
- [ ] TC-4.10: after TC-4.1 requeues a track, `TrackCard` renders its ▶
      merge control — expected: visible. Pins the transitive
      reachability fix (REQ-10).

### TC-5 — Live product verification (Phase 5, manual, evidence required)

- [ ] TC-5.1: worker and API **restarted** after the change (neither
      hot-reloads), then a real unmerged done-lane track viewed on the
      board and in the Worktrees panel — expected: both call it unmerged.
      Record a screenshot or the raw `/api/projects/:id/tracks` response in
      `conversation.md`.
- [ ] TC-5.2: worker stopped, board reloaded — expected: today's labels;
      no track silently reported as shipped.

## Acceptance Criteria

- [ ] Every TC above passes, with output actually read — not inferred from
      a diff.
- [ ] `cd ui && npm test` passes, with `KanbanBoard.test.jsx` unmodified.
- [ ] No regression in `conductor/tests/track-10035-migration.test.mjs`
      after `planDoneLaneMigration` starts importing the shared constant.
- [ ] TC-4.6 and TC-1.6/TC-1.9 pass — the three `null`-trap guards. A build
      that fails any of these can report every unmerged track as shipped
      whenever the worker is down, which is worse than the bug being fixed.
