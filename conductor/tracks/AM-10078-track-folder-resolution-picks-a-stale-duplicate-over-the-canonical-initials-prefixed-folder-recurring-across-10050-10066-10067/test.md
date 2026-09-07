# Tests: Track 10078 — Track folder resolution picks a stale duplicate over the canonical INITIALS-prefixed folder

## Test Commands

```bash
# New regression suite for this track
node --test conductor/tests/track-10078-folder-resolution.test.mjs

# Existing suites that pin the precedence rules this track modifies — must stay green
node --test conductor/tests/track-1119-resolve-track-folder-quarantine.test.mjs
node --test conductor/tests/track-10040-duplicate-dir-scan.test.mjs
node --test conductor/tests/track-10048-duplicate-folder-double-spawn.test.mjs
node --test conductor/tests/track-10021-scoped-worker.test.mjs

# API-side folder resolution (Vitest)
cd ui && npx vitest run server/tests/track-10063-folder-resolution.test.mjs

# Full worker suite
node --test conductor/tests/

# Full UI/API suite
cd ui && npm test
```

## Test Cases

### Phase 1: Quarantine no longer self-perpetuates

- [ ] TC-1: `isTrackDirName('_quarantine-10067-dup-1788767410')` — expected: `false`.
      Fails today: the name has digits and does not start with `_duplicate-`.
- [ ] TC-2: `isTrackDirName('_duplicate-10040-foo')` still `false`, and
      `isTrackDirName('AM-10078-foo')` still `true` — the widened rule must not
      over-exclude real tracks.
- [ ] TC-3: A `_quarantine-*` folder containing `**Lane Status**: running` contributes 0
      to its lane's `parallel_limit` count — expected: the lane's live count is unchanged
      by the folder's presence.
- [ ] TC-4: After the worker quarantines a duplicate in a temp git repo,
      `git status --porcelain` is empty — expected: quarantine creates no tracked file
      (AC-5).
- [ ] TC-5: `git ls-files conductor/tracks/ | grep -E '_duplicate-|_quarantine-'` returns
      nothing in this repo after Phase 1 — expected: no matches, exit 1.
- [ ] TC-6: A quarantine appends one line to `conductor/tracks/.quarantine-log` naming
      timestamp, track number, winner, and loser — expected: line present and parseable.

### Phase 2: One creation path, one convention

- [ ] TC-7: `buildTrackFolderName({ trackNumber: '10078', title: 'My Feature',
      initials: 'AM' })` — expected: `AM-10078-my-feature`.
- [ ] TC-8: Same call with `initials: null` — expected: `10078-my-feature` (legacy
      fallback preserved).
- [ ] TC-9: Creation parity — the UI `/track-create` naming path and `lc new` produce the
      identical folder name for the same number, title, and author (AC-1).
- [ ] TC-10: With `AM-10078-my-feature/` already present, POST `/track-create` for 10078
      creates nothing and reuses the existing folder — expected: `conductor/tracks/`
      contains exactly one folder matching 10078. This is the direct fix for RC-1's
      `existsSync`-on-bare-path guard.
- [ ] TC-11: Symmetric case — with bare `10078-my-feature/` present, `lc new` for the
      same number reuses it rather than creating a prefixed twin.
- [ ] TC-12: `handleTrackCreate` processing a `file_sync_queue.md` entry for a number that
      already has a prefixed folder creates nothing.
- [ ] TC-13: `handleTrackCreate` for a genuinely new number creates
      `INITIALS-<n>-slug`, not bare — expected: folder name starts with the git-config
      initials.

### Phase 3: Resolution prefers the canonical folder

- [ ] TC-14: **The live 10067 failure.** Temp git repo with both
      `conductor/tracks/10067-x/index.md` (`**Lane**: plan`) and
      `conductor/tracks/TU-10067-x/index.md` (`**Lane**: done`) committed to a branch.
      `readTrackStateFromBranch(repo, branch, '10067')` — expected:
      `{ lane: 'done', trackDir: 'conductor/tracks/TU-10067-x' }`. Must fail on the
      parent commit (AC-2, AC-7).
- [ ] TC-15: `decideTrackFolder` with `dirNames: ['10078-x', 'AM-10078-x']`, nothing
      registered, no size data — expected: `folder: 'AM-10078-x'`, `quarantine:
      ['10078-x']`. Today returns the bare one via alphabetical `matches[0]`.
- [ ] TC-16: Precedence — registered metadata still outranks the prefix. `dirNames:
      ['10078-x', 'AM-10078-x']`, `registeredFolder: '10078-x'`, `registeredExists: true`
      — expected: `folder: '10078-x'`. Guards track 1119's rule.
- [ ] TC-17: Precedence — content size still outranks the prefix. Same dirNames with
      `contentSizeByName: { '10078-x': 9000, 'AM-10078-x': 40 }` — expected:
      `folder: '10078-x'`. Guards track 10046's rule.
- [ ] TC-18: Prefix breaks a size tie. `contentSizeByName: { '10078-x': 500,
      'AM-10078-x': 500 }` — expected: `folder: 'AM-10078-x'`.
- [ ] TC-19: `readTrackStateFromBranch` logs a warning naming branch, track number,
      winner, and rejected names when 2+ folders match — expected: one warning, correct
      fields.
- [ ] TC-20: `lc track-dir 10067 --json` reports `matches: 2` and lists the rejected name
      while `folder` is the prefixed one (AC-3).
- [ ] TC-21: Single-folder cases are unaffected — a lone `AM-10078-x` and a lone
      `10078-x` each resolve to themselves with no quarantine and no warning.

### Phase 4: Prefix-blind resolvers swept

- [ ] TC-22: `trackFolderPattern('10078')` matches `10078-x`, `AM-10078-x`, `TU-10078-x`;
      does not match `110078-x`, `10078x`, `_duplicate-10078-x`.
- [ ] TC-23: For each converted site, resolving a prefixed-only track returns the folder
      rather than `undefined` — covering `measure.mjs`, `agent-runtime.mjs` (both sites),
      and the nine `bin/lc.mjs` sites.
- [ ] TC-24: Guard test — a repo scan finds no remaining
      ``startsWith(`${...}-`)`` track-folder resolution outside `conductor/services/`.
      Expected: zero hits. Prevents RC-4 reappearing.

### Phase 5: Sweep

- [ ] TC-25: `scripts/sweep-duplicate-tracks.mjs` with no flags makes no filesystem or git
      change — expected: dry-run is the default, `git status --porcelain` unchanged.
- [ ] TC-26: Dry-run output lists all 19 groups with winner, losers, per-folder content
      size, and metadata registration for each.
- [ ] TC-27: `--apply` on a temp fixture removes the loser from disk and from git
      tracking, and rewrites `tracks-metadata.json` to name the winner.
- [ ] TC-28: Post-sweep on this repo —
      `ls conductor/tracks/ | grep -v '^_' | sed -E 's/^([A-Za-z]+-)?([0-9]+)-.*/\2/' |
      sort | uniq -d` returns nothing (AC-6).
- [ ] TC-29: Track 10044's four folders collapse to one; the surviving folder is the one
      whose content matches the DB's state for 10044.

### Regression: existing behavior preserved

- [ ] TC-30: `track-1119-resolve-track-folder-quarantine.test.mjs` passes unchanged.
- [ ] TC-31: `track-10040-duplicate-dir-scan.test.mjs` passes unchanged.
- [ ] TC-32: `track-10048-duplicate-folder-double-spawn.test.mjs` passes unchanged.
- [ ] TC-33: `track-10021-scoped-worker.test.mjs` passes unchanged — it asserts scoping
      across both naming conventions and legacy zero-padded folders.
- [ ] TC-34: `ui/server/tests/track-10063-folder-resolution.test.mjs` passes unchanged.
- [ ] TC-35: The 146 legacy bare folders that have no prefixed twin are untouched by
      every phase — expected: same folder list before and after, minus only the 19
      swept losers.

## Acceptance Criteria

- [ ] All new tests in `conductor/tests/track-10078-folder-resolution.test.mjs` pass.
- [ ] TC-14 and TC-15 verified failing on the parent commit and passing after (AC-7).
- [ ] Full worker suite green: `node --test conductor/tests/`.
- [ ] Full UI/API suite green: `cd ui && npm test`.
- [ ] `git status --porcelain` clean after a worker-driven quarantine (AC-5).
- [ ] No duplicate pairs remain (AC-6).
- [ ] No regressions in tracks 1119, 10021, 10040, 10046, 10048, 10063 coverage.
