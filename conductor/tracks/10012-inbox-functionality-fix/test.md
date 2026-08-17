# Tests: Track 10012 — Inbox Functionality Fix

## Test Commands
```bash
# Full server/API test suite (Vitest + supertest, mocked DB)
cd ui && npm test

# Worker E2E (spawns real worker process + mock collector, no real DB)
node --test conductor/tests/local-api-e2e.test.mjs

# New targeted suite for this track (created in Phase 5)
cd ui && npx vitest run server/tests/inbox.test.mjs
```

## Test Cases

### Phase 1: `waiting_for_reply` persistence
- [ ] TC-1: `ALTER TABLE` migration applies cleanly against a fresh schema; `tracks` rows default
      `waiting_for_reply = false`.
- [ ] TC-2: `POST /track` with `waiting_for_reply: true` in the body → row's
      `waiting_for_reply` column reads `true` afterward — expected: previously this was silently
      dropped (no column, field not destructured); now it persists.
- [ ] TC-3: `POST /track` with `waiting_for_reply` omitted on an existing row → existing value is
      preserved (not reset to `false`) — expected: overwrite only on explicit values.
- [ ] TC-4: `PATCH /track/:num/action` with `waiting_for_reply: false` → row updates
      accordingly, independent of any other field in the same request.

### Phase 2: author validity + Inbox classification
- [ ] TC-5: `POST /track/:num/comment` with `author: 'system'` → inserted row's `author` column
      is `'system'` — expected: previously coerced to `'human'` via `VALID_AUTHORS`.
- [ ] TC-6: `POST /track/:num/comment` with `author: 'system'` → `lane_action_status` is
      unchanged (wake-worker branch must remain gated on `safeAuthor === 'human'` only).
- [ ] TC-7: `GET /api/inbox` — a track whose latest comment is `system`-authored and starts with
      `✅` appears in the `recent_activity` bucket, not `needs_input`.
- [ ] TC-8: `GET /api/inbox` — a track whose latest comment is `system`-authored and starts with
      `⚠️` (or `❌`) appears in `needs_input`.
- [ ] TC-9: `GET /api/inbox` — a track with `waiting_for_reply = true` and zero comments still
      appears in `needs_input` — expected: this is the case that was completely invisible
      before Phase 1/2 (no comment-based heuristic could ever surface it).
- [ ] TC-10: `GET /api/inbox` — a track with an unresolved real `human`-authored comment
      (`is_replied = false`) appears in `awaiting_ai` — unchanged behavior, now correctly scoped
      since `system` comments can no longer masquerade as `human` here.
- [ ] TC-11: Regression — a track with an unresolved `claude`-authored comment (no `human`
      comment after it) still appears with a nonzero `unreplied_count` as before.

### Phase 3: UI rendering
- [ ] TC-12: `InboxPanel.jsx` — a `system`-authored row renders with a label other than "You"
      (e.g. "System") and a distinct dot color from `human`/`claude`/`gemini`.
- [ ] TC-13: `TrackDetailPanel.jsx` — same check in the conversation thread view.
- [ ] TC-14: `InboxPanel.jsx` — with one `needs_input`, one `awaiting_ai`, and one
      `recent_activity` item present, the panel renders three visually distinct sections, each
      showing only its own items.
- [ ] TC-15: `InboxPanel.jsx` — `isEmpty` (nothing to show) is now correctly computed across all
      three buckets, not just the original two — a track existing solely in `recent_activity`
      must not cause the panel to render its "No active conversations" empty state.

### Phase 4: skill protocol (manual / integration — run against a real throwaway track)
- [ ] TC-16: Run `/laneconductor plan` end-to-end on a scratch track → `conversation.md` gains a
      `> **system**: ✅ Plan complete — moved to ...` line after the run, and
      `track_comments` has a matching `author = 'system'` row (via TC-5's fix).
- [ ] TC-17: Run `/laneconductor implement` end-to-end on a scratch **dev** track that completes
      successfully → `conversation.md` gains a `> **system**: ✅ Implementation complete — moved
      to ...` line.
- [ ] TC-18: Run `/laneconductor implement` on a scratch **non-dev** (supervised) track →
      `index.md` gets `**Waiting for reply**: yes`, and per Phase 1 the track's DB row shows
      `waiting_for_reply = true` and surfaces in `GET /api/inbox`'s `needs_input` bucket even
      before any comment is posted.
- [ ] TC-19: Trigger a `quality-gate` FAIL on a scratch track → the resulting comment leads with
      `⚠️` or `❌` (per Phase 4 Task 3's normalization) and the track lands in `needs_input`.

### Regression
- [ ] TC-20: Existing comment-flow tests (human comment → wake worker requeue, "Answered"
      detection flipping `is_replied`, Jira comment push branch) all still pass unmodified.

## Acceptance Criteria
- [ ] All unit tests pass (`cd ui && npm test`)
- [ ] New `inbox.test.mjs` suite (TC-1 through TC-11) passes
- [ ] No regressions in existing comment/inbox-adjacent tests (TC-20)
- [ ] TC-16 through TC-19 manually verified against a real scratch track before this track is
      marked done (per the skill's done-gate: a real-product check is required for UI/user-facing
      changes, not just unit tests)
