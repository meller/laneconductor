# Tests: Track 10063 — One canonical track-folder resolver for every writer

## Test Commands

```bash
# Server API tests (Vitest + supertest), including the new resolver suite
cd ui && npx vitest run server/tests/track-10063-folder-resolution.test.mjs

# Full server + UI suite (regression sweep)
cd ui && npm test

# Shared resolver unit tests (node:test, zero deps)
node --test conductor/tests/track-10063-track-folder-fs.test.mjs

# Existing folder-resolution suites — the byte-identical-behaviour proof for Phase 2
node --test conductor/tests/track-10040-track-folder.test.mjs \
            conductor/tests/track-10046-duplicate-folder-root-cause.test.mjs \
            conductor/tests/track-10048-duplicate-folder-double-spawn.test.mjs

# CLI resolver / audit
node --test conductor/tests/track-10063-track-dir-cli.test.mjs
```

New test files:
- `conductor/tests/track-10063-track-folder-fs.test.mjs` — Phases 1, 2
- `conductor/tests/track-10063-track-dir-cli.test.mjs` — Phases 2, 4
- `ui/server/tests/track-10063-folder-resolution.test.mjs` — Phases 3, 4

All filesystem tests build a real temp tree under `mkdtempSync(tmpdir())` and
remove it afterwards, matching the pattern already used by
`ui/server/tests/track-10017-auto-run-api.test.mjs`. The point of this track is
that the write lands on the right path, so nothing here mocks the filesystem.

---

## Test Cases

### Phase 1 — `resolveTrackFolderFs` (`conductor/tests/track-10063-track-folder-fs.test.mjs`)

- [ ] **TC-1**: Tree containing only `TU-10063-slug/`, nothing registered —
      expected: `folder` is `TU-10063-slug`, `matches` is 1, `quarantine` empty.
      This is the case the old server regex could not see at all.
- [ ] **TC-2**: Tree containing both `TU-10063-slug/` (4 files, larger) and
      `10063-slug/` (2 files), nothing registered — expected: `folder` is
      `TU-10063-slug` via the content-size tie-break, `quarantine` is
      `['10063-slug']`, `matches` is 2.
- [ ] **TC-3**: Same tree, but `tracks-metadata.json` registers `10063-slug` —
      expected: registration wins, `folder` is `10063-slug`. Proves registration
      still outranks content size.
- [ ] **TC-4**: `tracks-metadata.json` is malformed JSON — expected: resolves
      as if unregistered, returns a folder, does not throw.
- [ ] **TC-5**: Called against the TC-2 tree — expected: after the call, both
      directories still exist with their original names and
      `tracks-metadata.json` is byte-unchanged. Proves the resolver applies
      nothing (REQ-1).

### Phase 2 — worker and CLI parity (same file, plus the CLI file)

- [ ] **TC-6**: Worker `resolveTrackFolder` on the TC-2 tree — expected: returns
      `TU-10063-slug`, renames `10063-slug` to `_duplicate-10063-slug`, and
      rewrites a `**Lane Status**: running` marker inside the quarantined
      folder to `quarantined`. Proves REQ-5 kept the effects.
- [ ] **TC-7**: `lc track-dir 10063` and the worker's `resolveTrackFolder` run
      against identical copies of the TC-2 tree — expected: both return
      `TU-10063-slug`. Today the CLI returns `10063-slug` (alphabetical), so
      this test must fail before Phase 2 (AC-7).

### Phase 3 — `syncTrackToFile` (`ui/server/tests/track-10063-folder-resolution.test.mjs`)

- [ ] **TC-8**: `PATCH /api/projects/:id/tracks/10063/auto-run` with
      `auto_run: true` against a repo whose only track folder is
      `TU-10063-slug/` — expected: `**Auto Run**: yes` appears in
      `TU-10063-slug/index.md`. This is the reported bug (AC-1).
- [ ] **TC-9**: Same request — expected: no `10063-slug/` directory exists
      afterwards. The recreate branch must not fire (AC-3).
- [ ] **TC-10**: Repo containing both `TU-10063-slug/` and a stale
      `10063-slug/` — expected: the marker is written into `TU-10063-slug/` and
      `10063-slug/index.md` is left byte-unchanged.
- [ ] **TC-11**: The TC-10 request — expected: a `logger.warn` fires naming
      track `10063`, the chosen folder, and `10063-slug` as a non-canonical
      match (REQ-7).
- [ ] **TC-12**: Repo with **no** folder for the track and a DB row whose
      `author` is `TU` — expected: the recreate branch creates
      `TU-10063-slug/`, not `10063-slug/` (REQ-4). Variant with `author` NULL
      and an `index_content` heading of `# Track TU-10063: …` — expected: same
      result, prefix recovered from the heading.

### Phase 4 — the other four call sites and the audit command

- [ ] **TC-13**: `DELETE /api/projects/:id/tracks/10063` on a repo whose only
      folder is `TU-10063-slug/` — expected: that directory is gone afterwards.
      Today it survives (AC-4).
- [ ] **TC-14**: `POST /api/projects/:id/tracks/10063/comments` with
      `author: 'human'` — expected: the line is appended to
      `TU-10063-slug/conversation.md` and `.conv-cursor` there is advanced to
      the file's new size (AC-5).
- [ ] **TC-15**: bug-to-test endpoint on a prefixed track — expected:
      `TU-10063-slug/test.md` contains the regression block, and the path passed
      to `queueFileSync` is `conductor/tracks/TU-10063-slug/test.md`.
- [ ] **TC-16**: review-gaps endpoint on a prefixed track — expected: 200 with
      the fix phase written into `TU-10063-slug/plan.md`. Today this returns
      404 "Track directory not found on disk" (AC-6).
- [ ] **TC-17**: `lc track-dir --audit` on a tree where 10063 has two live
      matching folders and 10064 has one — expected: stdout names 10063 and not
      10064, exit code 1. Same command on a clean tree — expected: exit code 0
      (AC-8).

### Phase 5 — end-to-end against running processes

- [ ] **TC-18**: With the API server and worker restarted, toggle Auto Run in
      the UI on a prefixed track, then wait one full worker sync cycle —
      expected: `auto_run` is still `true` in the database, and
      `**Auto Run**: yes` is still in the canonical `index.md`. This is the
      flap regression (AC-2). Record the actual DB query output.
- [ ] **TC-19**: Run `lc track-dir --audit` after one worker pass following the
      fix — expected: the count of duplicated track numbers does not grow
      relative to the pre-fix baseline. Record both outputs.

---

## Acceptance Criteria

- [ ] TC-1 … TC-19 all pass
- [ ] The four existing folder-resolution suites listed under Test Commands
      pass unchanged (AC-9)
- [ ] `cd ui && npm test` is green, with coverage still above the thresholds in
      `ui/vitest.config.js` (lines 49, functions 50, branches 40, statements 49)
- [ ] `node --test conductor/tests/local-fs-e2e.test.mjs` and
      `local-api-e2e.test.mjs` still pass — the worker's resolver is on their
      hot path
- [ ] Phase 5's observations are recorded in `conversation.md` as real output,
      not as a claim that the code looks correct
