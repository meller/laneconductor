# Track 10080: Composer smart autocomplete for @file mentions, @track references, and /slash commands

Five phases. Phase 1 is pure logic with no I/O, Phase 2 is the endpoint, Phase 3 is the visible
feature, Phase 4 extends Phase 2's fallback branch for remote deployments, Phase 5 verifies the
whole thing against a running app.

Phases 3 and 4 are independent of each other once Phase 2 lands, so they can be reordered if one
turns out to be blocked. Phase 3 is placed first because it is what a user can see.

---

## Phase 1: Shared matching and trigger logic

**Problem**: Ranking, trigger detection and text insertion are the parts most likely to be subtly
wrong, and the hardest to debug through a DOM. There is no fuzzy matcher in the repository yet.

**Solution**: Land them first as pure, dependency-free modules with full unit coverage, so Phases
2 and 3 assemble tested parts rather than inventing behaviour inline. Shared modules go in
`conductor/services/`, the established home for logic imported by both `ui/server/index.mjs` and
`ui/src/**` (precedent: `conductor/providers.mjs`, `conductor/services/merge-mode.mjs`).

- [ ] Create `conductor/services/fuzzy-match.mjs` (REQ-12)
    - [ ] `fuzzyScore(candidate, query)` — case-insensitive subsequence match, returns `null` on
          no match so callers can filter on it
    - [ ] Score bonuses: consecutive-run length, match starting a path segment (after `/`),
          match inside the basename over the directory, earlier first-match position, shorter
          candidate as final tiebreak
    - [ ] `fuzzyRank(candidates, query, { limit, key })` — sorts by score descending, then by the
          candidate string ascending so ordering is total and stable; empty query returns the
          first `limit` in input order
- [ ] Create `conductor/services/slash-commands.mjs` (REQ-13)
    - [ ] `SLASH_COMMANDS` — one entry per `/laneconductor` command with `name`, `args`,
          `description`, sourced from the skill's Quick Reference table
    - [ ] `commandInsertText(cmd)` returning `/laneconductor <name> `
- [ ] Create `ui/src/lib/composerTriggers.js`
    - [ ] `detectTrigger(value, caret)` → `null` or `{ kind, query, start, end }` implementing the
          trigger grammar in spec.md: `@` files, `#` and `@track:` tracks, `/` commands at
          position 0 only, trigger character must begin a token
    - [ ] `applyCompletion(value, trigger, insertText)` → `{ value, caret }`, replacing only the
          trigger token and appending one trailing space (REQ-19)
- [ ] Unit tests for all three modules, including the ambiguity cases: `@tracker.js` opens files
      not tracks, `@src/lib` does not open the command menu, `a#b` and `foo@bar` open nothing

**Impact**: New shared modules. No existing file changes, no behaviour change yet.

---

## Phase 2: Files API endpoint with in-memory cache

**Problem**: The browser has no filesystem access, and re-running `git ls-files` per keystroke
would be wasteful even where the repository is local.

**Solution**: One `/api` route that resolves a cached path list and filters it with Phase 1's
matcher. Registered after `app.use('/api', requireAuth)` so it inherits authentication.

- [ ] Add a manifest resolver to `ui/server/index.mjs`
    - [ ] `readTrackedFiles(repoPath)` — `execFile('git', ['ls-files', '-z'])` in `repoPath`,
          split on NUL, no shell (REQ-5)
    - [ ] Per-project in-memory cache with TTL and an in-flight promise map so concurrent misses
          share one git invocation rather than stampeding (REQ-2)
    - [ ] Source tiering: disk → stored manifest → empty, reporting `source` (REQ-6)
- [ ] Add `GET /api/projects/:id/files` (REQ-1, REQ-3, REQ-4)
    - [ ] Clamp `limit` to 100, truncate `q` at 128 chars, both silently
    - [ ] Return `{ files, source, total, truncated, age_seconds }`
    - [ ] Missing project → 404; missing/unreadable repo → 200 with `source: "none"`
- [ ] Server tests in `ui/server/tests/track-10080-files-api.test.mjs`, following the
      supertest + mocked `pg`/`fs` harness used by `track-10014-conductor-edit.test.mjs`

**Impact**: New route. `git ls-files` becomes a thing the API server runs. Nothing else changes.

---

## Phase 3: Composer autocomplete UI

**Problem**: `TrackChatComposer` is a bare input with no key handling; the completion experience
has to be added without disturbing the queued/live/disabled behaviour other tests assert on.

**Solution**: A headless hook holding menu state plus a presentational menu component, both wired
into the existing composer. The element stays an `<input>` with its existing `worker-chat-input`
test id, so no existing test has to change.

- [ ] Create `ui/src/lib/useComposerAutocomplete.js`
    - [ ] Derives the active trigger from value and caret via Phase 1's `detectTrigger`
    - [ ] File source: debounced fetch of `/api/projects/:id/files?q=…` through `useApi` (REQ-14).
          Use the house debounce pattern already tested in this repo — `useEffect` with a
          `setTimeout`, a `cancelled` flag, and a `clearTimeout` cleanup, as in
          `ConnectionsStep.jsx:178-194` (its TC-24 asserts exactly this "far fewer requests than
          keystrokes" property). The `cancelled` flag is also what discards a stale in-flight
          response, so no `AbortController` is needed — though `useApi`'s `apiFetch` does spread
          `options` straight into `fetch`, so passing a `signal` would work if wanted
    - [ ] Track source: filters the `tracks` prop with Phase 1's matcher, no request (REQ-15)
    - [ ] Command source: filters `SLASH_COMMANDS` (REQ-16)
    - [ ] `onKeyDown` handling arrows with wraparound, Enter, Tab, Escape (REQ-17, REQ-18)
    - [ ] Dismissed-state latch keyed to the trigger token so Escape sticks (REQ-20)
- [ ] Create `ui/src/components/AutocompleteMenu.jsx` (REQ-21)
    - [ ] Dark surface matching the surrounding view, blue accent on the active row, the
          highlighted item scrolled into view
    - [ ] Distinct empty states for "no matches" and "file list unavailable on this deployment"
- [ ] Wire both into `ui/src/components/TrackChatComposer.jsx`
    - [ ] Accept new `tracks` prop; pass `tracks` down from `ChatView`
    - [ ] Attach `onKeyDown`; keep `onSubmit` behaviour identical when no menu is open
    - [ ] Preserve the disabled hint, queued notice, live hint, error line and both test ids
          (REQ-22)
- [ ] Component tests in `ui/src/components/TrackChatComposer.autocomplete.test.jsx`
- [ ] Run the existing `ChatView.*.test.jsx` and `TrackChatComposer` suites to confirm no
      regression

**Impact**: The composer gains a menu. Sending behaviour is unchanged when no menu is open.

---

## Phase 4: Worker file-manifest sync for remote deployments

**Problem**: In `remote-api` mode the API host is not the repository host, so Phase 2's disk path
never fires. The heartbeat is the wrong carrier for a file list — it fires every 10 seconds and a
manifest is far larger than the worktree summary that pattern was built for.

**Solution**: Compute on the existing slow tick, hash, and push only on change, to a dedicated
collector endpoint.

- [ ] Migration `migrations/<ts>_add_project_file_manifest.sql` adding `file_manifest`,
      `file_manifest_digest`, `file_manifest_updated_at` to `projects`; hand-trimmed to only these
      additive changes, per the note in `20260905215931_add_collector_health.sql`
- [ ] Regenerate `migrations/atlas.sum` (`atlas migrate hash`). The directory is hash-verified, so
      a new `.sql` file without a refreshed sum makes `atlas migrate apply` — which
      `make install-migrate` runs — reject the whole directory as tampered
- [ ] Mirror the columns in **both** `prisma/schema.prisma` and `prisma/schema.sql`; the
      `collector_health` precedent touches both, and only `schema.sql` carries the raw DDL
- [ ] Worker changes in `conductor/laneconductor.sync.mjs` (REQ-7, REQ-9, REQ-10)
    - [ ] `refreshFileManifestCache()` alongside `refreshWorktreeSummaryCache()`, on the same
          60-second interval. No explicit `local-fs` guard is needed if the push goes through
          `patchCollectors`, which already early-returns in that mode — but keep the compute
          behind the same check so a `local-fs` worker does no pointless git work either
    - [ ] Cap at 20,000 paths, set `truncated` beyond that
    - [ ] sha256 digest; push only when it differs from the last successfully sent digest
    - [ ] Push via `patchCollectors('/worker/file-manifest', body)` rather than a hand-rolled loop
          over `patch`. It already resolves per-collector tokens, records health, awaits
          collector 0 as the authoritative write, and fires the rest off. Two consequences worth
          knowing: it **throws** when collector 0 fails, so the digest must only be advanced after
          a successful await (TC-58); and a failed non-primary push is enqueued in the retry
          buffer, whose coalescing key is `(collector, method, path)` — so at most one manifest
          body per collector is ever held in memory, and it is always the newest
- [ ] Add `PATCH /worker/file-manifest` to `ui/server/index.mjs` (REQ-8, REQ-11)
    - [ ] `collectorAuth`-guarded, same as `/worker/heartbeat`
    - [ ] Absent `files` key leaves the stored manifest untouched
- [ ] Verify Phase 2's fallback branch now serves a worker-pushed manifest end to end
- [ ] Tests: worker-side digest gating (`conductor/tests/`), endpoint behaviour
      (`ui/server/tests/`), and the fallback branch of the files API

**Impact**: `projects` gains three columns. Workers do one extra git call per minute and one HTTP
call only when the file list actually changed.

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
