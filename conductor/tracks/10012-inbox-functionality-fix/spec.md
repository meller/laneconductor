# Spec: inbox functionality fix

## Problem Statement
When a track action ends (a conversation turn, or the end of plan/implement/review/quality-gate),
the Inbox should reliably tell the human either "done, no action needed" or "come look at this."
Today it doesn't: the Inbox shows ambiguous entries, and real completions are frequently missing
or mislabeled.

## Root Causes (verified against current code)

1. **`system`-authored comments are silently coerced to `human`.** The skill protocol writes
   `> **system**: ...` for `/laneconductor comment`, the `brainstorm` question, the
   fundamentals-conflict guardrail, and KPI-measurement results. The sync worker forwards
   `author: 'system'` to `POST /track/:num/comment` (`ui/server/index.mjs:2683`), but that
   route's `VALID_AUTHORS = ['human', 'claude', 'gemini']` (`ui/server/index.mjs:2688`) has no
   `'system'` entry, so `safeAuthor` falls back to `'human'`. These rows are inserted with
   `is_replied = false` (the caller never sets `is_replied: true` for them), which trips
   `/api/inbox`'s `human_needs_reply` check (`ui/server/index.mjs:844-847`) — a system notice
   or an AI-asked question ends up labeled as an unanswered *human* message ("You" per
   `InboxPanel.jsx`'s `AUTHOR_STYLES`, which also has no `system` entry), inverting who's
   actually waiting on whom.

2. **The `**Waiting for reply**` signal never reaches the Inbox.** `index.md`'s
   `**Waiting for reply**` marker (set by supervised non-dev `implement` on completion, and by
   `brainstorm`) is parsed and sent as `waiting_for_reply` in the sync worker's payloads to both
   `POST /track` (`conductor/laneconductor.sync.mjs:2008`) and `PATCH /track/:num/action`
   (`conductor/laneconductor.sync.mjs:3998`). Neither server route destructures or persists
   `waiting_for_reply` (`ui/server/index.mjs:2083-2092` and `:2260-2262`), and no
   `tracks.waiting_for_reply` column exists in any migration under `migrations/`. The field is
   silently dropped end-to-end — the one explicit "this track needs the human" signal never
   reaches `/api/inbox`.

3. **No structured, consistent completion signal, and no severity in the Inbox's classification.**
   `/api/inbox` (`ui/server/index.mjs:812-856`) classifies purely on two comment heuristics
   (`unreplied_count`, `human_needs_reply`); it has no notion of "success, FYI" vs "needs
   intervention." Only `review` and `quality-gate` currently post a completion comment to
   `conversation.md` (per the skill's "Post Review" / "Post Results" steps); `plan` and
   dev-track `implement` completions post nothing on success, so most action-ends produce zero
   Inbox signal, while the ones that do post (via root cause #1) are frequently mislabeled. This
   combination is what surfaces as "unclear things in inbox."

## Requirements
- REQ-1: `system`-authored comments persist as `author = 'system'` end-to-end (skill file →
  sync worker → collector API → DB) instead of being coerced to `human`.
- REQ-2: The UI renders `system`-authored comments distinctly (own label/color in
  `InboxPanel.jsx` and `TrackDetailPanel.jsx`'s `AUTHOR_STYLES`) — never as "You".
- REQ-3: `tracks.waiting_for_reply` is a real, persisted boolean column, populated from the
  `**Waiting for reply**` index.md marker via the sync payloads that already compute and send it
  (closing the current no-op in both `POST /track` and `PATCH /track/:num/action`).
- REQ-4: `/api/inbox` (and `GET /api/projects/:id/tracks`, which computes the same
  `unreplied_count`/`human_needs_reply` pair) treats `tracks.waiting_for_reply = true` as a
  first-class "needs your input" signal, independent of comment heuristics.
- REQ-5: Every terminal lane-action outcome appends exactly one structured
  `> **system**: <emoji> <summary>` comment to `conversation.md` on completion, using a
  consistent leading-emoji convention: `✅` success / no action needed, `⚠️` needs
  intervention, `❌` failed. `plan` (on success, and on a fundamentals-conflict) and dev-track
  `implement` (on success) gain this step; `review` and `quality-gate` already post a
  completion comment — bring their existing message bodies in line with the same emoji
  convention rather than adding a second post.
- REQ-6: `/api/inbox` classifies each track into: **"Needs your input"** (`human_needs_reply`
  OR `waiting_for_reply` OR most-recent `system` comment starts with `⚠️`/`❌`), **"Awaiting
  AI"** (a real unresolved `human`-authored comment — unchanged, but now correctly restricted
  now that `system` no longer masquerades as `human`), and **"Recent activity"** (most-recent
  comment is a `✅` `system` notice with nothing else pending) — so a plain success notice is
  visibly distinct from an actual ask.
- REQ-7: No regression in existing `human`/`claude`/`gemini` comment flows: wake-worker-on-
  human-comment, "Answered" auto-reply detection, and Jira comment push all keep working
  unchanged.

## Acceptance Criteria
- [ ] A comment written as `> **system**: ...` in `conversation.md` results in a `track_comments`
      row with `author = 'system'` (verified via a direct DB query), not `'human'`.
- [ ] The Inbox panel renders a `system`-authored comment with a distinct, correctly-labeled
      author badge (not "You").
- [ ] After a supervised (non-dev) `implement` sets `**Waiting for reply**: yes` in `index.md`
      and a sync cycle runs, `SELECT waiting_for_reply FROM tracks WHERE track_number = 'NNN'`
      returns `true`, and that track appears in `GET /api/inbox`'s "needs your input" bucket
      even with zero qualifying comments.
- [ ] Completing `/laneconductor plan NNN` end-to-end appends a `> **system**: ✅ ...` comment
      to `conversation.md`, and the track appears in the Inbox under "Recent activity" (not
      "Needs your input").
- [ ] A `quality-gate` FAIL run's completion comment lands the track in "Needs your input" with
      a badge visibly distinguishable from a `✅` success notice.
- [ ] Existing human-comment flows (posting a reply in the UI, wake-worker requeueing, Jira
      comment push, "Answered" auto-reply detection) are unaffected — covered by re-running the
      existing comment/inbox-adjacent tests plus the new regression tests below, all green.
