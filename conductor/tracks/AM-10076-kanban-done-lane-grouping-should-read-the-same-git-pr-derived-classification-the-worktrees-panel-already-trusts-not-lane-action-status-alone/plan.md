# Track 10076: Done-lane merged-ness reads git, not `lane_action_status` alone

Five phases. Phases 1–3 fix the display drift; Phase 4 fixes the
reachability half (the part that actually loses work); Phase 5 closes the
audit. Each phase commits on its own.

---

## Phase 1: The shared classifier (pure, no I/O)

**Problem**: Two components decide a done-lane bucket, both inline, and a
third (`LaneFocusView`) decides it differently by accident. Any fix applied
in one place drifts from the others — which is how this track's own bug
arrived.

**Solution**: One pure module, `conductor/services/done-lane-bucket.mjs`,
exporting the whole decision. Pure so the priority rules are testable
without git, a DB, or React — the same style as `workspace-mode.mjs` and
`done-lane-migration.mjs`.

- [ ] Create `conductor/services/done-lane-bucket.mjs` exporting
      `resolveDoneLaneBucket({ laneStatus, laneActionStatus, worktreeClass, classificationAvailable })`
      → `{ bucket, emoji, label, color, source }`.
    - [ ] Returns `null` for any lane other than `done` — callers keep
          using `LANE_STATUS_CONFIG` unchanged there (REQ-3 is scoped to
          the done lane only).
    - [ ] Priority 1 — classification available AND positively unmerged:
          `pr-open` → "PR open"; `mergeable`/`stranded`/`conflicted` →
          "Unmerged", label distinguishing `failure` ("Unmerged — merge
          failed") from the rest. `source: 'git'`.
    - [ ] Priority 2 — otherwise, the `lane_action_status` fallback table,
          which is verbatim today's `{...LANE_STATUS_CONFIG,
          ...DONE_LANE_STATUS_CONFIG}` merge including the `ffeaf510`
          `failure` entry (REQ-4, REQ-8). `source: 'lane_action_status'`.
    - [ ] `classificationAvailable === false` short-circuits straight to
          priority 2, whatever `worktreeClass` holds. Never treats a
          missing classification as "merged" (the `null` trap, spec).
- [ ] Export the unmerged-classification set as a named constant and have
      `done-lane-migration.mjs`'s `planDoneLaneMigration` import it instead
      of its own inline `['mergeable','stranded','conflicted','pr-open']`
      array, so the migration sweep and the board cannot disagree about
      what "unmerged" means.
- [ ] Unit tests: `conductor/tests/track-10076-done-lane-bucket.test.mjs`
      (see `test.md` TC-1.x). Run them and read the output.

**Impact**: No behaviour change yet — nothing imports it. Pure groundwork,
independently verifiable.

---

## Phase 2: Make "no signal" distinguishable in the API

**Problem**: `worktree_class: null` conflates "shipped", "never had a
branch", and "the worker is down". The third makes the classification
unusable as a truth source unless it can be told apart.

**Solution**: `fetchWorktreeRows()` already knows whether any worker
reported inside its 60s window — it just discards that fact.

- [ ] Change `fetchWorktreeRows(projectId)` in `ui/server/index.mjs` to
      return `{ rows, available }`, where `available` is true iff the
      `DISTINCT ON (hostname)` query matched at least one live-reporting
      worker. Update both call sites (`GET .../worktrees` and
      `GET .../tracks`).
- [ ] `GET /api/projects/:id/tracks` adds `worktree_class_available` to
      every row (REQ-2), alongside the existing `worktree_class`,
      `worktree_pr_*`, `worktree_branch` fields.
- [ ] Document at the field, in the same style as the surrounding Track
      10018 comment block, that `worktree_class: null` with
      `worktree_class_available: true` means "genuinely nothing to merge",
      and that the same `null` with `false` means "unknown — fall back".
- [ ] Server test asserting both shapes (`test.md` TC-2.x).

**Impact**: One new field on the tracks payload. Purely additive; no
existing consumer reads it yet.

---

## Phase 3: Board and Lane Focus render from the classifier

**Problem**: `KanbanBoard.jsx` groups the done lane from
`lane_action_status` alone (the reported bug), and `LaneFocusView.jsx`
never applies the done-lane overrides at all — it imports only
`LANE_STATUS_CONFIG`, so its chips read "Queued"/"Failed" where the board
reads "Unmerged". Second live instance of the same drift.

**Solution**: Both import `resolveDoneLaneBucket` and stop deciding
locally.

- [ ] `KanbanBoard.jsx`: replace the `groupedByStatus` + `statusConfig`
      pair for the done lane with per-track bucket resolution through
      `resolveDoneLaneBucket`, keeping the existing
      `data-testid="lane-group-<lane>-<status>"` contract so the current
      tests and any Playwright selectors keep working.
    - [ ] Non-done lanes keep their exact current code path. This change
          must be invisible outside the done column.
- [ ] Fold `DONE_LANE_STATUS_CONFIG` into the shared module and delete the
      local const (REQ-8). Verify by grep that nothing else imports it.
- [ ] `LaneFocusView.jsx`: use the same resolver for its status chips,
      counts, and `statusFilter` matching, so a done-lane filter labelled
      "Unmerged" actually selects the unmerged tracks (REQ-9).
- [ ] Component tests (`test.md` TC-3.x), including the worker-down
      fallback case, which is the one that must not regress.

**Impact**: The board and the Worktrees panel agree, live, for the same
track at the same moment. Track 10065's exact reported symptom is fixed by
the *mechanism* rather than by a hardcoded label.

---

## Phase 4: Continuous self-heal (the part that recovers lost work)

**Problem**: A done-lane track parked at `success` with an unmerged branch
is not merely mislabelled — the queue never claims it (`done:queue` is what
gets claimed) and `TrackCard`'s ▶ never renders for it. It is unreachable.
`planDoneLaneMigration` already knows how to fix exactly this, but only
runs when a human types `lc worktrees migrate-done-lane`.

**Solution**: Run that same pure decision on the reconciler's normal cycle.
Reuse, do not reimplement.

- [ ] Add a `reconcileDoneLaneStatus()` pass in
      `conductor/laneconductor.sync.mjs`, driven by the `auditWorktrees()`
      rows `reconcileWorktrees()` already fetches this cycle — no second
      audit, no extra git shelling.
- [ ] Feed those rows to `planDoneLaneMigration(rows)` and act only on
      `type: 'requeue-done-success'` actions. `correct-merge-mode` stays
      the migration command's business (it needs DB state this pass does
      not have).
- [ ] Guards, all mandatory (REQ-6, REQ-7):
    - [ ] Skip any track with a live lock in `.conductor/locks/` — mirror
          `reconcileWorktrees()`'s own `existsSync` check, and reuse the
          same dead-PID liveness reasoning `worktree-audit.mjs` documents.
    - [ ] Route the `**Lane Status**` write through `shouldBlockLaneWrite()`
          and no-op when blocked, like every other marker-write site.
    - [ ] Demote-only. Assert in code and in test that no path here can
          ever write `success`.
    - [ ] Write only the primary checkout's `index.md` (REQ-8 single-writer,
          same scoping `reconcilePrTracks()` uses).
- [ ] Patch the collector: `lane_status: 'done', lane_action_status: 'queue'`.
- [ ] Append one `system` comment naming the classification that triggered
      it, per the Completion Comment Convention:
      `> **system**: ⚠️ Moved back to done:queue — branch track-NNN is still
      unmerged (<classification>) despite done:success. The merge action
      will re-claim it.`
    - [ ] Guard on the current status so a track already at `queue` never
          re-comments every 60s. This is the same idempotence trap
          `reconcilePrTracks()` documents for its own transitions.
- [ ] Runs on the existing `RECONCILE_INTERVAL_MS` schedule, in every mode
      including `local-fs` (worktrees are a git concept, not a DB one —
      same reasoning `reconcileWorktrees()` records).
- [ ] Tests (`test.md` TC-4.x), including the locked-track and
      never-promotes cases.

**Impact**: The stuck state stops being permanent without human
intervention. This is the phase that turns a display fix into a correctness
fix.

---

## Phase 5: Audit the rest, and verify against the running product

**Problem**: Scope item (4) asks whether anything else assumes "merged"
from the DB alone. Findings must be recorded whether or not they need code.

- [ ] Confirm or correct this planning pass's findings, and write the
      result into this file:
    - [ ] `GET /api/inbox` — buckets from comment author + leading emoji +
          `waiting_for_reply`. No merged-ness assumption. Expected: no
          change.
    - [ ] `TrackCard.jsx` ▶ gating and `DonePrLink` — `lane_action_status`
          only, both fixed transitively by Phase 4. Expected: no
          independent change, one regression test pinning it.
    - [ ] Re-grep `lane_status === 'done'` and `lane_action_status` across
          `ui/src` and `ui/server` for anything this pass missed.
- [ ] **Run the product** (quality-gate 2a — unit tests cannot show a
      board that renders the wrong heading):
    - [ ] Restart the worker and API first. Neither hot-reloads; verifying
          against a process started before the change is a false pass, and
          has produced false verdicts in this repo before.
    - [ ] With a real unmerged done-lane track, open the board and the
          Worktrees panel side by side and confirm they agree. Record the
          observation (screenshot or the actual `/api/projects/:id/tracks`
          response) in `conversation.md`.
    - [ ] Stop the worker, reload, and confirm the board degrades to
          today's labels rather than reporting everything shipped.
- [ ] Full suite: `cd ui && npm test`, and
      `env -u NODE_TEST_CONTEXT node --test conductor/tests/track-10076-*.test.mjs`.

**Impact**: The audit half of the track is closed with evidence, not
assertion.

---

## Notes for the implementer

- **The `null` trap is the whole design.** If you find yourself writing
  `if (!worktreeClass) return 'merged'`, stop and re-read spec.md's table.
  With the worker stopped, every track has a null classification.
- **`worktree_class` already exists** on the tracks payload
  (`ui/server/index.mjs`, Track 10018). Phase 2 adds availability *beside*
  it; it does not add the classification itself.
- **Do not revert `ffeaf510`.** Its behaviour is correct and becomes the
  fallback table. Only its *location* changes.
- **`planDoneLaneMigration` is not new code to write.** Phase 4 calls it.
  If you are writing a new "is this unmerged" predicate, you have
  duplicated the thing this track exists to de-duplicate.
- The `belongsInWorktreesPanel()` filter runs *before* rows are cached into
  the heartbeat, so a worktree-less `open` row never reaches the API at
  all. That is correct for the panel and harmless here (an `open` track
  isn't in the done lane), but it means the board can only ever see rows
  the panel also sees — which is precisely the agreement this track wants.
