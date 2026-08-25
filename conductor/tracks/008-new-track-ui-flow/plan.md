# Track 008: New Track UI Flow

## Phase 1: POST /api/projects/:id/tracks endpoint ✅ COMPLETE

**Problem**: No server endpoint to create tracks from the UI.
**Solution**: Added `POST /api/projects/:id/tracks` to `ui/server/index.mjs`.

- [x] Task 1: Add `POST /api/projects/:id/tracks` to `ui/server/index.mjs`
    - [x] Read `repo_path` from `projects` table
    - [x] Compute next track number: `MAX(track_number)::int + 1` padded to 3 digits
    - [x] Derive slug from title (lowercase, spaces→hyphens, strip non-alphanumeric)
    - [x] Write `conductor/tracks/NNN-slug/index.md`, `plan.md`, `spec.md` using templates
    - [x] INSERT into `tracks` with `lane_status='backlog'`, `progress_percent=0`
    - [x] Return 201 with created row

## Phase 2: NewTrackModal component ✅ COMPLETE

**Problem**: No UI to create or resume tracks.
**Solution**: Created `ui/src/components/NewTrackModal.jsx`.

- [x] Task 1: Create `ui/src/components/NewTrackModal.jsx`
    - [x] Section A "Resume a track?" — list backlog/review tracks as clickable cards
        - [x] Clicking a card: PATCH to `in-progress`, close modal, refetch
    - [x] Section B "Create new track" — Title input + Description textarea
        - [x] Submit: POST to `/api/projects/:id/tracks`, refetch, close modal
    - [x] If no project selected: show only Section B with no resume list
    - [x] Loading/error states

## Phase 3: Header button + keyboard shortcut ✅ COMPLETE

**Problem**: No entry point in the UI to trigger track creation.
**Solution**: "+ New Track" button in board header, wired to modal, with N key shortcut.

- [x] Task 1: Add `+ New Track` button to header in `App.jsx`
    - [x] Button right of project selector
    - [x] Open NewTrackModal on click
- [x] Task 2: Add `N` keyboard shortcut
    - [x] `keydown` listener: open modal when `N` pressed and no input/textarea focused
- [x] Task 3: Wire modal close + refetch in App.jsx

## Phase 4: Fix Review Gaps ✅ COMPLETE

**Problem**: Review identified gaps to address.
**Solution**: REQ-13 removed — button is always enabled; modal handles no-project via project selector.

- [x] REQ-13 removed from spec (modal handles no-project selection internally)

## ✅ REVIEWED

---

## Phase 5: Expose per-track config at creation time (added 2026-08-25)

**Problem**: Four real per-track configuration markers now exist —
`**Merge Mode**` (track 10018: `pr`/`direct`), `**Auto Run**` (track
10017: boolean queue-claim eligibility), `**Workspace**` (track 1115:
`main`/`branch`), and `**Model**` (track 1116: per-track model override) —
and `NewTrackModal.jsx` exposes none of them. Every track created through
the UI gets all four at their silent defaults, with no way to choose
otherwise short of hand-editing `index.md` after creation.

**Bug found while surveying this, not a new-feature gap** — read before
assuming this phase is purely additive: `NewTrackModal.jsx` already
collects bug-vs-feature as its `type` state (the Feature/Bug toggle,
track 008 Phase 1) and sends it as `POST .../tracks`'s `type` field — but
`POST /api/projects/:id/tracks` (`ui/server/index.mjs`) never writes a
`**Track Kind**` marker into the new track's `index.md` at all (confirmed:
zero matches for "Track Kind" anywhere in that file). `**Track Kind**`
is `resolveWorkspaceMode`'s (1115, `conductor/services/workspace-mode.mjs`)
own explicit mechanism for durably distinguishing "a human said this is a
bug" from "inferred" — its own file comment states plainly: *"Nothing
durably persisted bug-vs-feature anywhere before this track."* Net effect,
live today: every bug filed through the UI silently loses 1115's
bug-defaults-to-main-mode behavior (D1 row 4), because the one signal that
rule depends on is collected in the modal and then discarded before it
ever reaches the file. Fixing this wiring gap is Task 1, ahead of anything
new.

**Solution**: wire `type` through to `**Track Kind**` (bug fix), and add
three new optional fields — Merge Mode, Auto Run, Model — threaded through
`POST /api/projects/:id/tracks` and written into the new track's
`index.md` at creation time itself (same place `**Lane**`/`**Progress**`
etc. already get written), not bolted on as a follow-up PATCH — a track
should never exist, even momentarily, at a config state the user didn't
choose.

- [x] Task 1 (bug fix): ~~`POST /api/projects/:id/tracks` writes
      `**Track Kind**: ${type}` into the new track's `index.md`~~ —
      **already fixed, not a live gap.** Re-checked against the current
      tree (not the stale audit this task description was written from):
      track 1115 already added this — `trackTemplates()` in
      `ui/server/utils.mjs` (called by the POST handler at
      `ui/server/index.mjs:855`) emits `**Track Kind**: bug` for bug-type
      tracks, covered by `ui/server/tests/utils.test.mjs`'s "emits
      `**Track Kind**: bug` for bug tracks" case. End-to-end wiring
      (index.md → `parseTrackKind` → `resolveWorkspaceMode`) is covered
      by `conductor/tests/track-1115-workspace-mode.test.mjs`'s TC-30 —
      ran it: 13/13 pass.
      **Correction to this task's own regression-test spec**: the
      expected outcome as originally written here ("resolves to `main`
      for an auto-queue trigger per D1 row 4") is backwards.
      `resolveWorkspaceMode`'s D5 precedence checks the unattended-trigger
      override (row 3) *before* the type-derived default (row 4) — an
      `auto-queue`/`auto-complete` trigger forces `'branch'` regardless
      of `trackType`, by design (D1: "an inferred-but-unconfirmed bug
      classification must not run unattended on `main`"). TC-30 asserts
      exactly this — `'branch'` on auto-queue for a Track-Kind-only bug —
      and TC-5 covers the case this task actually meant: a bug track
      resolves to `'main'` for a *manual-dispatch* trigger. No code
      change needed; no new test added, since TC-30/TC-5 already are the
      regression test this task asked for.
- [x] Task 2: `POST /api/projects/:id/tracks` accepts optional
      `merge_mode` (`'pr'|'direct'`), `auto_run` (boolean, default
      `false`), and `model` (string). **Correction while implementing**:
      also threaded `workspace_mode` through here — Task 4 (below, unedited
      from the original plan) requires a Workspace toggle in the UI, and a
      toggle with no server-side effect would be exactly the kind of
      placeholder-passes-acceptance-criteria stub the skill file's
      done-gate forbids; the Solution paragraph's "three new fields" count
      was simply an oversight against Task 4's own four controls.
      `merge_mode`/`workspace_mode` validated against `VALID_MODES`
      exported from `merge-mode.mjs`/`workspace-mode.mjs` (single source,
      no second allow-list); `auto_run` must be boolean or 400; `model` is
      unvalidated, confirmed by reading `buildCliArgs`'s model-resolution
      path (`conductor/laneconductor.sync.mjs` ~L5104) — it passes
      `**Model**` straight through to the spawned CLI with no allow-list at
      all, matching workflow.md's documented best-effort semantics, so
      inventing server-side validation here would be a stricter contract
      than the thing that actually consumes the value honors.
- [x] Task 3: Write `**Merge Mode**`/`**Auto Run**`/`**Workspace**`/`**Model**`
      markers into `index.md` at creation ONLY when the caller explicitly
      set a non-default value — mirrors Task 1's own `**Track Kind**`
      unconditional-write being the one exception (it's not optional,
      every track has a kind). `resolveMergeMode`/`parseAutoRun`/
      `resolveWorkspaceMode` read "absent = default" everywhere else in
      the codebase; an always-present-but-default marker on every new
      track from this point forward would be pure noise. Implemented in
      `ui/server/utils.mjs`'s `trackTemplates()` (new optional 7th `config`
      arg) — TDD: `ui/server/tests/track-008-track-config-markers.test.mjs`
      written first (red), then implemented (green), 10/10 pass, no
      regressions in the existing `utils.test.mjs`/
      `track-1102-f3-single-status-marker.test.mjs` suites.
- [x] Task 4: `NewTrackModal.jsx` — new controls added to the "Create new
      track" section, matching the existing Type/Domain toggle-button
      styling:
      - Merge Mode: PR / Direct toggle, defaulting to `resolveMergeMode(null)`
        (imported from `merge-mode.mjs`, not a second hardcoded copy).
      - Workspace: Branch / Main toggle. **Correction while implementing**:
        the "only when the project doesn't force one" condition can't be
        implemented as written — `project.workspace_mode` lives only in
        `.laneconductor.json` (D4/D5's own project-default tier) and is
        never synced to the `projects` DB table or returned by
        `GET /api/projects` (confirmed: no `workspace_mode` column
        anywhere in `prisma/schema.sql`, no such field in the project rows
        the endpoint selects) — the modal has no data source to check this
        against. Shown unconditionally instead; this is safe, not wrong,
        because `resolveWorkspaceMode`'s own precedence (row 2, explicit
        marker) always outranks the project default (row 5) — a human's
        toggle choice here is never silently ignored, only occasionally
        redundant with what the project would have done anyway. Exposing
        `project.workspace_mode` through the API is real follow-up work,
        out of scope here (belongs with track 1115 or its own track).
      - Auto Run: checkbox, off by default, with the exact one-line
        explanation from the marker table (track 10017 Phase 7 wording).
      - Model: dropdown via `modelOptions.js`'s `modelsForProvider()` +
        `getDefaultProviderModel()` (`../lib/defaultModel.js`) — the same
        live-worker-merged-with-registry-presets source
        `TrackDetailPanel.jsx`'s own per-track model override field
        already uses, scoped to the project's resolved default CLI (no
        worker is tied to a brand-new track, same reasoning
        `WorkflowSettings.jsx`'s per-lane field already relies on).
      **Also fixed while touching this component** (found during Task 4's
      own read-through, not asked for but directly in-path): `App.jsx` had
      TWO `<NewTrackModal>` render sites. `AppContent`'s (~L638) was
      correctly gated and wired; `CloudAppInner`'s (~L927, the cloud-mode
      board) rendered `<NewTrackModal open=... type=... onSuccess=... />`
      — none of which are props this component has ever accepted since
      its Phase 2 resume-or-create redesign, and with no `open` guard on
      the call site either, meaning it mounted unconditionally regardless
      of `newTrackOpen`. Gated and re-wired to match `AppContent`'s
      instance (same `projects`/`tracks`/`workers` props, now needed for
      the Advanced Model dropdown too).
- [x] Task 5: All of Task 4's new controls collapsed under an "Advanced"
      disclosure, closed by default — implemented as a native `<details>`
      (no JS state needed, closed by default with no `open` attribute).
      Click-through confirmed live (Task 8): the common title+description+
      Create path renders and submits with Advanced collapsed, untouched.
- [x] Task 6: `ui/src/components/NewTrackModal.test.jsx` (none existed —
      created new) — 10/10 pass: default submission omits all four
      optional fields; `type` always present; each Advanced field
      individually toggled appears in the POST body; toggling back to its
      default omits it again; all four set together all appear together.
- [x] Task 7: `ui/server/tests/track-008-track-create-config.test.mjs`
      (new — no prior test covered `POST /api/projects/:id/tracks` at
      all) — 6/6 pass against the real `trackTemplates()` output written
      to a real temp repo dir (not mocked fs): 400 on invalid
      `merge_mode`/`auto_run`; all-defaults writes no config markers;
      all-four-non-default writes all four; a bug track gets
      `**Track Kind**: bug` alongside any set markers; explicit
      `merge_mode: 'pr'` (matching the silent default) still writes none.
- [x] Task 8: Real browser check, done against an isolated scratch
      project/ports (not the live shared :8090/:8091 instance — that
      would have tested pre-change code per workflow.md's own "a fix on a
      branch never takes effect until merged and restarted", and would
      have written test tracks into the primary checkout, not this
      worktree) — created tracks covering all-defaults, all-four-set-to-
      non-default, and a bug-type track. Verified on disk, in the DB, and
      in the UI (the board's `MAIN` badge appeared live on the
      all-four-non-default track). **Correction to this task's own
      wording** (same error as Task 1's original text): confirmed via
      `resolveWorkspaceMode` against the real bug track's real file
      content that an `auto-queue` trigger resolves to `'branch'`, not
      `'main'` — `'main'` is what a `manual-dispatch` trigger resolves to
      for the same track. Both checked directly against the actual saved
      `index.md`, not asserted from memory. Scratch project row + created
      tracks + scratch server processes were all cleaned up afterward.

**Explicit non-goal**: does not add a worker-picker to the modal. Which
worker eventually claims a track is a queue-time decision (assignee
gating, `--only-tracks`, `auto_run` itself), not a creation-time one —
conflating them would mean the modal needs live worker-availability data
it has no reason to fetch just to create a track.

## ⚠️ Gaps (from review, 2026-08-25)

- [ ] Gap 1: `ui/server/utils.mjs`'s `configMarkerLines()` hardcodes its own
      `MERGE_MODE_VALID`/`WORKSPACE_MODE_VALID` arrays instead of importing
      `VALID_MODES` from `conductor/services/merge-mode.mjs` /
      `workspace-mode.mjs` (the same import `ui/server/index.mjs` already
      uses). Contradicts Task 2's own "single source, no second allow-list"
      claim and risks silently dropping a valid marker if either canonical
      list is ever extended. Fix: import instead of duplicating.
- [ ] Gap 2: `spec.md` was never updated for Phase 5 — no REQs/ACs for the
      four Advanced controls, the Track Kind wiring check, or the App.jsx
      dual-render fix. Separately, every existing AC checkbox is still
      unticked despite the track reporting 100% progress. Fix: add Phase 5
      REQs/ACs and tick every criterion that's actually true.

See `conversation.md`'s ⚠️ REVIEW FAILED comment for full detail.
