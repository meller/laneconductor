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

- [ ] Task 1: In `buildCliArgs`, look up `track_sessions` for `(track_number, worker_id)`
- [ ] Task 2: No row → generate UUID, add `--session-id <uuid>`, use the existing full "load all context" prompt path
- [ ] Task 3: Row exists → add `--resume <claude_session_id>`, use a delta-only prompt (the lane action instruction or new conversation message, no full context re-injection)
- [ ] Task 4: On successful spawn, insert (first call) or update `last_used_at` (subsequent calls) in `track_sessions`

## Phase 3: SKILL.md Conditional Context Loading

**Problem**: The skill unconditionally instructs "load all context" every
call.
**Solution**: Make the load-context steps conditional on session freshness.

- [ ] Task 1: Pass a fresh-vs-resumed signal into the prompt (e.g. `FRESH_SESSION: true/false`)
- [ ] Task 2: Update `/laneconductor plan`, `implement`, `review`, `quality-gate`, and the conversation-reply prompt path in `.claude/skills/laneconductor/SKILL.md` to skip "load all context" steps when resuming
- [ ] Task 3: Update `conductor/laneconductor.sync.mjs`'s own context-injection block (`spawnCli`, `contextPrompt` construction) to skip re-injecting `product.md`/`tech-stack.md`/track docs when resuming

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
