# Track 1086: Persistent Track Sessions

**Lane**: implement
**Lane Status**: running
**Progress**: 90%
**Phase**: Phase 4 complete — resume-failure fallback (verified against the real claude CLI's actual error text) + auto-derived conversation.md audit trail, both verified end-to-end. Only Phase 5's remaining test tasks (reassignment cold-start) are left.
**Type**: dev
**Summary**: One resumable Claude session per (worker, track) across the whole lifecycle.

## Problem

Every lane action (`plan`, `implement`, `review`, ...) and every conversation
reply is an independent cold `claude -p` process with no session state. The
skill re-reads `product.md`, `tech-stack.md`, `design-language.md`, and the
track's `spec.md`/`plan.md`/`test.md`/`conversation.md` from scratch on
*every single call* — including calls for the same track seconds apart. Any
exploration Claude did during `plan` is thrown away by the time `implement`
spawns as a new process.

## Solution

- `track_sessions (track_number, worker_id, claude_session_id, created_at, last_used_at)`
  — one row per (worker, track).
- First call for a (worker, track) pair: generate a UUID, pass
  `--session-id <uuid>` to `claude -p`, store it.
- Every subsequent call for that pair — a later lane transition or a
  conversation reply — passes `--resume <uuid>` instead, with a prompt that's
  just the delta (the new instruction/message), since Claude already has
  context loaded from earlier in the session.
- `SKILL.md`'s "load all context" steps only run on the session's first call.
- Resilience: session store is local to the worker's machine — reassignment
  to a different worker naturally cold-starts (correct, not a bug). If
  `--resume` fails (pruned/corrupted session), fall back to cold-start and
  mint a fresh session.
- `conversation.md` stays as a derived, git-diffable audit log — written
  *after* each session turn completes, not re-read cold before every call.

Full design context: [docs/superpowers/specs/2026-08-07-remote-worker-identity-and-sessions-design.md](../../../docs/superpowers/specs/2026-08-07-remote-worker-identity-and-sessions-design.md)

## Phases
- [x] Phase 1: Schema — `track_sessions` table
- [x] Phase 2: `buildCliArgs`/`spawnCli` — session-id/resume selection logic, plus context-skip-on-resume (Phase 3 Tasks 1+3, pulled forward — same code location)
- [x] Phase 3: SKILL.md — new "Protocol: Session Continuity" section + pointers in plan/brainstorm/implement/review's context-loading steps
- [x] Phase 4: Resilience — resume-failure fallback (verified against the real claude CLI), conversation.md derivation from session turns, both verified end-to-end
- [ ] Phase 5: Tests — mostly already covered by Phases 2/4's end-to-end tests (session created on first call, resumed on subsequent, fallback on resume failure); reassignment cold-starts correctly (against 1084) remains

## Depends on
None to start — `track_sessions` keys on `worker_id` against the existing
`workers` table (from track 1033), so this can be built independently of
[1084](../1084-worker-identity-and-assignment/index.md). The relationship
actually runs the other way for one piece: 1084's continuity-first claim
routing (its Phase 3) reads `track_sessions` to know which of a developer's
own workers (`workers.user_uid` — 1084's `worker_pins` table was designed,
then removed as redundant with that column, see 1084's plan.md) already owns
a track's session — so 1086 should land before or alongside that specific
piece of 1084. Foundation for [1087](../1087-live-session-transcript-panel/index.md).
