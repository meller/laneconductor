# Track 10012: inbox functionality fix

## Phase 1: `waiting_for_reply` column + persistence

**Problem**: `index.md`'s `**Waiting for reply**` marker is already parsed by the sync worker and
sent as `waiting_for_reply` in its payloads to `POST /track` and `PATCH /track/:num/action`, but
no `tracks.waiting_for_reply` column exists and neither route reads the field — it's silently
dropped end-to-end (see spec.md root cause 2).
**Solution**: Add the column via a real migration, and wire both routes to persist it.

- [ ] Task 1: Add migration `migrations/<timestamp>_add_waiting_for_reply.sql` — 
      `ALTER TABLE tracks ADD COLUMN waiting_for_reply boolean NOT NULL DEFAULT false;` — and the
      matching `prisma/schema.prisma` field. Apply via the project's Atlas/Prisma workflow.
- [ ] Task 2: `ui/server/index.mjs`'s `POST /track` handler — destructure `waiting_for_reply` from
      `req.body`, include it in the INSERT/ON CONFLICT UPDATE (default `false` on insert if
      omitted, `COALESCE(EXCLUDED.waiting_for_reply, tracks.waiting_for_reply)` semantics is
      wrong here — the marker is authoritative each sync, so unlike the KPI fields this one
      should just overwrite: `waiting_for_reply = EXCLUDED.waiting_for_reply`).
- [ ] Task 3: `ui/server/index.mjs`'s `PATCH /track/:num/action` handler — same pattern as the
      other optional fields (`if (waiting_for_reply !== undefined) { sets.push(...); }`).
- [ ] Task 4: Confirm `conductor/laneconductor.sync.mjs`'s two existing payload-build sites
      (`~line 2008`, `~line 3998`) need no changes — they already compute and send the field;
      this phase only makes the server actually listen.

**Impact**: `tracks.waiting_for_reply` becomes a real, queryable signal instead of a no-op.

## Phase 2: Author validity + Inbox classification

**Problem**: `system`-authored comments are coerced to `human` (spec.md root cause 1), which both
mislabels them in the UI and corrupts `/api/inbox`'s `human_needs_reply` bucket. The Inbox also
has no severity concept, so a `✅` FYI and a real ask look identical (root cause 3).
**Solution**: Accept `system` as a valid author everywhere it's checked, and give `/api/inbox` a
three-bucket classification.

- [ ] Task 1: `ui/server/index.mjs`'s `POST /track/:num/comment` — add `'system'` to
      `VALID_AUTHORS` (line ~2688). Confirm the "human comment → wake worker" branch (line
      ~2705) still only fires for `safeAuthor === 'human'` — `system` comments must never wake a
      worker or requeue an action by themselves.
- [ ] Task 2: Audit the other two `author IN (...)` allowlists in the same file for the same gap:
      the `unreplied_count` subqueries in `/api/inbox` (line ~835) and
      `/api/projects/:id/tracks` (line ~559) currently check `author IN ('claude', 'gemini')` —
      decide deliberately whether `system` `⚠️`/`❌` notices should also count toward
      `unreplied_count` (they should, per REQ-6) and add `'system'` there. The `retries`
      subquery's `author IN ('worker', 'claude', 'gemini')` (line ~574) is a separate concern
      (retry-failure detection) — leave as-is unless a `system` `❌` message also needs to count
      as a failure signal (check whether `quality-gate`/`review` FAIL comments are already
      authored `claude` today — spec.md's grep found real tracks use `claude`, not `system`, for
      these — so this subquery is likely unaffected).
- [ ] Task 3: Rewrite `/api/inbox`'s query (`ui/server/index.mjs:812-856`) to select three
      buckets per REQ-6:
      - `needs_input`: `hr.human_needs_reply OR t.waiting_for_reply OR (lc.author = 'system' AND
        (lc.body LIKE '⚠️%' OR lc.body LIKE '❌%'))`
      - `awaiting_ai`: real unresolved human comment (existing `human_needs_reply`, now correctly
        scoped since `system` no longer masquerades as `human`)
      - `recent_activity`: most-recent comment is `system` and starts with `✅`, and neither of
        the above applies
      Return a `bucket` (or equivalent) field per row so the frontend doesn't reimplement this
      logic.
- [ ] Task 4: Update `/api/projects/:id/tracks` similarly if the Machine Workers / board views
      rely on the same `human_needs_reply`/`unreplied_count` pair for badges — check
      `ui/src/components/WorkersList.jsx` and the Kanban card component for consumers before
      deciding scope here; only touch what's actually rendered from these fields.

**Impact**: Inbox rows carry a correct, three-way classification instead of a binary heuristic
that miscounts `system` comments as `human`.

## Phase 3: UI rendering

**Problem**: `InboxPanel.jsx` and `TrackDetailPanel.jsx` both define `AUTHOR_STYLES` with only
`human`/`claude`/`gemini`; a `system` comment falls back to the `human` style ("You"). The Inbox
panel only renders two sections ("Awaiting your reply" / "Awaiting AI").
**Solution**: Add a `system` author style, and render the third bucket.

- [ ] Task 1: `ui/src/components/InboxPanel.jsx` — add `system: { dot: '<distinct color>',
      label: 'System' }` to `AUTHOR_STYLES`.
- [ ] Task 2: `ui/src/components/TrackDetailPanel.jsx` — same `AUTHOR_STYLES` addition (line
      ~46), so the conversation thread view is consistent with the Inbox.
- [ ] Task 3: `InboxPanel.jsx` — consume the `bucket` field from Phase 2 (or re-derive locally
      from `waiting_for_reply`/`human_needs_reply`/comment-body-emoji if the API keeps returning
      raw fields) and render three sections: "Needs your input" (was "Awaiting your reply" —
      folds in `waiting_for_reply` and `⚠️`/`❌` system notices), "Awaiting AI" (unchanged
      semantics, now correctly scoped), "Recent activity" (new — `✅` system notices, likely
      collapsed/muted styling since no action is required).
- [ ] Task 4: Visually distinguish `✅` vs `⚠️`/`❌` badges in `InboxRow` (e.g. a small
      colored dot or icon derived from the leading emoji of `last_comment_body` when
      `last_comment_author === 'system'`).

**Impact**: A user opening the Inbox can tell at a glance which entries are informational and
which need them, without reading full comment bodies.

## Phase 4: Skill protocol — structured completion comments

**Problem**: Only `review` and `quality-gate` post a completion comment today; `plan` and
dev-track `implement` post nothing on success, so the Inbox has no signal to show for the
majority of action-ends (spec.md root cause 3).
**Solution**: Extend `.claude/skills/laneconductor/SKILL.md`'s command definitions.

- [ ] Task 1: `/laneconductor plan`, step 7 (Transition) — after setting `**Lane**`, append
      `> **system**: ✅ Plan complete — moved to <lane>.` to `conversation.md`. If step 5b's
      fundamentals-conflict guardrail fired during this run, use
      `> **system**: ⚠️ Plan complete with a fundamentals conflict — see conversation above.`
      instead (don't double-post; the guardrail's existing comment plus this one line is enough
      context).
- [ ] Task 2: `/laneconductor implement`, step 5 (dev track: on complete) — after the existing
      `## ✅ COMPLETE` append to `plan.md`, also append
      `> **system**: ✅ Implementation complete — moved to <lane>.` to `conversation.md`.
      Non-dev (supervised) tracks already set `**Waiting for reply**: yes` in step 3 — Phase 1
      of this plan makes that signal actually reach the Inbox, so no additional comment is
      required there.
- [ ] Task 3: `/laneconductor review` and `/laneconductor quality-gate` — confirm their existing
      "Post Review" / "Post Results" comment bodies start with `✅`/`⚠️`/`❌` consistent with
      REQ-5's convention (spec.md's grep of real tracks shows headers like
      `## ✅ REVIEW PASSED`, `## ⚠️ Review Failed` — these already lead with the right emoji
      inside a `##` heading; confirm the emoji is the *first* character of `c.body` after the
      `> **author**: ` prefix, since Phase 2's SQL matches on `lc.body LIKE '✅%'` etc. — adjust
      the match to `LIKE '%✅%'`-style or strip/normalize if headings aren't guaranteed to lead).
- [ ] Task 4: Document the emoji convention once near the top of the "Filesystem-as-API
      Interface" section of SKILL.md so future command additions follow it.

**Impact**: Every documented lane-action completion now leaves an unambiguous, consistently
formatted trace the Inbox can classify.

## Phase 5: Tests

**Problem**: No existing test coverage for `/api/inbox`, `VALID_AUTHORS`, or
`waiting_for_reply` persistence.
**Solution**: Add targeted regression tests alongside the existing Vitest/supertest suite.

- [ ] Task 1: `ui/server/tests/` — new test file covering `POST /track/:num/comment` with
      `author: 'system'` persists as `'system'` (not coerced to `'human'`), and does not trigger
      the wake-worker `lane_action_status = 'queue'` update.
- [ ] Task 2: Same file — `POST /track` and `PATCH /track/:num/action` persist
      `waiting_for_reply` correctly (`true`/`false`/omitted-defaults-to-existing-value semantics
      per Phase 1 Task 2/3).
- [ ] Task 3: Same file — `GET /api/inbox` bucket classification: a `system` `✅` comment lands
      in `recent_activity`, a `system` `⚠️` comment or `waiting_for_reply = true` lands in
      `needs_input`, a real unresolved `human` comment lands in `awaiting_ai`.
- [ ] Task 4: Regression — existing human-comment flows (wake-worker on human comment,
      "Answered" auto-reply detection is_replied flip, Jira comment push branch untouched) still
      pass; run the full `cd ui && npm test` suite, not just the new file.

**Impact**: The three root causes in spec.md are each pinned by a test that fails without the
corresponding fix.
