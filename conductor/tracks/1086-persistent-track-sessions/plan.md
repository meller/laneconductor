# Plan: Persistent Track Sessions (Track 1086)

## Phase 1: Schema

**Problem**: No way to associate a Claude session with a (worker, track)
pair.
**Solution**: Migration adding `track_sessions`.

- [x] Task 1: Migration — `track_sessions (track_number TEXT, worker_id INTEGER REFERENCES workers(id), claude_session_id UUID, created_at TIMESTAMPTZ DEFAULT NOW(), last_used_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (track_number, worker_id))`
- [x] Task 2: Apply via Atlas, consistent with prior worker-security/mode migrations

**✅ Phase 1 complete (2026-08-09).** `migrations/20260809103807_add_track_sessions.sql`,
applied directly to the real `laneconductor` DB (same `atlas migrate apply`-chain
workaround as prior tracks — `atlas migrate diff` confirms zero drift afterward).
No separate index needed beyond the PK itself — the only lookup pattern (REQ-2)
is by the exact `(track_number, worker_id)` pair, which the PK already covers.

## Phase 2: Session Selection in buildCliArgs/spawnCli

**Problem**: Every claude spawn is a cold `--session-id`-less process.
**Solution**: Look up/create a session row before building CLI args.

- [x] Task 1: In `buildCliArgs`, look up `track_sessions` for `(track_number, worker_id)` — `GET /track/:num/session`, scoped server-side to the calling worker's own identity (`req.worker_id`, from its machine_token — not a client-supplied param)
- [x] Task 2: No row → generate UUID, add `--session-id <uuid>`, use the existing full "load all context" prompt path
- [x] Task 3: Row exists → add `--resume <claude_session_id>`; also skips `spawnCli`'s own project/track context-injection block (this turned out to be the same code location Phase 3 Task 3 was scoped for — folded in here since gating it needs the same `session` value already threaded through for Task 4)
- [x] Task 4: On successful spawn (in `spawnCli`, not `buildCliArgs` — a bail-out before spawn, e.g. no provider available, must never persist a session for a process that never ran), upsert `track_sessions` via `POST /track/:num/session`

**✅ Phase 2 complete (2026-08-09).** Scoped to the `claude` CLI path only,
matching `track_sessions.claude_session_id`'s design — `gemini`/
`antigravity`/generic CLI branches are untouched, still cold-start every
call (spec's REQ-2/REQ-4 language is claude-specific throughout; resuming
other CLIs isn't designed here, not silently assumed to work).

New endpoints: `GET`/`POST /track/:num/session` (`ui/server/index.mjs`,
6 Vitest tests, `ui/server/tests/track-1086-sessions.test.mjs`). Worker-side
`resolveTrackSession`/`persistTrackSession` fail open to cold-start on any
lookup error (matches this file's established pattern for claimable-tracks,
dispatch, etc. — a broken session endpoint degrades to today's behavior,
never blocks work).

Verified end-to-end against a real worker process, not just the API unit
tests: `conductor/tests/track-1086-session-worker.test.mjs` dispatches the
same track twice — confirms a session is minted and persisted on the first
call, and that the *exact same* session id is reused (not a second fresh
mint) on the second call, with context injection (`product.md`) present
only on the first. Verifying via mock-collector's session state and a
context-marker count, not by parsing CLI argv — the mock CLI has no `-p`
flag, and `spawnCli`'s "no `-p` found, use the last arg" context-injection
fallback (the correct behavior for genuinely custom CLIs) would clobber a
trailing session id if it were appended to the mock's argv; documented in
`buildCliArgs` rather than worked around by changing that fallback.

## Phase 3: SKILL.md Conditional Context Loading

**Problem**: The skill unconditionally instructs "load all context" every
call.
**Solution**: Make the load-context steps conditional on session freshness.

- [x] Task 1: Pass a fresh-vs-resumed signal into the prompt (e.g. `FRESH_SESSION: true/false`) — done in Phase 2 (`buildCliArgs`'s `freshnessMarker`, prepended to the claude prompt), since it's constructed right alongside `sessionArgs` from the same `session` value
- [ ] Task 2: Update `/laneconductor plan`, `implement`, `review`, `quality-gate`, and the conversation-reply prompt path in `.claude/skills/laneconductor/SKILL.md` to skip "load all context" steps when resuming — still open; this is Claude's own step-by-step instructions, separate from what the worker pre-injects
- [x] Task 3: Update `conductor/laneconductor.sync.mjs`'s own context-injection block (`spawnCli`, `contextPrompt` construction) to skip re-injecting `product.md`/`tech-stack.md`/track docs when resuming — done in Phase 2 (same code location as Task 4's spawn-confirmation logic, gated on `session?.isFresh !== false`)

## Phase 4: Resilience & conversation.md Derivation

**Problem**: Local session stores can go stale/missing; `conversation.md`
must stay a readable audit log without being read cold as an input.
**Solution**: Fallback path + post-turn derivation.

- [ ] Task 1: Detect `--resume` failure (session-not-found exit/error signal), fall back to cold-start + fresh `--session-id`, overwrite the stored row
- [ ] Task 2: After each session turn completes (lane action or conversation reply), append a derived human-readable entry to `conversation.md` — do not read it cold as a pre-call context source anymore
- [ ] Task 3: Verify `conversation.md` format stays compatible with existing UI parsing (Inbox view, track detail conversation tab)

## Phase 5: Tests

- [ ] Task 1: First lane action on a track creates a `track_sessions` row and passes `--session-id`
- [ ] Task 2: Second lane action on the same (worker, track) passes `--resume`, and the prompt does not include full context docs
- [ ] Task 3: A conversation reply on a track with an existing session resumes it rather than creating a second session
- [ ] Task 4: Simulated resume failure falls back to cold-start and repairs the stored session id
- [ ] Task 5: Reassigning a track to a different worker (via 1084) results in that worker cold-starting its own session
