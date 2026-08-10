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
- [x] Task 2: Update `/laneconductor plan`, `implement`, `review`, `brainstorm`, and the conversation-reply prompt path in `.claude/skills/laneconductor/SKILL.md` to skip "load all context" steps when resuming. New "Protocol: Session Continuity" section explains `FRESH_SESSION: true/false` once; each command's context-loading step gets a short pointer back to it plus an explicit carve-out for files that must always be re-read (`conversation.md`, `last_run.log` — anything that could have new content since the last turn, not just static docs). `quality-gate` and the conversation-reply custom prompt weren't touched: quality-gate doesn't have a big context-reload step to begin with (it mostly runs commands), and the conversation-reply prompt (`autoLaunchLocalFs`'s `customPrompt`) was already minimal/delta-style by design (just "read conversation.md, reply") — nothing more to condition there.
- [x] Task 3: Update `conductor/laneconductor.sync.mjs`'s own context-injection block (`spawnCli`, `contextPrompt` construction) to skip re-injecting `product.md`/`tech-stack.md`/track docs when resuming — done in Phase 2 (same code location as Task 4's spawn-confirmation logic, gated on `session?.isFresh !== false`)

**✅ Phase 3 complete (2026-08-09).**

## Phase 4: Resilience & conversation.md Derivation

**Problem**: Local session stores can go stale/missing; `conversation.md`
must stay a readable audit log without being read cold as an input.
**Solution**: Fallback path + post-turn derivation.

- [x] Task 1: Detect `--resume` failure (session-not-found exit/error signal), fall back to cold-start + fresh `--session-id`, overwrite the stored row
- [x] Task 2: After each session turn completes (lane action or conversation reply), append a derived human-readable entry to `conversation.md` — do not read it cold as a pre-call context source anymore
- [x] Task 3: Verify `conversation.md` format stays compatible with existing UI parsing (Inbox view, track detail conversation tab)

**✅ Phase 4 complete (2026-08-10).**

**Task 1**: `isResumeFailure(logContent)` (`conductor/session-resilience-utils.mjs`)
detects a `--resume` call failing because the session no longer exists.
Signature confirmed against the **real** `claude` CLI, not guessed:
`claude --resume <bad-uuid> -p "..."` exits 1 with `"No conversation found
with session ID: <uuid>"`. New `DELETE /track/:num/session` (scoped to
`req.worker_id`, same pattern as GET/POST) invalidates the stale row;
`spawnCli`'s exit handler calls it when `session && !session.isFresh` and
the failure matches, reusing the log content already read for the
existing quota-exhaustion check (no extra I/O). Deliberately does **not**
retry within the same attempt (would mean reconstructing the whole
lock/worktree/context-injection/spawn cycle inside an already-complex exit
handler) — instead it clears the stale session so whatever retries next
(auto-launch's existing `max_retries` loop, or a manual re-dispatch) cold-
starts instead of repeating the same doomed `--resume` forever.

**Task 2**: `spawnCli`'s exit handler appends `> **system**: Session turn —
{label} ({started|resumed} session): {PASS|FAIL} (exit {code}).` to
`conversation.md` after every session-tracked turn (gated on `session`
being set — claude-only, matching this track's scope throughout), via a
normal file write — no separate DB plumbing, it flows through the existing
`syncConversation` FS→DB pipeline exactly like any comment a human or
Claude itself writes. This guarantees a baseline audit trail even for
commands (like a plain successful `implement` phase) that don't
explicitly post their own comment.

**Task 3**: covered by Task 2's own verification, not separately — the
derived entry uses the exact `> **author**: body` format `sync-
conversation-utils.mjs` already parses (locked in with a dedicated
regression test), so there's no new format for the UI to handle.

**Verified end-to-end**, not just unit-level:
- `conductor/tests/track-1086-session-resilience-worker.test.mjs` — seeds
  a broken session, confirms detection + invalidation + a genuinely new
  session on the next attempt (mock-cli simulates the real "No
  conversation found" text via a sentinel-file toggle, since the
  environment can't change mid-worker-lifetime). Caught a test-design bug
  while writing it: the test's own `max_retries: 1` meant the first
  failure correctly requeued (`Lane Status: queue`) rather than terminally
  failing, which the *already-correct* dispatch-status logic (track 1085)
  reports as `'done'`, not `'failed'` — fixed the test's `max_retries: 0`,
  not the dispatch logic.
- `conductor/tests/track-1086-session-worker.test.mjs`'s new third test —
  dispatches the same track twice, confirms both a "started session" and
  a "resumed session" entry land in `conversation.md` *and* actually reach
  `track_comments` through the real sync pipeline (extended
  `mock-collector.mjs` to record posted comments for this, not just infer
  from file content).

## Phase 5: Tests

- [x] Task 1: First lane action on a track creates a `track_sessions` row and passes `--session-id` — covered by Phase 2's `track-1086-session-worker.test.mjs` (test 1)
- [x] Task 2: Second lane action on the same (worker, track) passes `--resume`, and the prompt does not include full context docs — covered by Phase 2's `track-1086-session-worker.test.mjs` (test 2)
- [x] Task 3: A conversation reply on a track with an existing session resumes it rather than creating a second session — same code path as Task 2 (`buildCliArgs`/`resolveTrackSession` don't distinguish lane actions from conversation replies), no separate test needed
- [x] Task 4: Simulated resume failure falls back to cold-start and repairs the stored session id — covered by Phase 4's `track-1086-session-resilience-worker.test.mjs`
- [x] Task 5: Reassigning a track to a different worker (via 1084) results in that worker cold-starting its own session

**✅ Phase 5 complete (2026-08-10).** Tasks 1-4 were already proven end-to-end
by earlier phases' worker-process tests; only Task 5 needed new coverage.
`GET/POST/DELETE /track/:num/session` all scope their SQL by `req.worker_id`
(resolved server-side from the caller's own machine_token, never
client-supplied — see Phase 2), so reassignment cold-start is correct by
construction, not something `buildCliArgs` has to special-case. Added an
explicit test locking this in: `ui/server/tests/track-1086-sessions.test.mjs`
— worker 8 querying a track that has a stored session for worker 7 gets
`claude_session_id: null`, proven via the actual parameterized SQL call
(`['001', 8]`), not just inferred from the first test's param-shape
assertion. A full two-worker *process*-level test (like 1085's dispatch
isolation test) wasn't added on top: `mock-collector.mjs`'s session state is
deliberately track-number-only with no per-worker identity (documented in
its own comment — every mock worker shares one machine_token), so it can't
actually exercise this path; the real per-worker scoping lives entirely in
the Collector API's SQL, which the new Vitest test verifies directly.

Track 1086 is now fully complete — all 5 phases done.
