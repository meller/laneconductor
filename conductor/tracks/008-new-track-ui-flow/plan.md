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

- [ ] Task 1 (bug fix): `POST /api/projects/:id/tracks` writes
      `**Track Kind**: ${type}` into the new track's `index.md` — the
      SAME `type` value already collected and sent today, just not
      persisted. Regression test: create a track with `type: 'bug'`,
      assert `index.md` contains `**Track Kind**: bug` and
      `resolveWorkspaceMode` (called with that track's real parsed
      content) resolves to `'main'` for an auto-queue trigger per D1 row 4
      — prove the fix closes the actual behavioral gap, not just that a
      string got written.
- [ ] Task 2: `POST /api/projects/:id/tracks` accepts optional
      `merge_mode` (`'pr'|'direct'`), `auto_run` (boolean, default
      `false`), and `model` (string, project's own available-model list —
      reuse whatever validation `buildCliArgs`'s model-resolution path
      already trusts, don't invent a second allow-list). Validate
      `merge_mode` against the same set `resolveMergeMode` uses; reject
      invalid values with 400 rather than silently coercing.
- [ ] Task 3: Write `**Merge Mode**`/`**Auto Run**`/`**Model**` markers
      into `index.md` at creation ONLY when the caller explicitly set a
      non-default value — mirrors Task 1's own `**Track Kind**`
      unconditional-write being the one exception (it's not optional,
      every track has a kind). `resolveMergeMode`/`parseAutoRun` read
      "absent = default" everywhere else in the codebase; an
      always-present-but-default marker on every new track from this
      point forward would be pure noise.
- [ ] Task 4: `NewTrackModal.jsx` — new controls in the "Create new
      track" section, matching the existing Type/Domain toggle-button
      styling (not a dropdown that looks different from its siblings):
      - Merge Mode: PR / Direct toggle, defaulting to whichever
        `resolveMergeMode`'s own default is (read it, don't hardcode a
        second copy).
      - Workspace: Branch / Main toggle — **only when this project's
        `.laneconductor.json` doesn't already force one via
        `project.workspace_mode`** (D5's own precedence table already
        handles that override; the modal must not offer a choice the
        resolver will just ignore).
      - Auto Run: checkbox/toggle, off by default, one-line explanation
        (mirrors the SKILL.md marker-table entry from track 10017 Phase
        7: "whether a non-sync-only worker's auto-launch loop may claim
        this track from the queue").
      - Model: dropdown sourced from a live worker's `available_models`
        (per-CLI, JSONB — confirmed this is worker-scoped data, NOT a
        project-level list, by reading `WorkerModelModal.jsx` directly;
        it reads `worker.available_models[selectedCli]`). A new track has
        no worker yet, so this needs the *primary* worker's own
        registered list as the source — resolve exactly how
        `WorkflowSettings.jsx` (which sets a per-lane model with the same
        no-worker-yet-for-this-choice problem) already handles it before
        inventing a new pattern.
- [ ] Task 5: All of Task 4's new controls collapsed under an "Advanced"
      disclosure, closed by default — the modal is already dense (resume
      list + suggestions + create form) and none of these four are what
      most track creations need. Confirm with a real click-through that
      the common path (title + description + Create) isn't slowed down.
- [ ] Task 6: Component test (check for an existing
      `NewTrackModal.test.jsx` before assuming one doesn't exist)
      covering: default submission omits all three optional fields from
      the POST body (never sends `false`/`'pr'`/empty-model explicitly);
      each Advanced field, toggled, appears correctly in the POST body;
      `type` always appears (Task 1's fix means this now matters more
      than it used to).
- [ ] Task 7: Server test extending whatever already covers track
      creation (find it first) — for each of the four markers: setting it
      writes the correct marker + DB column; leaving it unset (the three
      optional ones) writes NO marker in `index.md` (verified, not just
      described) while `**Track Kind**` is always present.
- [ ] Task 8: Real browser check — create tracks covering: all-defaults,
      all-four-set-to-non-default, and a bug-type track specifically
      (confirms Task 1's fix end-to-end: created as `bug` → `index.md`
      has `**Track Kind**: bug` → an auto-queue dispatch for it actually
      resolves to `main` workspace mode).

**Explicit non-goal**: does not add a worker-picker to the modal. Which
worker eventually claims a track is a queue-time decision (assignee
gating, `--only-tracks`, `auto_run` itself), not a creation-time one —
conflating them would mean the modal needs live worker-availability data
it has no reason to fetch just to create a track.
