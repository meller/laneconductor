# Spec: Human-needs-reply buries older unreplied human comments forever

## Problem Statement

The `💬 Waiting` badge (`ui/src/components/TrackCard.jsx:385`, fed by
`track.human_needs_reply`) is supposed to mean "a human said something an AI
hasn't addressed." It is derived by a read query that is correct:

```sql
EXISTS(SELECT 1 FROM track_comments
       WHERE track_id = t.id AND author = 'human' AND is_replied = FALSE)
```

The defect is in the **write** side — how a comment ever becomes `is_replied =
TRUE`. `POST /track/:num/comment` (`ui/server/index.mjs:3675-3685`) runs:

```sql
UPDATE track_comments SET is_replied = TRUE
WHERE id = (SELECT id FROM track_comments
            WHERE track_id = $1 AND author = 'human'
            ORDER BY created_at DESC LIMIT 1)
```

gated on the posted body containing `"Answered"`, `"i updated"`, or `"done"`
(case-insensitive substring).

Investigation during planning found this is not one bug but five, three of
which are independently sufficient to permanently strand a human comment.

### D1 — `LIMIT 1` strands every comment but the newest (the reported bug)

The UPDATE targets the single most recent human row, not "every currently
unreplied human comment." Once any newer human row exists, the older one is
unreachable by any future write, forever. Confirmed live on track 10067
(comment id 14487, manually corrected out-of-band).

Crucially the burying rows need not be real human speech. `Moved to <lane>`
(`ui/server/index.mjs:3803`, `:3020`), `Manual retry requested` (`:2098`), and
`Requested fix for identified gaps` (`:2200`) are all inserted with
`author = 'human'` deliberately, because the wake-the-worker and
reset-the-retry-counter logic keys off `author = 'human'`. They are inserted
with `is_replied = TRUE` so they do not trip the badge themselves — but they
are still newer human rows, so they win the `ORDER BY created_at DESC LIMIT 1`
and turn the UPDATE into a permanent no-op.

**Measured**: 592 unreplied human comments exist across the local DB; 567 of
them (96%) sit behind a newer human comment and are therefore unreachable.
They span 8 projects and 151 tracks.

### D2 — the keyword gate is arbitrary and both over- and under-inclusive

`git log -S"i updated"` resolves to `6fd1e94a Initial commit`. There is no
commit, comment, or track that records a rationale for these three words —
scope item 2 is answered: the gate was never a considered design decision
guarding against anything. It is original scaffolding.

It fails in both directions:

- **Under-inclusive**: a substantive AI planning pass that happens not to
  contain those substrings clears nothing. This is what happened on 10067.
- **Over-inclusive**: `body.toLowerCase().includes('done')` is an unanchored
  substring match. Every completion comment the skill's own Completion Comment
  Convention produces (`✅ Plan complete — moved to done:queue.`) contains
  `done`, as does any body mentioning `abandoned`. The gate fires constantly
  for reasons unrelated to answering anything.

### D3 — the UI mints unreplied fake-human comments on every ▶ click

`ui/src/components/TrackDetailPanel.jsx:597` posts
`{ author: 'human', body: body || \`Triggering ${command}...\` }` with no
`is_replied`, so it defaults to `FALSE` and trips the badge immediately and
permanently. This is a live, ongoing source: 90 such rows exist, ranging from
2026-08-14 to 2026-09-06 (today). The call site already passes `no_wake: true`
for run-mode submissions, so `author: 'human'` is not load-bearing there.

A second, now-dead source produced 95 more: before track 10012 extended
`VALID_AUTHORS` to include `'system'` (2026-08-15), every `> **system**:`
comment the worker wrote was silently coerced to `author = 'human'` by
`ui/server/index.mjs:3640`. `Session turn — …` rows dated 2026-08-12 to
2026-08-15 are that legacy artifact. The coercion path itself still exists and
still fires for any author outside `['human', 'system', ...PROVIDER_IDS]` —
`conductor/laneconductor.sync.mjs:6472` posts `author: 'worker'` for the `npx`
CLI, which is not in that list and is therefore coerced to `human` today.

**Measured**: of the 592 unreplied human comments, ~286 are machine-generated
bookkeeping wearing the `human` label, not human speech.

### D4 — three divergent copies of the logic

| File | State |
|------|-------|
| `ui/server/index.mjs:3675` | Live. Has D1 + D2. |
| `conductor/collector/index.mjs:600` | Source for `scripts/merge-apis.js`. Has D1 + D2, plus a stale `VALID_AUTHORS = ['human','claude','gemini']` missing `system` and half of `PROVIDER_IDS`. |
| `cloud/functions/index.js:1188` | Has **no** reply-marking logic at all. In remote-api mode the badge can never clear by any means. |

The read side has the same shape: 12 copies of the `EXISTS(...)` predicate
across `ui/server/index.mjs`, `cloud/functions/index.js`,
`cloud/functions/reader.mjs`, and `cloud/functions/reader.js`. Two of the three
`ui/server/index.mjs` sites (`:787`, `:1063`) omit `AND is_hidden = FALSE`,
which the third (`:1135`) includes — so hiding a comment clears the Inbox
badge but not the Kanban card badge.

### D5 — 567 stranded rows in the existing data

Scope item 3. See Phase 4 for why this needs no data migration under the
chosen design.

## Chosen Design

**Derive `human_needs_reply` at read time from comment ordering. Stop trying
to flip a flag at write time.**

A human comment counts as needing a reply when **no non-human comment exists
after it**. Concretely, the badge predicate becomes:

```sql
EXISTS (
  SELECT 1 FROM track_comments hc
  WHERE hc.track_id = t.id
    AND hc.author = 'human'
    AND hc.is_replied = FALSE
    AND hc.is_hidden = FALSE
    AND NOT EXISTS (
      SELECT 1 FROM track_comments rc
      WHERE rc.track_id = t.id
        AND rc.author <> 'human'
        AND rc.is_hidden = FALSE
        AND (rc.created_at, rc.id) > (hc.created_at, hc.id)
    )
)
```

`is_replied` is **retained**, but its meaning narrows to what the codebase
already uses it for at insert time: a suppression marker meaning *"this row is
bookkeeping, it is not a question, never count it."* It is never UPDATEd again.
The `else if` keyword block at `ui/server/index.mjs:3675` is deleted outright,
along with its two copies.

### Why this over the smaller fix

The minimal fix scope item 1 suggests — keep the UPDATE, drop the keyword gate,
change `LIMIT 1` to "every unreplied row" — does resolve D1. It was rejected
because:

- It stays write-path-dependent. Correctness requires every one of the three
  insert paths (D4) to get it right, and any future path that writes to
  `track_comments` without going through `POST /track/:num/comment` re-opens
  the same class of bug silently. The cloud path is already wrong today.
- It leaves the 567 existing stranded rows needing a separate data migration
  that has to guess which are genuine.
- The read-time derivation is not a novel pattern here. `unreplied_count` in
  `GET /api/inbox` (`ui/server/index.mjs:1123-1133`) already derives the
  mirror-image signal exactly this way, by comparing against
  `MAX(created_at) WHERE author = 'human'`. This change makes the two
  consistent rather than introducing a new idea.

### Accepted trade-off, stated plainly

`author <> 'human'` treats *any* non-human comment as a reply, including
server-internal bookkeeping that is not an answer to anything —
`⚠️ Orphan-reconcile skipped artifact copy…` (`ui/server/index.mjs:2009`),
`⚠️ Dispatch … was unclaimed…`. Such a comment landing after a real human
question will clear the badge without the question being answered.

This is accepted for now because the alternative requires distinguishing
"agent lane-action output" from "server bookkeeping", and both are authored
`system` per the skill's own Completion Comment Convention. There is no column
that carries that distinction. The honest fix is a `kind` discriminator on
`track_comments` separating `speech` from `bookkeeping`, which would also
retire the `author = 'human'` masquerade in D3 — filed as a follow-up, not
attempted here (see Non-Goals).

The trade-off is favourable in the current data: the change takes the number of
tracks showing the badge from 158 to 85, and of the 237 comments that remain
flagged, 161 are genuine human speech.

## Requirements

- **REQ-1**: A human comment with no later non-human comment sets
  `human_needs_reply` true. A human comment with any later non-human comment
  does not.
- **REQ-2**: An older unreplied human comment is cleared by a later AI comment
  **even when newer human comments exist in between**. This is the reported
  bug; it is the load-bearing requirement.
- **REQ-3**: Clearing is not gated on any keyword in the replying comment's
  body. The `Answered` / `i updated` / `done` gate is removed from all three
  copies (`ui/server/index.mjs`, `conductor/collector/index.mjs`,
  `cloud/functions/index.js` — the last has nothing to remove, which is D4).
- **REQ-4**: `track_comments.is_replied` is never UPDATEd after insert. It is
  written only at INSERT time, as a suppression marker.
- **REQ-5**: A comment inserted with `is_replied = TRUE` never sets
  `human_needs_reply`, regardless of what follows it. This preserves the
  existing intent at `:3020`, `:3803`, `:2098`, `:2200`.
- **REQ-6**: All 12 read sites use the identical predicate, including
  `AND is_hidden = FALSE`, which two `ui/server/index.mjs` sites currently
  omit. The predicate is defined once and reused, not copy-pasted a 13th time.
- **REQ-7**: The UI ▶ button stops minting unreplied fake-human rows. When
  `TrackDetailPanel.jsx`'s auto-generated `Triggering <command>...` fallback
  body is used (i.e. the human typed nothing), the comment is posted with
  `is_replied: true`. A body the human actually typed is unaffected.
- **REQ-8**: `conductor/laneconductor.sync.mjs:6472`'s `author: 'worker'` no
  longer silently coerces to `human`. It posts `system`.
- **REQ-9**: Ordering comparisons use `(created_at, id)` tuples, not
  `created_at` alone. Track 10067 has three comments inside a 3-microsecond
  window and the sync worker writes batches within a single millisecond, so
  bare timestamp comparison is not a reliable total order.
- **REQ-10**: No schema migration. `is_replied` and `is_hidden` are unchanged.

## Acceptance Criteria

- [ ] On a track with the exact 10067 shape — human question, then several AI
      comments containing none of the three keywords, then two `Manual retry
      requested` and one `Moved to plan` human rows — the Kanban card shows no
      `💬 Waiting` badge, and `/api/inbox` does not bucket it `awaiting_ai`.
- [ ] On a track whose newest comment is a genuine human question, the card
      **does** show `💬 Waiting`, and the Inbox buckets it `awaiting_ai`.
- [ ] A human question followed only by other human comments still shows the
      badge — no non-human comment means no reply happened.
- [ ] Clicking ▶ on a track with an empty composer does not cause that track to
      show `💬 Waiting`. Verified in the running app, not only in a test.
- [ ] `grep -n "includes('Answered')" ui/server/index.mjs
      conductor/collector/index.mjs cloud/functions/index.js` returns nothing.
- [ ] `grep -n "UPDATE track_comments SET is_replied" -r ui/ conductor/ cloud/`
      returns nothing outside test fixtures.
- [ ] The badge predicate appears in `ui/server/index.mjs` exactly once as a
      shared constant, referenced by all three of its query sites.
- [ ] Running the Kanban board against the real local DB, the number of tracks
      showing `💬 Waiting` drops from 158 to 85, and spot-checking five of the
      85 shows each has a genuine unanswered human comment as its last turn.
- [ ] `cd ui && npm test` passes, including the new regression file.

## Non-Goals

- **A `kind` discriminator on `track_comments`.** The real fix for the
  `author = 'human'` masquerade (D3) and for distinguishing agent output from
  server bookkeeping. Deliberately deferred; this track narrows the blast
  radius (REQ-7, REQ-8) without restructuring the column. A follow-up track
  should be filed.
- **Retiring `is_replied`.** It stays, with a narrowed meaning (REQ-4).
  Dropping it would require re-deriving the suppression intent at four insert
  sites and is not needed to fix this bug.
- **Backfilling the 567 stranded rows.** Unnecessary under the chosen design —
  see Phase 4.
- **De-duplicating the three API copies (D4).** They are brought to parity here
  because the badge is broken in the cloud one, but unifying `ui/server`,
  `conductor/collector`, and `cloud/functions` is its own effort.
- **Fixing `unreplied_count`'s stale author list.** It hardcodes
  `('claude','gemini','system')`, missing `copilot` and `antigravity` from
  `PROVIDER_IDS`. Noted, adjacent, not this track — except that the new
  predicate must not repeat the mistake (REQ-1 uses `author <> 'human'`, which
  is provider-list-proof by construction).
