# Track 10017: track auto run configuration

## Phase 1: DB schema — `tracks.auto_run` column

**Problem**: There's no persisted place to store the per-track auto-run flag.
**Solution**: Add `auto_run` boolean column, default `false`, matching the
`waiting_for_reply` column's shape exactly.

- [ ] Task 1: Add `auto_run Boolean @default(false)` to the `tracks` model in
      `prisma/schema.prisma` (near `waiting_for_reply`).
- [ ] Task 2: Add Atlas migration `migrations/<timestamp>_add_auto_run.sql`:
      `ALTER TABLE "public"."tracks" ADD COLUMN "auto_run" boolean NOT NULL DEFAULT false;`
      (mirror `migrations/20260814154139_add_waiting_for_reply.sql` exactly —
      same statement shape, new column name). Update `migrations/atlas.sum`
      via the project's normal Atlas workflow (or hand-append per repo
      convention — check how the `waiting_for_reply` migration's checksum
      was added).
- [ ] Task 3: Regenerate the Prisma client (`generated/prisma`) if this
      project's workflow does that as a build step (check `package.json`
      scripts before assuming — don't add a script that doesn't exist).

**Impact**: `tracks.auto_run` exists, defaults to `false` for every existing
row with no backfill needed.

## Phase 2: FS marker — `**Auto Run**` parsing + sync payload

**Problem**: The worker needs to read/write the per-track flag from
`index.md`, the same way it already does for `**Waiting for reply**`.
**Solution**: Add a `parseAutoRun()` function mirroring
`parseWaitingForReply()` exactly, and wire it into the FS→DB sync payload.

- [ ] Task 1: In `conductor/laneconductor.sync.mjs`, add:
      ```js
      function parseAutoRun(content) {
        const match = content.match(/\*\*Auto Run\*\*:\s*([^\n]+)/i);
        return match ? match[1].trim().toLowerCase() === 'yes' : false;
      }
      ```
      placed next to `parseWaitingForReply` (~line 1347).
- [ ] Task 2: In the FS→DB sync function that builds the `POST /track`
      payload (~line 1961), add `auto_run: parseAutoRun(stateContent),` next
      to `waiting_for_reply: waitingForReply,`.
- [ ] Task 3: Do NOT add `**Auto Run**` to the `/laneconductor newTrack`
      scaffold template — absence is the intended default (REQ-1); writing
      an explicit `no` on every new track is redundant and adds noise to
      every `index.md`.

**Impact**: `parseAutoRun` is available; every FS→DB sync tick now reports
the track's current auto-run marker state to the DB.

## Phase 3: Enforcement — claim-scope gate in auto-launch

**Problem**: Nothing currently reads the new marker to decide whether to
auto-launch a track.
**Solution**: Extend `isTrackClaimable()` (`conductor/claim-scope.mjs`) with
an `autoRun` parameter, and pass the locally-parsed marker value into it from
`autoLaunchLocalFs`.

- [ ] Task 1: In `conductor/claim-scope.mjs`, extend the predicate:
      ```js
      export function isTrackClaimable(trackNumber, { claimableSet = null, onlyTracks = null, waitingForReply = false, autoRun = false } = {}) {
        const n = normaliseTrackNumber(trackNumber);
        if (onlyTracks && !onlyTracks.has(n)) return false;
        if (!autoRun && !waitingForReply) return false;
        if (claimableSet && !waitingForReply) {
          const allowed = claimableSet.has(n) || claimableSet.has(String(trackNumber).trim());
          if (!allowed) return false;
        }
        return true;
      }
      ```
      Update the function's doc comment to describe the new `autoRun` gate
      and its `waitingForReply` bypass, following the existing comment style
      for `claimableSet`'s bypass.
- [ ] Task 2: In `autoLaunchLocalFs` (`conductor/laneconductor.sync.mjs`,
      ~line 4399, right after `parseWaitingForReply`), add
      `const autoRun = parseAutoRun(content);` and pass `autoRun` into the
      existing `isTrackClaimable(track_number, { claimableSet, onlyTracks,
      waitingForReply })` call (~line 4472).
- [ ] Task 3: Update `conductor/claim-scope.mjs`'s module-level comment to
      mention this second, independent gate (it currently only documents the
      `--only-tracks` allowlist).

**Impact**: A queued track with no `**Auto Run**: yes` marker (and not
mid-conversation) is skipped by every `sync+poll` worker's auto-launch loop,
in every operating mode, without any DB/API round-trip needed for the
decision itself (the marker is read straight from the file already open in
this loop).

## Phase 4: API surface — expose + toggle `auto_run`, DB→FS sync-back

**Problem**: Once `auto_run` exists in the DB, it needs to be readable and
writable through the API so the UI (or `lc` CLI, later) can set it, and a
DB-side write needs to reach the file before the worker's next auto-launch
cycle reads it.
**Solution**: Mirror the existing `assignee_uid` plumbing end to end.

- [ ] Task 1: `ui/server/index.mjs` `POST /track` handler (~line 2208):
      destructure `auto_run` from `req.body`, add it as a new numbered param
      (after `waiting_for_reply`, i.e. `$28`), insert into the `INSERT ...
      VALUES` list with `COALESCE($28, false)`, and add
      `auto_run = COALESCE($28, tracks.auto_run)` to the `ON CONFLICT DO
      UPDATE SET` clause — same COALESCE pattern as `waiting_for_reply` so a
      partial sync payload never clobbers an existing value with `false`.
- [ ] Task 2: `GET /api/projects/:id/tracks` (~line 598): add `t.auto_run`
      to the `SELECT` column list.
- [ ] Task 3: `GET /api/projects/:id/tracks/:num` (~line 1224): add
      `auto_run` to whatever column list/response shape that handler
      already builds (check its current SELECT before assuming the same
      list as the plural endpoint).
- [ ] Task 4: New endpoint mirroring `PATCH
      /api/projects/:id/tracks/:num/assignee` (~line 4148):
      ```js
      app.patch('/api/projects/:id/tracks/:num/auto-run', async (req, res) => {
        try {
          const { auto_run } = req.body;
          if (typeof auto_run !== 'boolean') {
            return res.status(400).json({ error: 'auto_run must be a boolean' });
          }
          const { rowCount } = await pool.query(
            'UPDATE tracks SET auto_run = $1 WHERE project_id = $2 AND track_number = $3',
            [auto_run, req.params.id, req.params.num]
          );
          if (rowCount === 0) return res.status(404).json({ error: 'track not found' });
          broadcast('track:updated', { projectId: req.params.id, trackNumber: req.params.num });
          res.json({ ok: true });
        } catch (err) {
          res.status(500).json({ error: err.message });
        }
      });
      ```
- [ ] Task 5: DB→FS sync-back — find where `syncTrackToFile` (used by
      `PATCH /track/:num/action`'s `waiting_for_reply`-style DB-authoritative
      fields, and by the brainstorm flow's `setHeader(idxContent, 'Waiting
      for reply', 'yes')` at ~line 1512) writes markers into `index.md`, and
      add the same `setHeader(idxContent, 'Auto Run', auto_run ? 'yes' :
      'no')` handling triggered from the new `/auto-run` PATCH endpoint (call
      `syncTrackToFile` the same way the `/assignee` endpoint would need to,
      or the way `/track/:num/action` already does for its `syncUpdates`
      object — read that function's actual signature before wiring this in,
      it takes a field-map, not individual params).

**Impact**: `auto_run` is readable via the tracks list/detail endpoints,
toggleable via its own PATCH endpoint, and a toggle propagates back down to
`index.md` so the next auto-launch cycle sees it without requiring a manual
file edit.

## Phase 5: UI toggle + SKILL.md docs

**Problem**: There's no way for a human to flip this flag without hand-editing
`index.md` or curling the API.
**Solution**: Add a small toggle next to the existing Assignee control in
`TrackDetailPanel.jsx`, and document the new marker in the skill file.

- [ ] Task 1: In `ui/src/components/TrackDetailPanel.jsx`, near the existing
      "Track 1084: Assignee control" block (~line 660), add an `autoRun`
      state + `setAutoRunFlag` handler that `PATCH`es
      `/api/projects/${projectId}/tracks/${trackNumber}/auto-run` with
      `{ auto_run: !current }`, mirroring `setAssignee`'s save-state pattern
      (`assigneeSaving` → an `autoRunSaving` equivalent).
- [ ] Task 2: Render a small labeled checkbox/toggle: "Auto-run: on/off",
      defaulting from `detail.auto_run` (falsy → off).
- [ ] Task 3: Update `.claude/skills/laneconductor/SKILL.md`:
      - Add a row to the Filesystem-as-API marker table (next to `**Waiting
        for reply**`): `| **Auto Run**: [yes\|no] | auto_run | Whether a
        non-sync-only worker's auto-launch loop may claim this track from the
        queue. Default no. |`
      - Add a short note under the `Lane Action State Machine` /
        `autoLaunchLocalFs` discussion (or wherever `--only-tracks` /
        assignee gating is documented) describing the new gate and its
        `waitingForReply` bypass, consistent with `spec.md`'s Design
        Decision note.

**Impact**: A human can toggle auto-run per track from the Kanban UI, and
the skill file accurately documents the new marker for future agents.

## Phase 6: Tests

**Problem**: The gate is safety-critical (it changes default automation
behavior for every existing track) and needs both unit and integration
coverage, per this project's TDD protocol.
**Solution**: Extend the existing claim-scope and server test suites, plus
add one local-fs E2E case.

- [ ] Task 1: `conductor/tests/track-10017-auto-run.test.mjs` (new,
      `node:test`, following `track-1109-claim-allowlist.test.mjs`'s
      pattern) — unit tests for `isTrackClaimable`'s new `autoRun` param:
      TC-1 through TC-5 in `test.md`.
- [ ] Task 2: Extend `ui/server/tests/track-1084-assignee.test.mjs`-adjacent
      coverage (or a new `ui/server/tests/track-10017-auto-run-api.test.mjs`)
      for the `POST /track` upsert COALESCE behavior and the new
      `PATCH .../auto-run` endpoint — TC-6 through TC-8.
- [ ] Task 3: Add one case to `conductor/tests/local-fs-e2e.test.mjs` (or a
      new sibling file if that one's fixture setup doesn't fit) spawning the
      real worker against a queued track with no `**Auto Run**` marker and
      confirming no CLI process spawns and `lane_action_status` stays
      `queue` after a full poll cycle — TC-9.

**Impact**: The gate's positive and negative cases are both covered at the
unit level (fast, no process spawn) and validated once end-to-end against
the real worker loop.
