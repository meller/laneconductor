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

- [ ] Task 1.1: Add a single exported SQL fragment in `ui/server/index.mjs`
      near the other query helpers — e.g. `HUMAN_NEEDS_REPLY_SQL` — holding the
      predicate from `spec.md`'s Chosen Design. It must reference the outer
      track alias as `t.id`, matching how all three call sites already join.
      Use `(created_at, id)` tuple comparison, not bare `created_at` (REQ-9).
- [ ] Task 1.2: Replace the inlined `EXISTS(...)` at `ui/server/index.mjs:787`,
      `:1063`, and `:1135` with references to the Task 1.1 constant. This
      folds in the missing `AND is_hidden = FALSE` at `:787` and `:1063`
      (REQ-6) — note in the commit that this intentionally changes Kanban-card
      behaviour for hidden comments to match the Inbox.
- [ ] Task 1.3: Delete the `else if (body.includes('Answered') || …)` block and
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

- [ ] Task 2.1: In `ui/src/components/TrackDetailPanel.jsx`'s `sendComment`
      (~line 597), pass `is_replied: !body` alongside the existing fields, so
      the auto-generated `Triggering ${command}...` fallback is suppressed and
      a body the human actually typed is not (REQ-7). Confirm the endpoint
      honours it — `ui/server/index.mjs:3652` already threads
      `req.body.is_replied === true` into the INSERT.
- [ ] Task 2.2: In `conductor/laneconductor.sync.mjs:6472`, change
      `author: cli === 'npx' ? 'worker' : cli` so the non-provider case posts
      `'system'` rather than `'worker'` (REQ-8). `'worker'` is absent from
      `VALID_AUTHORS = ['human', 'system', ...PROVIDER_IDS]`
      (`ui/server/index.mjs:3638`) and is therefore coerced to `'human'` today.
- [ ] Task 2.3: Audit the remaining `author: 'human'` insert sites —
      `ui/server/index.mjs:3020` (`Moved to … (via file sync)`), `:3803`
      (`Moved to …`), `:2098` (`Manual retry requested`), `:2200` (`Requested
      fix for identified gaps`) — and confirm each already passes
      `is_replied: true`. Add it where missing; do **not** change their author,
      since the wake and retry-reset logic keys off `author = 'human'` (that
      coupling is the deferred `kind`-column work, per Non-Goals).

**Impact**: The badge stops being re-triggered by the system's own bookkeeping.
Without this, Phase 1 still leaves 15 `Triggering …` rows flagged.

---

## Phase 3: Bring the other two API copies to parity (D4)

**Problem**: The logic exists in triplicate.
`conductor/collector/index.mjs` carries D1 + D2 plus a stale `VALID_AUTHORS`;
`cloud/functions/index.js` has no reply-marking at all, so in remote-api mode
the badge can never clear by any mechanism.

**Solution**: Apply the same delete-and-derive to both, so all three agree.

- [ ] Task 3.1: In `conductor/collector/index.mjs`, delete the keyword gate and
      UPDATE at `:600`, and replace the `last_comment_replied` read at `:408`'s
      surrounding query if it feeds a badge. Also widen its
      `VALID_AUTHORS = ['human','claude','gemini']` (`:574`) to match
      `ui/server/index.mjs:3638`. Re-run `node scripts/merge-apis.js` if that
      script is part of the build, and verify the merged output still matches
      the hand-edited `ui/server/index.mjs` rather than reintroducing the bug.
- [ ] Task 3.2: Replace the badge predicate at `cloud/functions/index.js:642`,
      `:690`, `:825` with the Phase 1 form. `cloud/functions/index.js:1188`'s
      comment handler needs no deletion (it never had the UPDATE) — confirm
      that and note it in the commit rather than adding one.
- [ ] Task 3.3: Replace the six sites in `cloud/functions/reader.mjs` (`:201`,
      `:246`, `:293`) and `cloud/functions/reader.js` (`:188`, `:331`, `:378`),
      adding the `AND is_hidden = FALSE` these omit. Check first whether
      `reader.js` is a build artifact of `reader.mjs`; if so edit the source
      and regenerate rather than editing both.

**Impact**: The badge behaves identically in local-api and remote-api mode.

---

## Phase 4: Verify the existing data self-heals — no migration (D5)

**Problem**: 567 stranded rows exist. Scope item 3 asked whether they need a
one-off cleanup.

**Solution**: They do not, and this phase is the evidence for that claim rather
than a code change. Because Phase 1 derives the badge at read time, every
stranded row is re-evaluated on every query; any row with a later non-human
comment stops being flagged with no write at all.

- [ ] Task 4.1: Before merging, run the counting query from `spec.md` against
      the local DB and record the actual before/after: expected 158 → 85
      flagged tracks, 592 → 237 flagged comments. Paste the real output into
      `conversation.md`. If the numbers differ materially from these, the
      predicate does not mean what Phase 1 thinks it means — investigate before
      proceeding.
- [ ] Task 4.2: Spot-check five of the 85 tracks that remain flagged and
      confirm each has a genuine unanswered human comment as its latest turn,
      not bookkeeping. Record which five and what their last comment was.
- [ ] Task 4.3: Confirm no `UPDATE`/`INSERT` migration is added anywhere for
      this track, and that comment id 14487 (manually corrected out-of-band
      during triage) needs no special handling under the new derivation.

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

- [ ] Task 5.1: Create `ui/server/tests/track-10072-buried-human-reply.test.mjs`
      modelled on `track-10012-inbox-buckets.test.mjs` — same throwaway
      project/track fixtures, same top-level `await pool.query('SELECT 1')`
      availability probe so it skips rather than fails without a DB.
- [ ] Task 5.2: Write the load-bearing case first and confirm it fails against
      the pre-Phase-1 code (TDD): human question → three AI comments containing
      none of `Answered`/`i updated`/`done` → two `Manual retry requested` and
      one `Moved to plan` human rows inserted with `is_replied = TRUE`. Assert
      `human_needs_reply` is false. This is REQ-2 and it is the whole track.
- [ ] Task 5.3: Add the cases enumerated in `test.md` covering REQ-1, REQ-5,
      REQ-9 (identical-timestamp ordering), and the keyword-independence of
      clearing (REQ-3).
- [ ] Task 5.4: Add a component-level assertion in
      `ui/src/components/TrackDetailPanel` tests that an empty-composer ▶
      submission sends `is_replied: true` and a typed body does not (REQ-7).
- [ ] Task 5.5: Run `cd ui && npm test` and confirm the whole suite is green,
      including the v8 coverage thresholds in `ui/vitest.config.js`
      (lines 49 / functions 50 / branches 40 / statements 49).

**Impact**: The specific shape that stranded 10067 is pinned by a test that
fails on the old code.
