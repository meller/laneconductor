# Spec: Persistent Track Sessions (Track 1086)

## Problem Statement

`conductor/laneconductor.sync.mjs` spawns `claude -p ...` with no
`--session-id`/`--resume`/`--continue`. Per `buildCliArgs`
(`conductor/laneconductor.sync.mjs:3522-3527`), every call is a cold process.
The skill's own instructions
([SKILL.md:1153](../../../.claude/skills/laneconductor/SKILL.md),
1189-1190, 1252) then tell Claude to re-read `product.md`, `tech-stack.md`,
`design-language.md`, and the track's `spec.md`/`plan.md`/`test.md`/
`conversation.md` from disk on every invocation — for the same track, across
consecutive lane transitions, seconds apart. Claude Code natively supports
resumable sessions (`--session-id <uuid>`, `--resume <value>`,
`-c/--continue`, sessions persisted to disk by default) — none of this is
used today.

## Requirements

**REQ-1: Session table**
- `track_sessions (track_number TEXT, worker_id INTEGER REFERENCES workers(id), claude_session_id UUID, created_at TIMESTAMPTZ DEFAULT NOW(), last_used_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (track_number, worker_id))`.

**REQ-2: Session selection in `buildCliArgs`/`spawnCli`**
- Before building CLI args, look up `track_sessions` for `(track_number, worker_id)`.
- No row: generate a UUID, add `--session-id <uuid>` to the claude args, use
  the existing full "load all context" prompt path, insert the row after
  successful spawn.
- Row exists: add `--resume <claude_session_id>` instead of `--session-id`,
  and skip full context injection — the prompt is just the action's delta
  (e.g. the lane action instruction, or the new conversation message).
  Update `last_used_at`.

**REQ-3: SKILL.md conditional context loading**
- The "load all context" steps become conditional on whether this is a fresh
  session (signaled via a flag/marker in the prompt, e.g. `FRESH_SESSION:
  true`) vs. a resumed one.

**REQ-4: Resume failure fallback**
- If a `claude -p --resume <uuid>` invocation exits with a session-not-found
  error, treat it as REQ-2's "no row" path: cold-start with a fresh
  `--session-id`, overwrite the stored row.

**REQ-5: `conversation.md` derivation**
- After a session turn completes (any lane action or a conversation reply),
  append a human-readable entry to `conversation.md` derived from that turn's
  output — not read cold as an input to the next call. Format stays
  compatible with today's `conversation.md` (git-diffable, existing UI
  parsing unaffected).

**REQ-6: Reassignment behavior**
- If track 1084 assigns a track to a different worker mid-lifecycle, that
  worker has no `track_sessions` row and cold-starts per REQ-2 — this is
  expected, not an error condition to special-case.

## Acceptance Criteria

- [ ] `track_sessions` migration applied
- [ ] First lane action on a track creates a session row and passes
      `--session-id`
- [ ] Second lane action on the same track (same worker) passes `--resume`
      and does NOT re-inject full context docs
- [ ] A conversation reply on a track with an existing session also resumes
      it (not a separate session)
- [ ] Simulated resume failure falls back to cold-start and repairs the
      stored session id
- [ ] Reassigning a track to a different worker results in that worker
      cold-starting its own session (verified against 1084's claim logic)
- [ ] `conversation.md` content remains readable/git-diffable in its current
      format after the change
