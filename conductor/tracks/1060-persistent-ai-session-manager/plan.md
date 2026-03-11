# Plan: Track 1060 — Persistent AI Session Manager

## Phase 1: Session Storage Infrastructure ⏳

**Problem**: No mechanism exists to persist session state between worker invocations.
**Solution**: Create session file management module inside `laneconductor.sync.mjs`.

- [ ] Add `conductor/.sessions/` to `.gitignore`
- [ ] Implement `loadSession(cli)` — reads `conductor/.sessions/<cli>.json`, returns null if missing/expired
- [ ] Implement `saveSession(cli, sessionId, contextSummary)` — writes session file, updates `lastUsedAt`
- [ ] Implement `clearSession(cli)` — deletes session file
- [ ] Constants: `SESSION_WARM_TTL_MS = 60 * 60 * 1000` (60min), `SESSION_COMPRESS_TTL_MS = 15 * 60 * 1000` (15min)
- [ ] `isSessionExpired(session)` — returns true if `lastUsedAt` > 60min ago
- [ ] `isSessionStaleForCompression(session)` — returns true if `lastUsedAt` > 15min ago

**Commit**: `feat(track-1060): Phase 1 - session storage infrastructure`

---

## Phase 2: Claude Session Resume ⏳

**Problem**: Claude always cold-starts; `--resume <id>` is never passed.
**Solution**: Capture session ID after each Claude run and pass `--resume` on next warm run.

- [ ] In `buildCliArgs` for Claude: call `loadSession('claude')` — if warm, add `--resume <sessionId>` to args
- [ ] After `spawnCli` completes for Claude: capture session ID from Claude's local session store
  - Read most recently modified `.jsonl` file from `~/.claude/projects/<project-path-hash>/`
  - Extract conversation ID from filename (strip `.jsonl`)
- [ ] Call `saveSession('claude', capturedId, null)` after each successful Claude run
- [ ] If `--resume` causes non-zero exit on first prompt: catch, clear session, retry as cold start
- [ ] Worker logs: `[session] claude: warm resume <id>` / `[session] claude: cold start`

**Commit**: `feat(track-1060): Phase 2 - Claude session resume`

---

## Phase 3: Gemini Context Accumulation ⏳

**Problem**: Gemini CLI has no `--resume` flag — context is always lost.
**Solution**: Maintain a rolling context summary, prepend it to each Gemini prompt.

- [ ] In `buildCliArgs` for Gemini: call `loadSession('gemini')` — if warm and has `contextSummary`, prepend to prompt:
  ```
  [SESSION CONTEXT]\n<summary>\n[END CONTEXT]\n\n<original prompt>
  ```
- [ ] After `spawnCli` completes for Gemini (success): run a follow-up one-shot Gemini prompt:
  ```
  npx @google/gemini-cli -p "In 2-3 sentences, summarize what you just accomplished. Be specific about track numbers and files changed."
  ```
- [ ] Capture output, call `saveSession('gemini', null, capturedSummary)`
- [ ] If summary capture fails: save with previous summary (don't break the flow)
- [ ] Worker logs: `[session] gemini: warm context prepended` / `[session] gemini: cold start`

**Commit**: `feat(track-1060): Phase 3 - Gemini context accumulation`

---

## Phase 4: Idle Compression & Expiry ⏳

**Problem**: Session files accumulate; no cleanup when worker is idle.
**Solution**: Check and clean sessions on each auto-launch cycle.

- [ ] At start of `autoLaunchLocalFs`: call `cleanExpiredSessions()` — deletes session files > 60min old
- [ ] `needsCompression` flag: set to true when `lastUsedAt` > 15min at time of next activation
- [ ] For Claude + needsCompression: run a compression prompt via `--resume`: `"Summarize this conversation in 3-5 bullet points for future context."` → store result in `contextSummary`, set `needsCompression = false`
- [ ] For Gemini + needsCompression: already handled by Phase 3's post-run summary (no extra step needed)
- [ ] `conductor/.sessions/` created automatically if missing (no manual setup)

**Commit**: `feat(track-1060): Phase 4 - idle compression and expiry`

---

## Phase 5: Tests ⏳

**Problem**: Session logic is untested; regressions possible.
**Solution**: Unit tests for all session lifecycle paths.

- [ ] Write `conductor/tests/session-manager.test.mjs`
- [ ] TC-1: `loadSession` returns null for missing file
- [ ] TC-2: `loadSession` returns null for expired session (>60min)
- [ ] TC-3: `loadSession` returns session for warm file (<60min)
- [ ] TC-4: `saveSession` writes correct JSON structure
- [ ] TC-5: `clearSession` removes file
- [ ] TC-6: `buildCliArgs` for Claude includes `--resume <id>` when warm session exists
- [ ] TC-7: `buildCliArgs` for Claude omits `--resume` when no session
- [ ] TC-8: `buildCliArgs` for Gemini prepends context block when warm session with summary
- [ ] TC-9: `cleanExpiredSessions` deletes only expired files

**Commit**: `feat(track-1060): Phase 5 - session manager tests`
