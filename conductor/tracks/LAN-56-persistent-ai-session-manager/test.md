# Tests: Track 1060 — Persistent AI Session Manager

## Test Commands
```bash
node --test conductor/tests/session-manager.test.mjs
```

## Test Cases

### Phase 1: Session Storage
- [ ] TC-1: `loadSession('claude')` returns null when `conductor/.sessions/claude.json` does not exist
- [ ] TC-2: `loadSession('claude')` returns null when `lastUsedAt` is >60min ago (expired)
- [ ] TC-3: `loadSession('claude')` returns session object when `lastUsedAt` is <60min ago
- [ ] TC-4: `saveSession('claude', 'abc123', null)` writes valid JSON with correct structure and updates `lastUsedAt`
- [ ] TC-5: `clearSession('claude')` deletes the session file; subsequent `loadSession` returns null
- [ ] TC-6: `isSessionExpired` returns true for session with `lastUsedAt` 61 minutes ago
- [ ] TC-7: `isSessionExpired` returns false for session with `lastUsedAt` 30 minutes ago

### Phase 2: Claude Resume
- [ ] TC-8: `buildCliArgs` for Claude includes `['--resume', '<id>']` when warm session file exists
- [ ] TC-9: `buildCliArgs` for Claude omits `--resume` when no session file exists
- [ ] TC-10: `buildCliArgs` for Claude omits `--resume` when session is expired (>60min)
- [ ] TC-11: Worker log contains `[session] claude: warm resume <id>` on warm path
- [ ] TC-12: Worker log contains `[session] claude: cold start` on cold path

### Phase 3: Gemini Context
- [ ] TC-13: `buildCliArgs` for Gemini prepends `[SESSION CONTEXT]...[END CONTEXT]` block when warm session has `contextSummary`
- [ ] TC-14: `buildCliArgs` for Gemini does NOT prepend context when session is cold/expired
- [ ] TC-15: Worker log contains `[session] gemini: warm context prepended` on warm path

### Phase 4: Expiry & Compression
- [ ] TC-16: `cleanExpiredSessions` deletes `claude.json` when >60min old
- [ ] TC-17: `cleanExpiredSessions` does NOT delete `gemini.json` when <60min old
- [ ] TC-18: `needsCompression` flag is set when `lastUsedAt` is 16+ minutes ago at next activation
- [ ] TC-19: `conductor/.sessions/` directory is created automatically if missing

### Regression
- [ ] TC-20: Session resume failure (non-zero exit on --resume) falls back to cold start without crashing
- [ ] TC-21: Gemini summary capture failure saves previous `contextSummary` unchanged
- [ ] TC-22: `conductor/.sessions/` is listed in `.gitignore`

## Acceptance Criteria
- [ ] `node --test conductor/tests/session-manager.test.mjs` — all tests pass
- [ ] Second Claude run within 60min shows `[session] claude: warm resume` in worker log
- [ ] Second Gemini run within 60min shows context prepended in the prompt (visible in debug log)
- [ ] After 60min+ idle (simulated by backdating `lastUsedAt`), next run cold-starts cleanly
