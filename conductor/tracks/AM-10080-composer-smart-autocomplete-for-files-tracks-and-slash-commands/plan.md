# Track 10080: Composer smart autocomplete for @file mentions, @track references, and /slash commands

Five phases. Phase 1 is pure logic with no I/O, Phase 2 is the endpoint, Phase 3 is the visible
feature, Phase 4 extends Phase 2's fallback branch for remote deployments, Phase 5 verifies the
whole thing against a running app.

Phases 3 and 4 are independent of each other once Phase 2 lands, so they can be reordered if one
turns out to be blocked. Phase 3 is placed first because it is what a user can see.

## Phase 0: Make the worktree runnable

Do this before anything else. This worktree has **no `node_modules`** at either the repository
root or under `ui/`, so every test command in `test.md` fails at config-load time until it does
(observed: `npx vitest` dies with `Cannot find package '@vitejs/plugin-react'`). It is a one-time
setup step, not a code change.

- [x] `npm install` at the repository root
- [x] `npm install` in `ui/`
- [x] Confirm the baseline is green before touching anything:
      `cd ui && npx vitest run src/components/ChatView.test.jsx src/components/ChatView.queued.test.jsx src/components/ChatView.wizard.test.jsx`
- [x] Record that baseline. "No regressions" in Phase 5 is only meaningful against a known-green
      starting point

**Baseline recorded (2026-09-07)**: `ChatView.wizard.test.jsx` (4 tests), `ChatView.queued.test.jsx`
(4 tests), `ChatView.test.jsx` (15 tests) — 23/23 passed.

### Which runner picks up which test

`ui/vitest.config.mjs` includes exactly `server/tests/**/*.test.mjs`, `src/**/*.test.js` and
`src/**/*.test.jsx`, all relative to `ui/`. Nothing outside `ui/` is in scope for `npm test`. So
the two new `conductor/services/` modules cannot be tested by vitest at all — they follow the
established `node --test conductor/tests/track-NNNNN-*.test.mjs` convention instead, exactly as
`merge-mode.mjs`, `workspace-mode.mjs` and `done-lane-bucket.mjs` already are.

| Module | Test file | Runner |
|---|---|---|
| `conductor/services/fuzzy-match.mjs` | `conductor/tests/track-10080-fuzzy-match.test.mjs` | `node --test` |
| `conductor/services/slash-commands.mjs` | same file as above | `node --test` |
| `ui/src/lib/composerTriggers.js` | `ui/src/lib/composerTriggers.test.js` | vitest |
| `GET /api/projects/:id/files` | `ui/server/tests/track-10080-files-api.test.mjs` | vitest |
| composer component | `ui/src/components/TrackChatComposer.autocomplete.test.jsx` | vitest (jsdom) |
| worker manifest sync | `conductor/tests/track-10080-file-manifest.test.mjs` | `node --test` |

Note also that `ui/vitest.config.mjs` enforces coverage thresholds scoped to `server/**/*.mjs`
(lines 49, functions 50, branches 40, statements 49). Phase 2 adds a non-trivial amount of code to
`ui/server/index.mjs`, so its tests need to be thorough enough to hold those thresholds, or
`npm run test:coverage` fails at the quality gate.

---

## Phase 1: Shared matching and trigger logic

**Problem**: Ranking, trigger detection and text insertion are the parts most likely to be subtly
wrong, and the hardest to debug through a DOM. There is no fuzzy matcher in the repository yet.

**Solution**: Land them first as pure, dependency-free modules with full unit coverage, so Phases
2 and 3 assemble tested parts rather than inventing behaviour inline. Shared modules go in
`conductor/services/`, the established home for logic imported by both `ui/server/index.mjs` and
`ui/src/**` (precedent: `conductor/providers.mjs`, `conductor/services/merge-mode.mjs`).

- [x] Create `conductor/services/fuzzy-match.mjs` (REQ-12)
    - [x] `fuzzyScore(candidate, query)` — case-insensitive subsequence match, returns `null` on
          no match so callers can filter on it
    - [x] Score bonuses: consecutive-run length, match starting a path segment (after `/`),
          match inside the basename over the directory, earlier first-match position, shorter
          candidate as final tiebreak
    - [x] `fuzzyRank(candidates, query, { limit, key })` — sorts by score descending, then by the
          candidate string ascending so ordering is total and stable; empty query returns the
          first `limit` in input order
- [x] Create `conductor/services/slash-commands.mjs` (REQ-13)
    - [x] `SLASH_COMMANDS` — one entry per `/laneconductor` command with `name`, `args`,
          `description`, sourced from the skill's Quick Reference table
    - [x] `commandInsertText(cmd)` returning `/laneconductor <name> `
- [x] Create `ui/src/lib/composerTriggers.js`
    - [x] `detectTrigger(value, caret)` → `null` or `{ kind, query, start, end }` implementing the
          trigger grammar in spec.md: `@` files, `#` and `@track:` tracks, `/` commands at
          position 0 only, trigger character must begin a token
    - [x] `applyCompletion(value, trigger, insertText)` → `{ value, caret }`, replacing only the
          trigger token and appending one trailing space (REQ-19)
- [x] Unit tests for all three modules, including the ambiguity cases: `@tracker.js` opens files
      not tracks, `@src/lib` does not open the command menu, `a#b` and `foo@bar` open nothing.
      Split by runner per the table in Phase 0 — the two `conductor/services/` modules under
      `node --test`, `composerTriggers.js` under vitest

**Done (2026-09-07)**: `conductor/services/fuzzy-match.mjs` (DP-based subsequence scorer, not a
greedy leftmost scan — needed to actually find the best alignment, e.g. `chat` in
`ui/src/lib/chat.js` vs the decoy `c`/`h`/`a`/`t` scattered through `ui/src/archat/x.js`),
`conductor/services/slash-commands.mjs`, `ui/src/lib/composerTriggers.js`. Tests: 12/12 in
`conductor/tests/track-10080-fuzzy-match.test.mjs` (`node --test`), 13/13 in
`ui/src/lib/composerTriggers.test.js` (vitest).

**Impact**: New shared modules. No existing file changes, no behaviour change yet.

---

## Phase 2: Files API endpoint with in-memory cache

**Problem**: The browser has no filesystem access, and re-running `git ls-files` per keystroke
would be wasteful even where the repository is local.

**Solution**: One `/api` route that resolves a cached path list and filters it with Phase 1's
matcher. Registered after `app.use('/api', requireAuth)` so it inherits authentication.

- [x] Add a manifest resolver to `ui/server/index.mjs`
    - [x] `readTrackedFiles(repoPath)` — `execFile('git', ['ls-files', '-z'])` in `repoPath`,
          split on NUL, no shell (REQ-5)
    - [x] Per-project in-memory cache with TTL and an in-flight promise map so concurrent misses
          share one git invocation rather than stampeding (REQ-2)
    - [x] Source tiering: disk → stored manifest → empty, reporting `source` (REQ-6)
- [x] Add `GET /api/projects/:id/files` (REQ-1, REQ-3, REQ-4)
    - [x] Clamp `limit` to 100, truncate `q` at 128 chars, both silently
    - [x] Return `{ files, source, total, truncated, age_seconds }`
    - [x] Missing project → 404; missing/unreadable repo → 200 with `source: "none"`
- [x] Server tests in `ui/server/tests/track-10080-files-api.test.mjs`, following the
      supertest + mocked `pg`/`fs` harness used by `track-10014-conductor-edit.test.mjs`

**Impact**: New route. `git ls-files` becomes a thing the API server runs. Nothing else changes.

**Done (2026-09-08)**: 13/13 tests pass in `ui/server/tests/track-10080-files-api.test.mjs`
(TC-24..TC-34, TC-61, TC-62 — the last two anticipate Phase 4's worker-manifest fallback since the
resolver already implements all three tiers). Also fixed a "not a git repository" edge case the
first draft missed: `readTrackedFiles` failing must fall through to the worker-manifest tier
(and then to `none`), not report `source: "disk"` with an empty list — REQ-6 requires `none` for
both "repo missing" and "not a git repo". Verified the rest of the server suite is unaffected: ran
the full `ui/server/tests/` suite both with and without this phase's changes (via a scoped `git
stash`) — the same 24 pre-existing failures (auth.test.mjs, track-1116-model-override.test.mjs,
api-routes.test.mjs, etc.) appear identically in both runs, confirming they predate this track
rather than being a regression it introduced.

---

## Phase 3: Composer autocomplete UI

**Problem**: `TrackChatComposer` is a bare input with no key handling; the completion experience
has to be added without disturbing the queued/live/disabled behaviour other tests assert on.

**Solution**: A headless hook holding menu state plus a presentational menu component, both wired
into the existing composer. The element stays an `<input>` with its existing `worker-chat-input`
test id, so no existing test has to change.

- [x] Create `ui/src/lib/useComposerAutocomplete.js`
    - [x] Derives the active trigger from value and caret via Phase 1's `detectTrigger`
    - [x] File source: debounced fetch of `/api/projects/:id/files?q=…` through `useApi` (REQ-14).
          Use the house debounce pattern already tested in this repo — `useEffect` with a
          `setTimeout`, a `cancelled` flag, and a `clearTimeout` cleanup, as in
          `ConnectionsStep.jsx:178-194` (its TC-24 asserts exactly this "far fewer requests than
          keystrokes" property). The `cancelled` flag is also what discards a stale in-flight
          response, so no `AbortController` is needed — though `useApi`'s `apiFetch` does spread
          `options` straight into `fetch`, so passing a `signal` would work if wanted
    - [x] Track source: filters the `tracks` prop with Phase 1's matcher, no request (REQ-15)
    - [x] Command source: filters `SLASH_COMMANDS` (REQ-16)
    - [x] `onKeyDown` handling arrows with wraparound, Enter, Tab, Escape (REQ-17, REQ-18)
    - [x] Dismissed-state latch keyed to the trigger token so Escape sticks (REQ-20)
- [x] Create `ui/src/components/AutocompleteMenu.jsx` (REQ-21)
    - [x] Dark surface matching the surrounding view, blue accent on the active row, the
          highlighted item scrolled into view
    - [x] Distinct empty states for "no matches" and "file list unavailable on this deployment"
- [x] Wire both into `ui/src/components/TrackChatComposer.jsx`
    - [x] Accept new `tracks` prop; pass `tracks` down from `ChatView`
    - [x] Attach `onKeyDown`; keep `onSubmit` behaviour identical when no menu is open
    - [x] Preserve the disabled hint, queued notice, live hint, error line and both test ids
          (REQ-22)
- [x] Component tests in `ui/src/components/TrackChatComposer.autocomplete.test.jsx`
- [x] Run the existing `ChatView.*.test.jsx` and `TrackChatComposer` suites to confirm no
      regression

**Impact**: The composer gains a menu. Sending behaviour is unchanged when no menu is open.

**Done (2026-09-08)**: 17/17 new component tests pass; the existing `ChatView.test.jsx` (15),
`ChatView.queued.test.jsx` (4) and `ChatView.wizard.test.jsx` (4) all still pass unchanged (66/66
total across the 6 suites this phase touches). Two implementation notes beyond the plan: (1)
`Enter`-submits-when-no-menu-is-open is now handled explicitly in `handleKeyDown` rather than
relying on the browser's implicit single-input form submission — needed once an `onKeyDown`
handler exists at all (jsdom doesn't implement implicit submission, so this also made TC-42
testable, not just correct in real browsers). (2) The empty-state branch is shared between a
literal `source: "none"` response and a non-ok/failed fetch (both land on `paths: [], source:
'none'` in the hook) — spec.md's own solution text ("the menu says the file list is unavailable
instead of failing the send") calls for this same graceful degradation on any failure, not only
the explicit `none` tier, so TC-49 asserts "no thrown error + still sends + unavailable state"
rather than "no menu at all".

---

## Phase 4: Worker file-manifest sync for remote deployments

**Problem**: In `remote-api` mode the API host is not the repository host, so Phase 2's disk path
never fires. The heartbeat is the wrong carrier for a file list — it fires every 10 seconds and a
manifest is far larger than the worktree summary that pattern was built for.

**Solution**: Compute on the existing slow tick, hash, and push only on change, to a dedicated
collector endpoint.

- [x] Migration `migrations/<ts>_add_project_file_manifest.sql` adding `file_manifest`,
      `file_manifest_digest`, `file_manifest_updated_at` to `projects`; hand-trimmed to only these
      additive changes, per the note in `20260905215931_add_collector_health.sql`
- [x] Regenerate `migrations/atlas.sum` (`atlas migrate hash`). The directory is hash-verified, so
      a new `.sql` file without a refreshed sum makes `atlas migrate apply` — which
      `make install-migrate` runs — reject the whole directory as tampered
- [x] Mirror the columns in **both** `prisma/schema.prisma` and `prisma/schema.sql`; the
      `collector_health` precedent touches both, and only `schema.sql` carries the raw DDL
- [x] Worker changes in `conductor/laneconductor.sync.mjs` (REQ-7, REQ-9, REQ-10)
    - [x] `refreshFileManifestCache()` alongside `refreshWorktreeSummaryCache()`, on the same
          60-second interval. No explicit `local-fs` guard is needed if the push goes through
          `patchCollectors`, which already early-returns in that mode — but keep the compute
          behind the same check so a `local-fs` worker does no pointless git work either
    - [x] Cap at 20,000 paths, set `truncated` beyond that
    - [x] sha256 digest; push only when it differs from the last successfully sent digest
    - [x] Push via `patchCollectors('/worker/file-manifest', body)` rather than a hand-rolled loop
          over `patch`. It already resolves per-collector tokens, records health, awaits
          collector 0 as the authoritative write, and fires the rest off. Two consequences worth
          knowing: it **throws** when collector 0 fails, so the digest must only be advanced after
          a successful await (TC-58); and a failed non-primary push is enqueued in the retry
          buffer, whose coalescing key is `(collector, method, path)` — so at most one manifest
          body per collector is ever held in memory, and it is always the newest
- [x] Add `PATCH /worker/file-manifest` to `ui/server/index.mjs` (REQ-8, REQ-11)
    - [x] `collectorAuth`-guarded, same as `/worker/heartbeat`
    - [x] Absent `files` key leaves the stored manifest untouched
- [x] Verify Phase 2's fallback branch now serves a worker-pushed manifest end to end
- [x] Tests: worker-side digest gating (`conductor/tests/`), endpoint behaviour
      (`ui/server/tests/`), and the fallback branch of the files API

**Impact**: `projects` gains three columns. Workers do one extra git call per minute and one HTTP
call only when the file list actually changed.

**Done (2026-09-08)**: `atlas migrate hash` + `atlas migrate validate` both clean. Worker changes
added two test-only interval/cap overrides (`LC_FILE_MANIFEST_INTERVAL_MS`,
`LC_FILE_MANIFEST_CAP`), the same established pattern as `LC_HEARTBEAT_INTERVAL_MS` /
`LC_RECONCILE_INTERVAL_MS` elsewhere in this file — without the cap override, exercising REQ-9's
20,000-path truncation would have meant committing 20,001 real files in a throwaway sandbox repo.
6/6 new E2E tests pass in `conductor/tests/track-10080-file-manifest.test.mjs` (real worker
process via `helpers/isolated-worker.mjs`, real mock collector — `mock-collector.mjs` gained a
`PATCH /worker/file-manifest` handler, `state.fileManifests`, and `/_set-fail-file-manifest`).
3/3 new endpoint-level tests in `ui/server/tests/track-10080-file-manifest-endpoint.test.mjs`
(TC-59 — rejected without a valid collector token — is satisfied structurally: this route uses
the exact same `collectorAuth` middleware function as `/worker/heartbeat`, whose own auth matrix
is already unit-tested elsewhere; a fresh 401 test here would need `COLLECTOR_TOKEN_ENV` set
before `index.mjs` loads, which no test file can do at runtime — noted in the test file itself).
Full regression check: `cd ui && npx vitest run` — 34 failing tests across 11 files, all
pre-existing (24 confirmed via the Phase 2 `git stash` comparison; the other 10, all in
`WorkflowSettings.test.jsx`, confirmed unrelated by inspection — that file/component imports
nothing this track touches). Coverage gate: `npx vitest run --coverage.reportOnFailure=true
server/tests/` (the flag needed because vitest's default coverage report is skipped on any test
failure, and this worktree carries the pre-existing failures above) — 66.77% lines / 72.35%
branches / 88.67% functions, all comfortably above the configured 49/40/50 thresholds.

---

## Phase 5: Integration, real-product verification and docs

**Problem**: Unit and component tests cannot tell us the feature is actually wired up in the
running app — the failure mode this project's quality gate calls out explicitly.

**Solution**: Drive the real app, with the real worker and API restarted, and record what was
observed.

- [ ] Restart the API server and worker so neither is running pre-change code
- [ ] Drive the flow by hand in the browser at `localhost:8090`: open Chat, type `@`, `#` and `/`,
      pick an item with the keyboard, send the message, and confirm the chosen text arrives in the
      track's `conversation.md`
- [ ] Record the observation (screenshot or the resulting `conversation.md` line) in
      `conversation.md`
- [ ] Confirm the `source: "none"` path degrades as specified rather than breaking send
- [ ] Run the full `cd ui && npm test` suite plus `node --test conductor/tests/`
- [ ] Stub scan across the touched paths; no `TODO`/`not yet implemented` left in code marked done
- [ ] Document the new endpoint and the trigger grammar in `conductor/tech-stack.md` or the skill,
      whichever the reviewer prefers

**Impact**: The track is demonstrably working in the real product, not just green in tests.
