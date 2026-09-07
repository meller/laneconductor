# Tests: Track 10080 — Composer smart autocomplete for @file mentions, @track references, and /slash commands

## Test Commands

```bash
# ONE-TIME: this worktree ships without node_modules, so every vitest command
# below fails at config load until these run.
npm install && (cd ui && npm install)

# UI unit + component + server-route tests (vitest)
cd ui && npm test

# A single suite while iterating
cd ui && npx vitest run src/lib/composerTriggers.test.js
cd ui && npx vitest run server/tests/track-10080-files-api.test.mjs
cd ui && npx vitest run src/components/TrackChatComposer.autocomplete.test.jsx

# Shared conductor/services modules — NOT covered by `npm test`. vitest's
# include globs are scoped to ui/, so these run under node:test instead,
# same as merge-mode.mjs and workspace-mode.mjs already do.
node --test conductor/tests/track-10080-fuzzy-match.test.mjs

# Worker-side tests (node:test, real processes / filesystem)
node --test conductor/tests/track-10080-file-manifest.test.mjs

# Coverage gate — thresholds are scoped to server/**/*.mjs, which Phase 2 grows
cd ui && npm run test:coverage

# Regression: the suites this track's changes could break
cd ui && npx vitest run src/components/ChatView.test.jsx src/components/ChatView.queued.test.jsx src/components/ChatView.wizard.test.jsx
```

## Test Cases

### Phase 1 — `conductor/services/fuzzy-match.mjs`

- [ ] TC-1: `fuzzyScore('ui/src/components/ChatView.jsx', 'chatview')` — expected: a number, not
      `null`
- [ ] TC-2: `fuzzyScore('Makefile', 'zzz')` — expected: `null`, so callers can filter on it
- [ ] TC-3: matching is case-insensitive in both directions — expected: `'ChatView'`/`'chatview'`
      and `'chatview'`/`'CHATVIEW'` both score
- [ ] TC-4: a candidate matching at a path-segment boundary outranks one matching mid-segment —
      expected: `ui/src/lib/chat.js` scores above `ui/src/archat/x.js` for `chat`
- [ ] TC-5: a consecutive-run match outranks a scattered subsequence — expected: `chatview` scores
      above `c-h-a-t-v-i-e-w`-style scatter
- [ ] TC-6: a basename match outranks a directory-only match — expected: `lib/ChatView.jsx` above
      `chatview/other.js` for `chatview`
- [ ] TC-7: two candidates with equal score are ordered by candidate string ascending — expected:
      stable, repeatable ordering across runs
- [ ] TC-8: `fuzzyRank(list, '', { limit: 5 })` — expected: the first 5 in input order, no
      exception
- [ ] TC-9: `fuzzyRank` respects `limit` — expected: never more than `limit` results

### Phase 1 — `conductor/services/slash-commands.mjs`

- [ ] TC-10: `SLASH_COMMANDS` includes at minimum `plan`, `implement`, `review`, `move`,
      `brainstorm`, `pulse`, `comment` — expected: each with a non-empty `description`
- [ ] TC-11: `commandInsertText({ name: 'move' })` — expected: `'/laneconductor move '`

### Phase 1 — `ui/src/lib/composerTriggers.js`

- [ ] TC-12: `detectTrigger('@src/comp', 9)` — expected: `{ kind: 'file', query: 'src/comp' }`
- [ ] TC-13: `detectTrigger('#100', 4)` — expected: `{ kind: 'track', query: '100' }`
- [ ] TC-14: `detectTrigger('@track:100', 10)` — expected: `{ kind: 'track', query: '100' }`
- [ ] TC-15: `detectTrigger('/mo', 3)` — expected: `{ kind: 'command', query: 'mo' }`
- [ ] TC-16: `detectTrigger('look at /mo', 11)` — expected: `null`; `/` only triggers at
      position 0
- [ ] TC-17: `detectTrigger('@src/lib', 8)` — expected: `kind: 'file'`, not `command`; the inner
      `/` must not retrigger
- [ ] TC-18: `detectTrigger('@tracker.js', 11)` — expected: `kind: 'file'` with query
      `tracker.js`, not the track menu
- [ ] TC-19: `detectTrigger('foo@bar', 7)` — expected: `null`; the trigger char must begin a token
- [ ] TC-20: `detectTrigger('a#b', 3)` — expected: `null`, same reason
- [ ] TC-21: `detectTrigger('see @Chat here', 9)` — expected: `{ kind: 'file', query: 'Chat' }`;
      caret mid-string, trigger preceded by whitespace
- [ ] TC-22: `applyCompletion('see @Chat here', trigger, 'ui/src/ChatView.jsx')` — expected: value
      `'see ui/src/ChatView.jsx here'` and caret positioned just after the inserted trailing space
- [ ] TC-23: `applyCompletion` on a trigger at end of string — expected: exactly one trailing
      space, not two

### Phase 2 — `GET /api/projects/:id/files`

- [ ] TC-24: project with a real `repo_path`, `?q=chat` — expected: `200`, `source: "disk"`, files
      ranked best-first, every returned `path` present in the mocked `git ls-files` output
- [ ] TC-25: no `q` — expected: `200` with the first `limit` paths in deterministic path order
- [ ] TC-26: `?limit=5000` — expected: `200` with at most 100 results, no error
- [ ] TC-27: `q` of 500 characters — expected: `200`, no error, truncated internally
- [ ] TC-28: two concurrent requests on a cold cache — expected: `git ls-files` invoked once, not
      twice (in-flight promise sharing)
- [ ] TC-29: a second request inside the TTL — expected: no further `git ls-files` invocation
- [ ] TC-30: project with `repo_path: null` and no stored manifest — expected: `200`,
      `source: "none"`, `files: []` — explicitly not a `4xx`/`5xx`
- [ ] TC-31: `repo_path` set to a directory that is not a git repository — expected: same as
      TC-30, `source: "none"`, no unhandled rejection
- [ ] TC-32: unknown project id — expected: `404`
- [ ] TC-33: `git ls-files` is invoked without a shell and with `cwd` equal to the project's
      `repo_path` — expected: `execFile` called with an argument array, never a concatenated
      string
- [ ] TC-34: the response body contains no file contents under any input — expected: keys limited
      to `files`/`source`/`total`/`truncated`/`age_seconds`

### Phase 3 — composer autocomplete

- [ ] TC-35: typing `@Chat` — expected: the menu appears listing files returned by a mocked files
      API
- [ ] TC-36: typing `#100` — expected: the menu lists matching tracks from the `tracks` prop and
      **no** request is issued to the files API
- [ ] TC-37: typing `/` at position 0 — expected: the menu lists `/laneconductor` commands
- [ ] TC-38: ArrowDown then Enter — expected: the second item is inserted into the input
- [ ] TC-39: ArrowUp from the first item — expected: selection wraps to the last item
- [ ] TC-40: Tab with the menu open — expected: accepts the highlighted item; focus stays in the
      input and does not move to the Send button
- [ ] TC-41: Enter with the menu open — expected: the completion is inserted and **no** POST to
      `/comments` is made
- [ ] TC-42: Enter with no menu open — expected: the message is posted, exactly as today
- [ ] TC-43: Escape — expected: the menu closes, the typed text is left untouched, and the menu
      does not immediately reopen while the trigger token is unchanged
- [ ] TC-44: after Escape, typing one more character into the trigger token — expected: the menu
      reopens
- [ ] TC-45: five rapid keystrokes into a file trigger — expected: one debounced request, not five
- [ ] TC-46: a slow response arriving after a newer keystroke — expected: the stale response is
      ignored and does not overwrite the newer results
- [ ] TC-47: files API returns `source: "none"` — expected: an explicit "file list unavailable"
      empty state, and the composer still sends normally
- [ ] TC-48: files API returns an empty match set — expected: a "no matches" empty state, visibly
      distinct from TC-47
- [ ] TC-49: files API returns a non-ok status — expected: no thrown error, no menu, composer
      still sends
- [ ] TC-50: composer disabled (no `trackNumber`) — expected: typing `@` opens no menu and the
      existing `worker-chat-disabled-hint` still renders
- [ ] TC-51: regression — the queued notice (`composer-queued-notice`) and live hint
      (`composer-live-hint`) still render under the same conditions as before this track
- [ ] TC-52: regression — `worker-chat-input` and `worker-chat-send` test ids still resolve, so
      the existing `ChatView` suites keep passing unchanged

### Phase 4 — worker file-manifest sync

- [ ] TC-53: worker in `local-fs` mode — expected: no manifest computed and no push attempted
- [ ] TC-54: first tick in a collector mode — expected: manifest computed and one
      `PATCH /worker/file-manifest` issued
- [ ] TC-55: second tick with an unchanged file list — expected: digest matches, **no** second
      push
- [ ] TC-56: a file added between ticks — expected: digest changes and exactly one push is issued
- [ ] TC-57: a repository with more than 20,000 tracked files — expected: the manifest is
      truncated to 20,000 and `truncated: true` is sent
- [ ] TC-58: a failed push — expected: the last-sent digest is **not** advanced, so the next tick
      retries rather than silently skipping
- [ ] TC-59: `PATCH /worker/file-manifest` without a valid collector token — expected: rejected by
      `collectorAuth`, same as `/worker/heartbeat`
- [ ] TC-60: a body with no `files` key — expected: the stored manifest is left untouched, not
      overwritten with null
- [ ] TC-61: files API on a project with `repo_path` unreachable but a stored manifest present —
      expected: `200` with `source: "worker"` and results drawn from the stored manifest
- [ ] TC-62: `age_seconds` on a worker-sourced response — expected: derived from
      `file_manifest_updated_at`, not from the request time
- [ ] TC-63: collector 0 rejects the push, so `patchCollectors` throws — expected: the throw is
      caught, the last-sent digest is left unadvanced, and the worker's own cycle is not failed
- [ ] TC-64: `atlas migrate validate` (or `atlas migrate hash --dry-run`) against `migrations/`
      after adding the new file — expected: clean, confirming `atlas.sum` was regenerated and
      `make install-migrate` will not reject the directory

## Real-Product Verification (Phase 5)

Unit tests cannot detect a feature that was never wired up. These are run by hand against the
running app, after restarting both long-running processes.

- [ ] TC-65: API server and worker restarted before verifying, so neither is serving pre-change
      code
- [ ] TC-66: in the browser at `localhost:8090`, open Chat, type `@` plus a few characters, pick a
      file with the arrow keys and Enter, send the message, and confirm the chosen path appears
      verbatim in the track's `conversation.md`
- [ ] TC-67: repeat for `#` (track) and `/` (command) triggers
- [ ] TC-68: observation recorded in `conversation.md` — a screenshot or the resulting
      `conversation.md` line, not a description of the code

## Acceptance Criteria

- [ ] Dependencies installed in the worktree and a green pre-change baseline recorded, so
      "no regressions" is measured against something known
- [ ] All unit, component and server-route tests above pass, under **both** runners — a green
      `cd ui && npm test` alone does not cover the `conductor/services/` modules
- [ ] `cd ui && npm run test:coverage` still meets its configured thresholds after Phase 2 grows
      `ui/server/index.mjs`
- [ ] The existing `ChatView` and `TrackChatComposer` suites pass unchanged
- [ ] Real-product verification (TC-65..TC-68) performed and its observation recorded
- [ ] Stub scan over `conductor/services`, `ui/server`, `ui/src` finds no `TODO` /
      `not yet implemented` in code paths this track marks complete
- [ ] No regressions in the Chat send path, the queued-intervention notice, or the worker
      heartbeat
