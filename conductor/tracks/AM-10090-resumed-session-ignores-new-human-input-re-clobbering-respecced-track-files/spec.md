# Spec: Resumed session must not clobber respecced track files

## Problem Statement

A resumed lane-action session (`FRESH_SESSION: false`) can re-assert a stale,
cached conclusion and overwrite `spec.md` / `plan.md` / `test.md` that a human or
a *different* session rewrote in the meantime. Confirmed live in the `livingwork`
project on track AM-1020: a stale session (id `b744095c…`) was re-dispatched at
least three times in ~10 minutes, each time rewriting the track's documents back
to its own pre-respec "no requirements, blocked" conclusion. Every manual restore
was re-clobbered by the next automatic dispatch. The only mitigation found was
setting `**Auto Run**: no`, which disables the track entirely.

### Root cause (confirmed by reading the code, not hypothesised)

Three mechanisms interact, and the gap sits exactly between them:

1. **Session persistence (track 1086)** — `resolveTrackSession()`
   (`conductor/laneconductor.sync.mjs:6999`) looks up one resumable
   `claude_session_id` per `(track_number, worker_id)` and returns
   `{ isFresh: false }` whenever a row exists.
2. **Context injection is skipped on resume (track 1086, deliberate)** —
   `spawnCli`'s gate at `conductor/laneconductor.sync.mjs:5961` only injects the
   full `<track_context>` block (`index.md`, `spec.md`, `plan.md`, `test.md`,
   `conversation.md`) when `session?.isFresh !== false`. A resumed session
   therefore receives **none of its track's current file contents**.
3. **The only compensating signal is the unanswered human tail (track 10020)** —
   the `else if` branch at `conductor/laneconductor.sync.mjs:5971` injects
   `extractUnansweredHumanTail()` (`conductor/conversation-tail.mjs`), which
   returns the *trailing run of consecutive* `> **human**` blocks — i.e. only
   messages nothing has replied to yet.

In the AM-1020 incident the human's respec message **had already been answered**,
by a different fresh planning session that appended its own
`> **system**: ✅ Plan complete…` comment. That trailing-human run was therefore
empty, `extractUnansweredHumanTail()` returned `null`, and the stale session was
dispatched with *zero* new information. It did exactly what its cached context
said to do.

`resolveTrackSession()`'s only "stop resuming" policy is
`shouldCapSession()` (`conductor/services/session-cap.mjs`), which considers
context-token size and resume count. **Nothing anywhere compares the track's
current documents against what that session last left behind.** That is the
missing check.

## Solution

Give a session a memory of the track documents it left behind, and refuse to
resume it when they no longer match.

At the end of every dispatched run, the worker records a digest of the track's
authored documents alongside the session row (`track_sessions.doc_digest`). At
the start of the next dispatch, `resolveTrackSession()` recomputes that digest
and compares. A mismatch means someone other than this session rewrote the
track's documents, so the session is invalidated and the run cold-starts with
`isFresh: true` — which re-enables the full context injection of step 2 above.

This deliberately reuses the exact escape hatch track 10047 already built for
the context cap: a cap decision returns `{ isFresh: true }` and a new session id.
The cold start is not starting blind; it is switching continuity mechanisms from
`--resume` to full file-based context.

## Requirements

- **REQ-1** — A pure module `conductor/services/track-doc-digest.mjs` computes a
  stable digest from a track's authored documents. No I/O, matching the style of
  `session-cap.mjs`, `workspace-mode.mjs`, and `lane-regression-guard.mjs`.
- **REQ-2** — The digest covers `spec.md`, `plan.md`, and `test.md` in full, plus
  a **restricted subset** of `index.md` markers: `**Summary**`, `**Type**`,
  `**Auto Run**`, `**Merge Mode**`, `**Workspace**`, `**Track Kind**`,
  `**Model**`.
- **REQ-3** — The digest MUST NOT cover the worker-volatile `index.md` markers
  `**Lane**`, `**Lane Status**`, `**Progress**`, `**Phase**`, `**Last Run**`,
  `**Waiting for reply**`, and any `**PR …**` / `**KPI …**` marker. The worker
  patches these itself between runs (`patchTrackAction`, auto-complete, lane
  transitions); including them would make every session cold-start and silently
  delete track 1086's entire benefit. This is the same class of mistake track
  10020 already made once and had to correct — a raw `mtime` comparison that
  fired on the agent's own writes and stuck track 10017 in a queue loop twice.
- **REQ-4** — The digest MUST NOT cover `conversation.md`. Both the worker and
  the fs↔DB comment sync append to it between runs, and genuinely new human
  input there is already handled by track 10020's unanswered-tail injection.
- **REQ-5** — Digest input is normalised before hashing (CRLF → LF, trailing
  whitespace per line stripped, trailing blank lines stripped) so that
  cosmetic rewrites do not force a cold start. A missing file hashes distinctly
  from an empty file.
- **REQ-6** — `track_sessions` gains a nullable `doc_digest TEXT` column, in both
  `migrations/` (Atlas, primary) and `ui/server/migrations/` (runtime).
- **REQ-7** — `GET /track/:num/session` returns `doc_digest` (null when unset).
  `POST /track/:num/session` accepts an optional `doc_digest` and persists it
  with `COALESCE` semantics, so a POST that omits it never erases a stored value
  — exactly the rule `last_context_tokens` already follows.
- **REQ-8** — Both collector implementations are updated:
  `ui/server/index.mjs` and `cloud/functions/index.js`. The mock collector
  (`conductor/tests/mock-collector.mjs`) supports the field so worker E2E tests
  can assert on it.
- **REQ-9** — `resolveTrackSession()` compares stored vs current digest **after**
  `shouldCapSession()`. On mismatch it logs, appends
  `> **system**: ℹ️ Track documents changed since this session's last turn — starting a fresh session instead of resuming.`
  to `conversation.md`, calls `invalidateTrackSession()`, and returns
  `{ claude_session_id: randomUUID(), isFresh: true }` — byte-for-byte the same
  shape as the existing context-cap branch.
- **REQ-10** — A **null/absent** stored digest means "unknown" and MUST NOT cap.
  Existing session rows predate this column; treating unknown as a mismatch
  would cold-start every live session on upgrade. This mirrors
  `shouldCapSession()`'s existing treatment of a null `lastContextTokens`.
  Protection begins from the first run that records a digest.
- **REQ-11** — The digest is captured in the exit handler, **after** the CLI
  process exited, so the session's own writes during its run are what get
  recorded — not what existed at spawn time. Recording at spawn time would make
  every session's own output look like an external change on its next dispatch.
- **REQ-12** — `persistTrackSession()` currently only fires when
  `extractSessionContextTokens()` returned a number
  (`conductor/laneconductor.sync.mjs:6316`). It MUST also fire when only the
  digest is available, or the digest would never be recorded for runs whose
  token count could not be measured.
- **REQ-13** — Digest computation reads from the **primary checkout**, resolved
  via `conductor/services/config-root.mjs`, at both the capture site and the
  compare site. Using two different roots for the two sites would produce a
  permanent false mismatch for every branch-mode track.
- **REQ-14** — All digest work is best-effort. A read failure, hash failure, or
  failed POST must never change a run's outcome, exactly as the surrounding
  context-token measurement already behaves.
- **REQ-15** — `local-fs` mode has no session persistence at all
  (`resolveTrackSession()` returns `null`), so no behaviour there changes.
- **REQ-16** — The skill's **Protocol: Session Continuity** section gains an
  explicit rule: on `FRESH_SESSION: false`, before rewriting `spec.md`,
  `plan.md`, or `test.md` wholesale, re-read them; if what is on disk differs
  from what this session remembers writing, the on-disk version is authoritative
  and the session must reconcile against it rather than overwrite it. This is
  defence in depth behind REQ-9, not a substitute for it — the incident proved
  a model instruction alone is not enough.

## Non-Goals

- No durable per-file version history or undo. The fix prevents the clobber; it
  does not add recovery for clobbers that already happened.
- No change to what a resumed session receives when the digest **does** match.
  The whole point of track 1086 is that the common case stays cheap.
- No change to `extractUnansweredHumanTail()` or track 10020's behaviour.

## Known Limitations (accepted, documented deliberately)

- **Branch-mode worktree writes are invisible to the digest.** A `branch`-mode
  track's `implement` run writes its documents inside `.worktrees/NNN`, not the
  primary checkout, so the primary-checkout digest does not move during that
  run. This fails in the safe direction: it can only cause a *missed* detection
  of the session's own writes, never a false cold start. The `plan` lane — where
  the incident occurred, and where respec actually happens — always runs
  `main`-direct, so it is fully covered.
- **A merge landing worktree document changes on `main` will shift the primary
  digest**, causing one spurious cold start on the next dispatch. That is a
  token cost at the very end of a track's life, and it is safe.

## Acceptance Criteria

- [ ] A worker that resumes a session for a track whose `spec.md` or `plan.md`
      was rewritten by anyone else cold-starts instead, and the rewritten
      content survives the run.
- [ ] Replaying the AM-1020 shape end-to-end — session parks a track as blocked,
      a second party rewrites `spec.md`/`plan.md` and answers the human, the
      first session is re-dispatched — leaves the rewritten documents intact.
- [ ] A worker that resumes a session for a track whose `index.md` had only
      `**Lane**`, `**Lane Status**`, `**Progress**` or `**Phase**` patched by the
      worker still resumes, and does not cold-start.
- [ ] A human flipping `**Auto Run**` to `no` and back is detected as a change
      and forces a cold start.
- [ ] `conversation.md` growing between runs on its own does not force a cold
      start.
- [ ] A session row with no stored digest resumes normally, and records a digest
      at the end of that run.
- [ ] `GET`/`POST /track/:num/session` round-trip `doc_digest` on both the local
      Express collector and the cloud function; a POST omitting it preserves the
      stored value.
- [ ] The full existing worker and server suites pass with no regressions,
      specifically `track-1086-session-worker.test.mjs`,
      `track-10047-bounded-resume.test.mjs`, and `conversation-tail.test.mjs`.

## Data Model Changes

```sql
ALTER TABLE track_sessions ADD COLUMN IF NOT EXISTS doc_digest TEXT NULL;
```

Nullable by design — null means "never recorded", which REQ-10 treats as
unknown and never as a mismatch.
