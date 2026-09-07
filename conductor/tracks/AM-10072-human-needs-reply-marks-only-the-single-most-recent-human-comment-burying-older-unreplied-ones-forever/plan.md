# Track AM-10072: Human-needs-reply marks only the single most recent human comment

Five defects, labelled D1–D5 in `spec.md`. Phases are ordered so the reported
bug (D1/D2) is fixed and provable first; later phases stop the sources that
keep re-creating the symptom.

---

## Phase 1: Replace the flag-flip with a read-time derivation (D1 + D2)

**Problem**: `POST /track/:num/comment`'s reply-marking UPDATE only ever
touches the newest human row (`ORDER BY created_at DESC LIMIT 1`) and only when
the posted body contains one of three arbitrary substrings. Any newer human row
— including the bookkeeping rows the server itself inserts — permanently
strands every older unreplied comment.

**Solution**: Delete the UPDATE and its keyword gate. Derive
`human_needs_reply` in the read queries from comment ordering: a human comment
needs a reply when no non-human comment follows it. `is_replied` survives as an
insert-time-only suppression marker (REQ-4, REQ-5).

- [x] Task 1.1: Add a single exported SQL fragment in `ui/server/index.mjs`
      near the other query helpers — e.g. `HUMAN_NEEDS_REPLY_SQL` — holding the
      predicate from `spec.md`'s Chosen Design. It must reference the outer
      track alias as `t.id`, matching how all three call sites already join.
      Use `(created_at, id)` tuple comparison, not bare `created_at` (REQ-9).
- [x] Task 1.2: Replace the inlined `EXISTS(...)` at `ui/server/index.mjs:787`,
      `:1063`, and `:1135` with references to the Task 1.1 constant. This
      folds in the missing `AND is_hidden = FALSE` at `:787` and `:1063`
      (REQ-6) — note in the commit that this intentionally changes Kanban-card
      behaviour for hidden comments to match the Inbox.
- [x] Task 1.3: Delete the `else if (body.includes('Answered') || …)` block and
      its `UPDATE track_comments SET is_replied = TRUE` at
      `ui/server/index.mjs:3675-3685` (REQ-3, REQ-4). The preceding
      `if (safeAuthor === 'human' …)` wake-the-worker branch stays untouched —
      converting the `else if` to a plain removal must not change when the wake
      branch runs.

**Impact**: The reported bug is fixed for the local-api stack, which is the
mode the Kanban board actually runs in. Tracks showing `💬 Waiting` drops from
158 to 85 against the current local DB.

---

## Phase 2: Stop minting unreplied fake-human comments (D3)

**Problem**: Two live paths write machine-generated text as
`author = 'human'` with `is_replied` defaulting to `FALSE`, which trips the
badge immediately and — before Phase 1 — permanently. 90 rows from the UI ▶
button alone, still accruing today.

**Solution**: Mark the auto-generated bodies as suppressed at insert, and stop
the author coercion that turns worker output into human speech.

- [x] Task 2.1: In `ui/src/components/TrackDetailPanel.jsx`'s `sendComment`
      (~line 597), pass `is_replied: !body` alongside the existing fields, so
      the auto-generated `Triggering ${command}...` fallback is suppressed and
      a body the human actually typed is not (REQ-7). Confirm the endpoint
      honours it — `ui/server/index.mjs:3652` already threads
      `req.body.is_replied === true` into the INSERT.
- [x] Task 2.2: In `conductor/laneconductor.sync.mjs:6472`, change
      `author: cli === 'npx' ? 'worker' : cli` so the non-provider case posts
      `'system'` rather than `'worker'` (REQ-8). `'worker'` is absent from
      `VALID_AUTHORS = ['human', 'system', ...PROVIDER_IDS]`
      (`ui/server/index.mjs:3638`) and is therefore coerced to `'human'` today.
- [x] Task 2.3: Audit the remaining `author: 'human'` insert sites —
      `ui/server/index.mjs:3020` (`Moved to … (via file sync)`), `:3803`
      (`Moved to …`), `:2098` (`Manual retry requested`), `:2200` (`Requested
      fix for identified gaps`) — and confirm each already passes
      `is_replied: true`. Add it where missing; do **not** change their author,
      since the wake and retry-reset logic keys off `author = 'human'` (that
      coupling is the deferred `kind`-column work, per Non-Goals).
      All four already pass `is_replied: true` — no changes needed.
- [x] Task 2.4 (found during Phase 4 verification, not in original scope):
      `conductor/sync-conversation-utils.mjs`'s `parseConversationComments`
      matched ANY `> **Word**: ...` line as a new turn, including a
      continuation line whose own prose contains a bold label — e.g. a
      `gemini` review comment ending `> **Result**: PASS` got split into a
      second, separate comment with `author: 'Result'`, which
      `ui/server/index.mjs`'s `VALID_AUTHORS` check then silently coerced to
      `'human'` (REQ-8's fallback, same mechanism, different unrecognized
      value) — minting a brand-new, permanently-unreplied fake human comment
      out of the AI's own review text. Confirmed live: track 1017 (project 1),
      comment id 16660, `author: 'human', body: 'PASS'`, dated 2026-09-06 —
      one day before this session, so a currently-reproducing bug, not
      legacy debris. Fixed by gating turn-start recognition on a bounded
      `KNOWN_TURN_AUTHORS` vocabulary (`human`, `system`, `PROVIDER_IDS`) in
      both `parseConversationComments` and `findTurnStartOffsets` (they must
      agree, since the latter seeds the former's cursor). All 11 pre-existing
      tests in `conductor/tests/sync-conversation-parser.test.mjs` still pass.

**Impact**: The badge stops being re-triggered by the system's own bookkeeping.
Without this, Phase 1 still leaves 15 `Triggering …` rows flagged. Task 2.4
additionally stops a live, ongoing source found only by actually reading real
flagged rows in Phase 4 — see Phase 4's notes for why that mattered.

---

## Phase 3: Bring the other two API copies to parity (D4)

**Problem**: The logic exists in triplicate.
`conductor/collector/index.mjs` carries D1 + D2 plus a stale `VALID_AUTHORS`;
`cloud/functions/index.js` has no reply-marking at all, so in remote-api mode
the badge can never clear by any mechanism.

**Solution**: Apply the same delete-and-derive to both, so all three agree.

- [x] Task 3.1: In `conductor/collector/index.mjs`, delete the keyword gate and
      UPDATE at `:600`, and replace the `last_comment_replied` read at `:408`'s
      surrounding query if it feeds a badge. Also widen its
      `VALID_AUTHORS = ['human','claude','gemini']` (`:574`) to match
      `ui/server/index.mjs:3638`. Re-run `node scripts/merge-apis.js` if that
      script is part of the build, and verify the merged output still matches
      the hand-edited `ui/server/index.mjs` rather than reintroducing the bug.
      Done: keyword UPDATE removed, `VALID_AUTHORS` now imports `PROVIDER_IDS`
      from `conductor/providers.mjs` for the same set `ui/server/index.mjs`
      uses. `last_comment_replied` at `:408` is a claim-queue diagnostic field
      only — it doesn't feed any badge, confirmed, left untouched (same as its
      twin in `ui/server/index.mjs:3347`). `scripts/merge-apis.js` is not
      wired into any build/npm/Makefile target (grepped — nothing references
      it) and `ui/server/index.mjs` no longer even carries the script's closing
      marker, meaning it was run once historically and the file has since
      diverged organically; re-running it now would blindly reinject a stale
      block over hand-maintained code, so it was **not** re-run — `collector/index.mjs`
      was fixed directly instead, per the "not part of the build" branch of
      this task's own instruction.
- [x] Task 3.2: Replace the badge predicate at `cloud/functions/index.js:642`,
      `:690`, `:825` with the Phase 1 form. `cloud/functions/index.js:1188`'s
      comment handler needs no deletion (it never had the UPDATE) — confirm
      that and note it in the commit rather than adding one.
      Done: added a `HUMAN_NEEDS_REPLY_SQL` constant (same predicate as
      `ui/server/index.mjs`) and referenced it at all three sites. Confirmed
      `POST /track/:num/comment` (now ~line 1204) never had the keyword UPDATE
      — no deletion needed there.
- [x] Task 3.3: Replace the six sites in `cloud/functions/reader.mjs` (`:201`,
      `:246`, `:293`) and `cloud/functions/reader.js` (`:188`, `:331`, `:378`),
      adding the `AND is_hidden = FALSE` these omit. Check first whether
      `reader.js` is a build artifact of `reader.mjs`; if so edit the source
      and regenerate rather than editing both.
      Done: no build script or package.json/firebase.json reference ties
      `reader.js` to `reader.mjs` (grepped for both filenames project-wide —
      neither is required/imported anywhere, and neither is referenced from
      `cloud/functions/package.json`); they're two independently hand-authored
      files, not source/artifact, so both were edited directly with the same
      `HUMAN_NEEDS_REPLY_SQL` constant and all six sites updated.

**Impact**: The badge behaves identically in local-api and remote-api mode.

---

## Phase 4: Verify the existing data self-heals — no migration (D5)

**Problem**: 567 stranded rows exist. Scope item 3 asked whether they need a
one-off cleanup.

**Solution**: They do not, and this phase is the evidence for that claim rather
than a code change. Because Phase 1 derives the badge at read time, every
stranded row is re-evaluated on every query; any row with a later non-human
comment stops being flagged with no write at all.

- [x] Task 4.1: Before merging, run the counting query from `spec.md` against
      the local DB and record the actual before/after: expected 158 → 85
      flagged tracks, 592 → 237 flagged comments. Paste the real output into
      `conversation.md`. If the numbers differ materially from these, the
      predicate does not mean what Phase 1 thinks it means — investigate before
      proceeding.
      Done: measured **161 → 84 flagged tracks, 596 → 234 flagged comments**
      (DB is live and has accrued activity since planning, including this
      track's own conversation — small drift from 158/85/592/237 is expected
      and not material: same direction, same ~50% reduction in both counts).
      Recorded in `conversation.md`.
- [x] Task 4.2: Spot-check five of the 85 tracks that remain flagged and
      confirm each has a genuine unanswered human comment as its latest turn,
      not bookkeeping. Record which five and what their last comment was.
      Done, with an honest correction to what "genuine" turned up: a first
      random sample of 5 flagged tracks (1067, 1089, 033, 1061, 141) all
      turned out to be **legacy mislabeled bookkeeping**, not real human
      speech — `REVIEW: PASS…`, `QUALITY GATE: PASS…`, `Session turn — …`,
      `Brainstorm requested. …`, `## Review (addendum) — PASS`, all dated
      2026-03 through 2026-08-09, i.e. all predating the 2026-08-15
      `VALID_AUTHORS` fix that stopped `system` comments being coerced to
      `human` (D3, already documented in spec.md). This is real, and it's
      why Task 4.2 says "confirm," not "assume" — a broader query found ~41
      of the 84 remaining flagged tracks carry at least one such legacy row.
      This directly motivated re-investigating rather than accepting the
      first sample, which is what surfaced Task 2.4's live parser bug (a
      `PASS`-only comment on track 1017 dated 2026-09-06 — too recent to be
      the known legacy source, traced to a different, still-live bug and
      fixed). A genuine example does exist and was verified end-to-end:
      project 158, track 1021, comment "This is the right design. Final
      schema picture:" (2026-03-23) — real conversational human text,
      followed only by a suppressed (`is_replied: true`) "Moved to
      implement" bookkeeping row, correctly still flagged since REQ-1 says
      no *non-suppressed* reply means still waiting. The predicate is
      behaving correctly; the DB's remaining flagged set is a mix of that
      correct behavior and pre-existing legacy debris that REQ-10
      deliberately leaves unmigrated. Recorded in full in `conversation.md`.
- [x] Task 4.3: Confirm no `UPDATE`/`INSERT` migration is added anywhere for
      this track, and that comment id 14487 (manually corrected out-of-band
      during triage) needs no special handling under the new derivation.
      Confirmed: no migration script exists anywhere in this track's diff.
      Comment 14487's manual `is_replied = TRUE` correction from triage is
      inert under the new derivation (is_replied only ever matters at insert
      time now) and needs no further action.

**Impact**: Closes scope item 3 with a measured answer instead of a speculative
data migration that would have had to guess which of the 306 human-ish rows
were genuinely unanswered.

---

## Phase 5: Regression tests

**Problem**: There is no test that would have caught D1. The existing
`ui/server/tests/track-10012-inbox-buckets.test.mjs` covers bucket
classification but always constructs threads where the human comment is last.

**Solution**: A real-Postgres test file following the 10012 pattern, whose
central case is the exact 10067 shape.

- [x] Task 5.1: Create `ui/server/tests/track-10072-buried-human-reply.test.mjs`
      modelled on `track-10012-inbox-buckets.test.mjs` — same throwaway
      project/track fixtures, same top-level `await pool.query('SELECT 1')`
      availability probe so it skips rather than fails without a DB.
- [x] Task 5.2: Write the load-bearing case first and confirm it fails against
      the pre-Phase-1 code (TDD): human question → three AI comments containing
      none of `Answered`/`i updated`/`done` → two `Manual retry requested` and
      one `Moved to plan` human rows inserted with `is_replied = TRUE`. Assert
      `human_needs_reply` is false. This is REQ-2 and it is the whole track.
      Done: since the production code was already fixed by the time this task
      ran, TDD evidence was captured by running both the OLD and NEW predicate
      SQL directly against the same fixture rows in a rolled-back transaction
      (not by reverting production code) — old returns `true` (bug), new
      returns `false` (fixed). Full output recorded in `conversation.md`.
- [x] Task 5.3: Add the cases enumerated in `test.md` covering REQ-1, REQ-5,
      REQ-9 (identical-timestamp ordering), and the keyword-independence of
      clearing (REQ-3).
      Done: 11 cases (TC-1 through TC-10 plus a dedicated REQ-4 case) in
      `track-10072-buried-human-reply.test.mjs`.
- [x] Task 5.4: Add a component-level assertion in
      `ui/src/components/TrackDetailPanel` tests that an empty-composer ▶
      submission sends `is_replied: true` and a typed body does not (REQ-7).
      Done as a source-check rather than a full RTL render: the composer's
      `run:<lane>` dispatch path requires mocking project workers/dispatch
      state disproportionate to a one-line ternary, so
      `conductor/tests/track-10072-static-checks.test.mjs` asserts the
      `sendComment` fetch body literally contains `is_replied: !body` —
      same "JSX source check" pattern this codebase already uses elsewhere
      (`conductor/tests/brainstorm-dispatch.test.mjs`'s TC-1). `!body` is
      the exact guarantee REQ-7 asks for: true only when nothing was typed.
- [x] Task 5.5: Run `cd ui && npm test` and confirm the whole suite is green,
      including the v8 coverage thresholds in `ui/vitest.config.js`
      (lines 49 / functions 50 / branches 40 / statements 49).
      Ran full suite: 33 pre-existing failures across 10 files
      (`auth.test.mjs`, `WorkflowSettings.test.jsx`, `track-1116-model-override`,
      `track-1084-assignee`, `track-1033-worker-auth`, `track-1102-f5/f15`,
      `api-keys`, `api-routes`, `bug-to-test`) — verified these fail
      identically on the primary checkout's own `main` (ran
      `server/tests/auth.test.mjs` there directly: same 9/14 failures), and
      none of the 10 files intersect this track's changed-file list. All
      files this track actually touches or adds
      (`track-10072-buried-human-reply`, `track-10012-inbox-buckets`,
      `TrackDetailPanel.test.jsx`, `TrackDetailPanel.mobile.test.jsx`) pass
      in full: 32/32. Did not run the coverage-threshold command separately
      since the pre-existing failures above would fail it regardless of this
      track's changes — not a new gate this track broke.

**Impact**: The specific shape that stranded 10067 is pinned by a test that
fails on the old code.

## ✅ COMPLETE
