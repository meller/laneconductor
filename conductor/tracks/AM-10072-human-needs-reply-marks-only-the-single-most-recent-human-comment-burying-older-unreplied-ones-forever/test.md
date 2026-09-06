# Tests: Track AM-10072 — Human-needs-reply buries older unreplied comments

## Test Commands

```bash
# Full UI + server suite (vitest)
cd ui && npm test

# This track's regression file only
cd ui && npx vitest run server/tests/track-10072-buried-human-reply.test.mjs

# Composer component assertions
cd ui && npx vitest run src/components/TrackDetailPanel

# Coverage gate (thresholds live in ui/vitest.config.js)
cd ui && npm run test:coverage
```

`server/tests/track-10072-buried-human-reply.test.mjs` talks to the real local
Postgres (`localhost:5432/laneconductor`, `postgres`/`postgres`) exactly as
`server/tests/track-10012-inbox-buckets.test.mjs` does, because the behaviour
under test is a SQL predicate and a mocked `pg` cannot evaluate one. It creates
and tears down a throwaway project per run and must never touch real board
data. It skips itself when no DB is reachable.

## Test Cases

### Phase 1 — read-time derivation (D1 + D2)

- [ ] **TC-1 (load-bearing, REQ-2)**: Build the exact track 10067 shape, in
      this order — (a) human comment `"the plan is missing the retry path"`,
      `is_replied = FALSE`; (b) three `system` comments whose bodies contain
      none of `Answered`, `i updated`, `done`; (c) two `human` rows
      `"Manual retry requested (Re-run Implement)"` with `is_replied = TRUE`;
      (d) one `human` row `"Moved to plan (via file sync)"` with
      `is_replied = TRUE`. Expected: `human_needs_reply` is **false**.
      This case must be written before Phase 1's code change and must fail
      against the current code.
- [ ] **TC-2 (REQ-1, positive)**: Human comment is the newest comment on the
      track. Expected: `human_needs_reply` is **true**.
- [ ] **TC-3 (REQ-1, negative)**: Human comment followed by a single `claude`
      comment. Expected: **false**.
- [ ] **TC-4 (REQ-2, minimal form)**: Human comment A (unreplied) → `claude`
      comment → human comment B (unreplied). Expected: **true**, because B has
      nothing after it. Then append a `system` comment. Expected: **false**.
      This proves clearing reaches past intervening human rows in both
      directions.
- [ ] **TC-5 (REQ-3)**: Same as TC-3 but the replying comment's body is
      deliberately keyword-free (`"Looked at the retry path; it is handled in
      the worker."`). Expected: **false**. Asserts clearing is not gated on
      `Answered` / `i updated` / `done`.
- [ ] **TC-6 (REQ-3, inverse)**: A `system` comment whose body contains the
      substring `done` (e.g. `"✅ Plan complete — moved to done:queue."`)
      appended after a human comment. Expected: **false** — same as TC-5, i.e.
      the outcome no longer depends on the word at all.
- [ ] **TC-7 (REQ-5)**: A single `human` comment inserted with
      `is_replied = TRUE` and nothing after it. Expected: **false**. Suppressed
      rows never raise the badge even when they are the newest comment.
- [ ] **TC-8 (REQ-1)**: Human comment followed only by two more `human`
      comments, all `is_replied = FALSE`. Expected: **true**. No non-human
      comment means no reply happened.
- [ ] **TC-9 (REQ-9)**: A human comment and a `system` comment inserted with an
      **identical** `created_at`, the `system` row having the higher `id`.
      Expected: **false** — the tuple comparison `(created_at, id)` must break
      the tie in insert order. Assert the mirrored case (human row higher `id`)
      yields **true**.
- [ ] **TC-10 (REQ-6)**: A human comment with `is_hidden = TRUE` and nothing
      after it. Expected: **false** at all three `ui/server/index.mjs` sites,
      including `:787` and `:1063` which omitted the `is_hidden` filter before
      this track.
- [ ] **TC-11 (REQ-6, consistency)**: For one fixture track, assert the value
      returned by the Kanban tracks query, the second tracks query, and
      `/api/inbox` agree. Guards against the three sites drifting again.
- [ ] **TC-12 (Inbox bucketing)**: The TC-1 fixture is **not** classified
      `awaiting_ai` by `/api/inbox`, and the TC-2 fixture **is**. Confirms the
      badge fix propagates to the Inbox's priority-ordered `CASE`.

### Phase 2 — no more fake-human rows (D3)

- [ ] **TC-13 (REQ-7)**: `TrackDetailPanel`'s `sendComment` with an empty
      composer and a `run:<lane>` submission posts a body of
      `Triggering <lane>...` **and** `is_replied: true`. Assert on the fetch
      payload.
- [ ] **TC-14 (REQ-7, inverse)**: The same call with a human-typed body posts
      that body and does **not** set `is_replied: true`. A real human turn must
      still raise the badge.
- [ ] **TC-15 (REQ-4)**: `POST /track/:num/comment` with
      `{ author: 'claude', body: 'Answered' }` leaves every pre-existing
      `is_replied` value byte-identical. Asserts the UPDATE is gone, not merely
      rewritten.
- [ ] **TC-16 (REQ-8)**: A comment posted with `author: 'worker'` is stored as
      `'system'`, not coerced to `'human'`. Covers the
      `conductor/laneconductor.sync.mjs:6472` path.

### Phase 3 — cross-copy parity (D4)

- [ ] **TC-17**: Static assertion —
      `grep -n "includes('Answered')" ui/server/index.mjs
      conductor/collector/index.mjs cloud/functions/index.js` returns nothing.
- [ ] **TC-18**: Static assertion —
      `grep -rn "UPDATE track_comments SET is_replied" ui/ conductor/ cloud/`
      returns nothing outside test fixtures.
- [ ] **TC-19**: Static assertion — the badge predicate string appears exactly
      once in `ui/server/index.mjs` (as the shared constant) and the three
      query sites reference it by name. Guards REQ-6 against a 13th copy.

### Phase 4 — data self-heal (D5)

- [ ] **TC-20**: Run the before/after counting query from `spec.md` against the
      local DB. Expected: flagged tracks 158 → 85, flagged comments 592 → 237.
      This is a recorded measurement, not an automated assertion — the numbers
      drift as the board is used, so record the values observed on the day and
      investigate only a *material* divergence.

### Real-product verification (not automatable)

- [ ] **TC-21**: Restart the API server (`lc api stop && lc api start` — it
      does not hot-reload, and verifying against the old process is a false
      pass), load the Kanban board, and confirm track 10067's card shows no
      `💬 Waiting` badge. Screenshot it.
- [ ] **TC-22**: With an empty composer, click ▶ on a track that currently has
      no badge. Confirm the card still shows no `💬 Waiting` afterwards.
      Screenshot it. This is the user-visible statement of REQ-7.
- [ ] **TC-23**: Type a real comment on that same track and confirm the badge
      **does** appear. Confirms the fix did not simply disable the feature.

## Acceptance Criteria

- [ ] TC-1 fails against pre-Phase-1 code and passes after (TDD evidence
      recorded in `conversation.md`).
- [ ] All of TC-1 … TC-19 pass.
- [ ] `cd ui && npm test` is green, with `ui/vitest.config.js`'s coverage
      thresholds (lines 49 / functions 50 / branches 40 / statements 49) still
      met.
- [ ] TC-21, TC-22, TC-23 performed against a restarted server with the
      observed result recorded, not inferred from the diff.
- [ ] No schema migration was added.
- [ ] No regression in `ui/server/tests/track-10012-inbox-buckets.test.mjs` —
      that file's bucket priorities depend on `human_needs_reply` and is the
      closest existing coverage.
