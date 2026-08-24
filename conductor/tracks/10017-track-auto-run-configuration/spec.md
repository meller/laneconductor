# Spec: Track Auto-Run Configuration

## Problem Statement
Today, any track sitting in `lane_action_status: queue` gets auto-claimed and
run by any non-`sync-only` worker (`lc worker start --sync-and-work`), subject
only to per-lane parallel limits, retry counts, the assignee gate (track
1084), and the operator's `--only-tracks` allowlist (track 1109). There is no
way for a track itself to say "don't auto-run me" — the only ways to keep a
worker off a track today are to leave it out of `queue` status, or to run
workers exclusively in `sync-only` mode (which then can't auto-run *anything*
and depends entirely on manual dispatch).

We want a **per-track opt-in flag** — stored in both the filesystem
(`index.md`) and the DB (`tracks` table) — that controls whether a
non-`sync-only` worker's auto-launch loop may pick this specific track up
from the queue. Default is **off**: a track with no indicator is not
auto-picked. This is a deliberate behavior change for *any* worker that
polls (all existing zero-config trackswill stop being auto-claimed once this
ships, until the flag is explicitly turned on for them) — the track's own
wording confirms this is intended ("if no indicator - dont pick it up").

## Requirements

- REQ-1: New boolean field `auto_run` on `tracks` (DB) and a new
  `**Auto Run**: yes|no` marker in `index.md` (FS). Absent marker / DB
  default is `false`.
- REQ-2: The auto-launch loop (`autoLaunchLocalFs` in
  `conductor/laneconductor.sync.mjs`) must not select a track for automatic
  lane-action spawning unless `auto_run` is `true` for that track. This
  applies in **all** operating modes (local-fs, local-api, remote-api) — the
  gate is enforced by parsing the local `index.md` marker (the same file the
  loop already reads for `Lane`/`Lane Status`/etc.), since `autoLaunchLocalFs`
  is the single decision loop used across all modes.
- REQ-3: The gate must NOT affect:
  - Explicit manual dispatch (`POST /api/tracks/:id/dispatch`,
    `worker_dispatch` inbox) — a human/manager explicitly routing work to a
    specific worker is not "auto-picking from the queue."
  - `lc worker run <track>` — an operator explicitly naming one track to run
    in the foreground.
  - `sync-only` workers — they never poll the queue at all regardless of this
    flag (unaffected either way).
  - The in-progress "answer a waiting human reply" flow
    (`waiting_for_reply: true`): mirroring the existing assignee-gate bypass
    (track 1084) for the same reason — a track already mid-conversation
    should get answered regardless of whether fresh queue work would be
    auto-claimed for it.
  - The `--only-tracks` allowlist (track 1109): it narrows an already-open
    set of claimable tracks, it does not itself request work be done on a
    track — a track with `auto_run: false` stays un-auto-run even if it's
    named in `--only-tracks`. (Use `lc worker run <track>` instead when you
    want to force a specific run.)
- REQ-4: The flag must round-trip through existing sync machinery the same
  way `waiting_for_reply` does: FS→DB via the `POST /track` payload built in
  `laneconductor.sync.mjs`, DB→FS via `syncTrackToFile` (so a UI/API toggle
  reaches the file before the worker's next auto-launch cycle).
- REQ-5: Expose `auto_run` on `GET /api/projects/:id/tracks` /
  `GET /api/projects/:id/tracks/:num`, and add a
  `PATCH /api/projects/:id/tracks/:num/auto-run` endpoint (mirrors the
  existing `/assignee` endpoint) so the UI/API can toggle it directly.
- REQ-6: A small toggle in `TrackDetailPanel.jsx` (next to the existing
  Assignee control) lets a human flip this per track from the Kanban UI.
- REQ-7: `conductor/laneconductor.sync.mjs`'s `Auto Run` marker table entry,
  plus a short note under `/laneconductor implement`/auto-launch docs, is
  added to `.claude/skills/laneconductor/SKILL.md` (this repo IS the
  canonical skill source, not a symlink target).

## Non-Goals
- No change to the assignee gate (track 1084) or `--only-tracks` (track
  1109) — this is an additional, independent gate, not a replacement.
- No migration/backfill step for existing tracks — default `false` already
  means "not auto-run," which requires no data migration, only a column
  default.
- No change to manual/CLI-driven invocation (`lc plan/implement/review NNN`,
  `lc worker run NNN`) — those remain explicit actions that bypass this gate
  entirely, same as they bypass the assignee gate today.

## Acceptance Criteria
- [ ] A freshly created track (no `**Auto Run**` marker, DB default) sitting
      in `queue` is left untouched by a `sync+poll` worker's auto-launch
      cycle — verified by an integration test that starts a real worker
      process against such a track and confirms no CLI process is spawned
      and `lane_action_status` stays `queue`.
- [ ] The same track, with `**Auto Run**: yes` set (or `auto_run: true` in
      DB, synced down to the file), IS picked up and run by the next
      auto-launch cycle.
- [ ] `isTrackClaimable()` in `conductor/claim-scope.mjs` rejects a track
      with `autoRun: false` even when `claimableSet`/`onlyTracks` would
      otherwise allow it, and accepts it when `waitingForReply: true`
      regardless of `autoRun`.
- [ ] `sync-only` worker behavior is unchanged (it already skips auto-launch
      entirely, before this gate is ever reached).
- [ ] Toggling the flag via `PATCH /api/projects/:id/tracks/:num/auto-run`
      updates the DB and results in the `index.md` marker being rewritten
      via `syncTrackToFile`.
- [ ] `GET /api/projects/:id/tracks` returns `auto_run` for each track.
- [ ] TrackDetailPanel shows and can toggle Auto Run for a track (manual
      browser check — no Playwright suite exists for this panel today).

## Data Model Changes
- `tracks.auto_run BOOLEAN NOT NULL DEFAULT false` (Atlas migration +
  `prisma/schema.prisma`), same shape as the existing `waiting_for_reply`
  column added in `migrations/20260814154139_add_waiting_for_reply.sql`.

## Design Decision (flagged for review)
`--only-tracks` (an operator-supplied allowlist meant to *narrow*, never
widen, what a worker may claim) does **not** bypass the new `auto_run` gate
in this plan — a track flagged `auto_run: false` stays un-auto-run even if
explicitly named in `--only-tracks`; `lc worker run <track>` remains the
tool for "run this one track right now regardless." This reading follows
directly from the track's own text ("if they could be picked by workers
that are not sync only... if no indicator - dont pick it up") and mirrors
how `waitingForReply` is the *only* existing bypass for `claimableSet`. If a
human reviewing this instead wants `--only-tracks` to force-run a track past
this gate, that's a one-line change to `isTrackClaimable` (add
`if (onlyTracks?.has(n)) return true;` before the `auto_run` check) — call it
out during review rather than assuming it silently.
