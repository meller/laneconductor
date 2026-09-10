# Tests: Track AM-10090 — Resumed session ignores new human input, re-clobbering respecced track files

## Test Commands

```bash
# Phase 1 — pure digest module
node --test conductor/tests/track-doc-digest.test.mjs

# Phase 3/4 — worker capture + resume decision (mock collector, mock CLI)
node --test conductor/tests/track-10090-session-doc-drift.test.mjs

# Phase 2 — collector endpoints
cd ui && npx vitest run server/tests/track-10090-session-doc-digest.test.mjs

# Regression: the session suites this track modifies
node --test conductor/tests/track-1086-session-worker.test.mjs
node --test conductor/tests/track-10047-bounded-resume.test.mjs
node --test conductor/tests/conversation-tail.test.mjs
cd ui && npx vitest run server/tests/track-1086-sessions.test.mjs

# MANDATORY after any full suite run — this repo leaks real workers
ps aux | grep laneconductor.sync.mjs | grep -v grep
```

## Test Cases

### Phase 1 — `conductor/services/track-doc-digest.mjs`

- [ ] TC-1: Identical inputs produce an identical digest — expected: stable,
      deterministic hex string across repeated calls
- [ ] TC-2: Changing `spec.md` body text changes the digest — expected: different
      hex
- [ ] TC-3: Changing `plan.md` body text changes the digest — expected: different
      hex
- [ ] TC-4: Changing `test.md` body text changes the digest — expected: different
      hex
- [ ] TC-5 (REQ-3, the load-bearing one): mutating only `**Lane**`,
      `**Lane Status**`, `**Progress**`, `**Phase**`, `**Last Run**`,
      `**Waiting for reply**`, `**PR URL**` or `**KPI Actual**` in `index.md`
      — expected: digest **unchanged**
- [ ] TC-6 (REQ-2): mutating `**Summary**`, `**Type**`, `**Auto Run**`,
      `**Merge Mode**`, `**Workspace**`, `**Track Kind**` or `**Model**` — each
      expected: digest **changes**
- [ ] TC-7 (REQ-5): CRLF line endings, per-line trailing whitespace, and
      trailing blank lines — expected: digest unchanged versus the normalised
      form
- [ ] TC-8 (REQ-5): a missing file (`null`) versus a present-but-empty file
      (`''`) — expected: two *different* digests
- [ ] TC-9 (REQ-10): `hasTrackDocDrift({ storedDigest: null, currentDigest: 'abc' })`
      — expected: `{ drift: false, reason: null }`; with a differing non-null
      stored digest — expected: `{ drift: true, reason: 'doc-drift' }`; with
      matching digests — expected: `{ drift: false, reason: null }`

### Phase 3/4 — worker behaviour (mock collector + mock CLI)

- [ ] TC-10 (REQ-11, REQ-12): run one dispatch to completion — expected: the
      mock collector's session state holds a non-null `doc_digest` afterwards,
      **including** when no context-token measurement was extractable
- [ ] TC-11 (REQ-9, the core fix): seed a session row whose `doc_digest`
      disagrees with the track's current documents, then dispatch — expected:
      the CLI is invoked with `--session-id` (not `--resume`), the prompt
      carries `FRESH_SESSION: true`, the full `<track_context>` block is
      injected, and `conversation.md` gained the
      `ℹ️ Track documents changed since this session's last turn` comment
- [ ] TC-12 (REQ-9 negative): seed a session row whose `doc_digest` matches —
      expected: `--resume` is used, `FRESH_SESSION: false`, no drift comment
      appended, and no full context re-injection (track 1086 stays intact)
- [ ] TC-13 (REQ-10): seed a session row with a null `doc_digest` — expected:
      the session resumes normally, and a digest is recorded at the end of that
      run so the next dispatch is protected
- [ ] TC-14 (the AM-1020 replay, and the acceptance criterion that matters):
      dispatch a session, let it write a "blocked" `spec.md`/`plan.md`; then
      out-of-band rewrite both files with real content **and** append a
      `> **system**:` reply so no unanswered human tail exists; re-dispatch the
      same track — expected: the rewritten content is still on disk after the
      run, and the run cold-started
- [ ] TC-15 (REQ-3 in situ): between two dispatches, patch only `**Lane**` and
      `**Progress**` in `index.md` the way `patchTrackAction` does — expected:
      the second dispatch still resumes, proving the fix did not disable
      track 1086
- [ ] TC-16 (REQ-14): make the digest read throw (unreadable track folder) —
      expected: the run proceeds with its normal resume decision and logs a
      warning; the run's outcome is unaffected
- [ ] TC-17 (REQ-15): the same drift scenario in `local-fs` mode — expected: no
      session lookup, no digest work, behaviour byte-identical to today

### Phase 2 — collector endpoints

- [ ] TC-18 (REQ-7): `POST /track/:num/session` with `doc_digest`, then
      `GET` — expected: the same value comes back
- [ ] TC-19 (REQ-7, COALESCE): `POST` with a digest, then `POST` again omitting
      it — expected: the stored digest is preserved, not nulled
- [ ] TC-20 (REQ-7): `GET` for a track with no session row — expected:
      `doc_digest: null`, not `undefined` and not a thrown error
- [ ] TC-21 (REQ-8): the cloud function's two handlers expose the same field —
      asserted the same way `collector-route-parity` checks are written today

## Acceptance Criteria

- [ ] TC-1 … TC-21 all pass, each verified from real command output
- [ ] `track-1086-session-worker.test.mjs`, `track-10047-bounded-resume.test.mjs`,
      `conversation-tail.test.mjs` and `ui/server/tests/track-1086-sessions.test.mjs`
      pass unchanged — no regression to session persistence or the context cap
- [ ] Both migrations applied cleanly against a real `laneconductor` database
- [ ] No leaked `laneconductor.sync.mjs` processes after the suite runs
- [ ] The worker was restarted before any manual verification — a worker started
      before the change tests the old code and yields a false pass
