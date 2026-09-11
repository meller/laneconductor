# Track AM-10090: Resumed session ignores new human input, re-clobbering respecced track files

## Phase 1: Pure digest module

**Problem**: Nothing in the codebase can answer "did this track's authored
documents change since a given point?" without accidentally firing on the
worker's own routine marker patches.
**Solution**: A pure, no-I/O module that hashes exactly the right subset, with
the volatile markers excluded by construction rather than by convention.

- [x] Task 1.1: Create `conductor/services/track-doc-digest.mjs`
    - [x] `STABLE_INDEX_MARKERS` — the REQ-2 allowlist (`Summary`, `Type`,
          `Auto Run`, `Merge Mode`, `Workspace`, `Track Kind`, `Model`)
    - [x] `extractStableIndexMarkers(indexMd)` — returns the allowlisted marker
          lines only, in a deterministic (sorted-by-marker-name) order so
          reordering `index.md` by hand is not a false positive
    - [x] `normaliseForDigest(content)` — CRLF → LF, strip per-line trailing
          whitespace, strip trailing blank lines (REQ-5)
    - [x] `computeTrackDocDigest({ indexMd, specMd, planMd, testMd })` — SHA-256
          hex over a labelled, order-fixed concatenation; a missing file
          (`null`/`undefined`) contributes a distinct `\0absent` sentinel so it
          never collides with an empty file (REQ-5)
    - [x] `hasTrackDocDrift({ storedDigest, currentDigest })` →
          `{ drift: boolean, reason: 'doc-drift'|null }`, returning
          `{ drift: false }` whenever `storedDigest` is null/absent (REQ-10)
- [x] Task 1.2: Header comment in the file explaining the AM-1020 incident, the
      three-mechanism gap, and above all **why REQ-3's exclusions exist** — a
      future maintainer "helpfully" adding `**Lane**` to the digest would
      silently disable track 1086 entirely

**Impact**: One new pure module. No behaviour change yet.

## Phase 2: Schema + collector endpoints

**Problem**: There is nowhere to store what a session left behind.
**Solution**: One nullable column and a round-trip through both collectors.

- [x] Task 2.1: `migrations/<ts>_add_session_doc_digest.sql` (Atlas) —
      `ALTER TABLE "public"."track_sessions" ADD COLUMN "doc_digest" text NULL;`
- [x] Task 2.2: `ui/server/migrations/0NN_session_doc_digest.sql` (runtime,
      next free number) with `ADD COLUMN IF NOT EXISTS`, plus a header comment
      matching `014_session_context_bounds.sql`'s style
- [x] Task 2.3: `ui/server/index.mjs` — `GET /track/:num/session` selects and
      returns `doc_digest` (`?? null`, never coerced — same rule the file's
      existing comment states for `last_context_tokens`)
- [x] Task 2.4: `ui/server/index.mjs` — `POST /track/:num/session` accepts
      `doc_digest` from the body and writes
      `doc_digest = COALESCE($5, track_sessions.doc_digest)` (REQ-7)
- [x] Task 2.5: Mirror Tasks 2.3 and 2.4 into `cloud/functions/index.js`'s
      copies of the same two handlers (REQ-8)
- [x] Task 2.6: `conductor/tests/mock-collector.mjs` — store and return
      `doc_digest` on its in-memory session state, so worker E2E tests can
      assert the full round trip
- [x] Task 2.7: Check `conductor/services/collector-route-parity.mjs` — if it
      enumerates session-endpoint fields, keep it in step

**Impact**: `doc_digest` is storable and readable everywhere. Still nothing
reads it for a decision.

## Phase 3: Worker capture — record what a session left behind

**Problem**: A digest only means something if it is captured at the right
moment, from the right root.
**Solution**: Capture in the exit handler, from the primary checkout.

- [x] Task 3.1: Add `readTrackDocDigest(trackNumber)` to
      `conductor/laneconductor.sync.mjs` — the thin I/O wrapper around Phase 1's
      pure function. Resolves the tracks directory against the **primary
      checkout** via `conductor/services/config-root.mjs` (REQ-13), reuses
      `resolveTrackFolder` and `readIfExists`, and returns `null` on any failure
- [x] Task 3.2: Extend `persistTrackSession(trackNumber, claudeSessionId,
      contextTokens = null, docDigest = null)` to include `doc_digest` in the
      POST body when non-null. Keep every existing call site working unchanged
- [x] Task 3.3: In the exit handler's session block
      (`conductor/laneconductor.sync.mjs` ~line 6313), compute the digest and
      **restructure the guard** so `persistTrackSession` is called when *either*
      the token count or the digest is available — today it is skipped entirely
      when `extractSessionContextTokens()` returns null (REQ-12)
- [x] Task 3.4: Confirm the existing `resumeFailureInvalidated` guard still
      short-circuits the whole block — a session that was just invalidated must
      not be resurrected by a digest POST
- [x] Task 3.5: Wrap everything added here in the block's existing try/catch and
      keep the same warn-and-continue posture (REQ-14)

**Impact**: Every completed run records its documents' fingerprint. Still no
resume decision uses it, so this phase is behaviour-neutral and independently
verifiable.

## Phase 4: Worker decision — refuse to resume a drifted session

**Problem**: The actual bug.
**Solution**: One comparison in `resolveTrackSession()`, reusing the existing
cap escape hatch verbatim.

- [x] Task 4.1: `resolveTrackSession()` destructures `doc_digest` from the
      `GET /track/:num/session` response
- [x] Task 4.2: After the existing `shouldCapSession()` branch, compute the
      current digest via `readTrackDocDigest()` and call `hasTrackDocDrift()`
- [x] Task 4.3: On drift — log a line naming the track, the session id, and both
      digests (truncated); append
      `> **system**: ℹ️ Track documents changed since this session's last turn — starting a fresh session instead of resuming.`
      to `conversation.md`; `await invalidateTrackSession(trackNumber)`; return
      `{ claude_session_id: randomUUID(), isFresh: true }` (REQ-9)
    - [x] Factor the conversation.md append shared with the context-cap branch
          into one small local helper rather than copy-pasting the try/catch
- [x] Task 4.4: Confirm ordering — cap first, then drift. A session that is both
      over its context cap and drifted should report the cap reason, since that
      is the more actionable diagnostic
- [x] Task 4.5: Verify `getIsLocalFs()` still returns early before any of this
      (REQ-15)

**Impact**: The clobber is prevented. A drifted session cold-starts with full
context injection, so it reads the rewritten documents.

## Phase 5: Skill hardening (defence in depth)

**Problem**: Even a correctly resumed session can be handed work that assumes
files it has not re-read.
**Solution**: Make the reconcile-don't-overwrite rule explicit in the skill.

- [x] Task 5.1: In `.claude/skills/laneconductor/SKILL.md`, extend **Protocol:
      Session Continuity** with the REQ-16 rule: on `FRESH_SESSION: false`,
      re-read `spec.md`/`plan.md`/`test.md` before rewriting any of them
      wholesale; on-disk content wins over remembered content
- [x] Task 5.2: Cross-reference this track and the AM-1020 incident in that
      section, so the reasoning survives the next edit
- [x] Task 5.3: State plainly that this is defence in depth behind the worker's
      own digest check — the incident proved a model instruction alone is not
      sufficient, which is exactly why Phase 4 exists

**Impact**: Documentation only. No code paths change.

## Phase 6: Tests

**Problem**: Every acceptance criterion needs a real, executed check.
**Solution**: Three layers, matching this project's documented testing rules.

- [ ] Task 6.1: `conductor/tests/track-doc-digest.test.mjs` (`node --test`) —
      pure-module unit tests, per `test.md` TC-1 … TC-9
- [ ] Task 6.2: `conductor/tests/track-10090-session-doc-drift.test.mjs`
      (`node --test`, mock collector + mock CLI) — the worker-level round trip
      and the AM-1020 replay, per TC-10 … TC-14
- [ ] Task 6.3: `ui/server/tests/track-10090-session-doc-digest.test.mjs`
      (Vitest) — endpoint round-trip and COALESCE preservation, per TC-15 … TC-17
- [ ] Task 6.4: Run the pre-existing session suites and confirm no regressions:
      `track-1086-session-worker.test.mjs`, `track-10047-bounded-resume.test.mjs`,
      `conversation-tail.test.mjs`, `ui/server/tests/track-1086-sessions.test.mjs`
- [ ] Task 6.5: Check `ps aux | grep laneconductor.sync.mjs` after every full
      suite run and kill any leaked worker before trusting results — this repo
      has a documented history of `node --test` and `vitest` leaking real
      workers against the primary checkout

**Impact**: The behaviour is verified rather than asserted.
