# Track AM-10072: Human-needs-reply marks only the single most recent human comment, burying older unreplied ones forever

**Lane**: plan
**Lane Status**: running
**Progress**: 0%
**Phase**: New
**Type**: dev
**Workspace**: branch
**Merge Mode**: direct
**Auto Run**: yes
**Author**: AM
**Created By**: 2565050+meller@users.noreply.github.com
**Problem**: The `💬 Waiting` badge on a track card (`TrackCard.jsx:385`, `track.human_needs_reply`) is driven by a real DB query (`ui/server/index.mjs`, multiple call sites e.g. line 787): `EXISTS(SELECT 1 FROM track_comments WHERE track_id = t.id AND author = 'human' AND is_replied = FALSE)`. Any unreplied human comment anywhere in the thread trips it — correct so far.

The bug is in how a comment ever gets marked replied. `POST /track/:num/comment` (`ui/server/index.mjs:3675`) only flips `is_replied` when the newly-posted comment's own body contains the literal substring "Answered", "i updated", or "done" (case-insensitive) — a narrow keyword match, not "did an AI actually respond to this." And even when that match fires, the UPDATE it runs is:
```sql
UPDATE track_comments SET is_replied = TRUE
WHERE id = (
  SELECT id FROM track_comments WHERE track_id = $1 AND author = 'human'
  ORDER BY created_at DESC LIMIT 1
)
```
This only ever touches the **single most recent** human comment row — never "every currently-unreplied human comment." Confirmed live on track 10067: a real human comment landed, several genuinely-substantive AI planning passes followed (none of which happened to use one of the three trigger words, so it was never cleared), and then three more human comments landed afterward (two "Manual retry requested" system-generated notes, one "Moved to plan"). Once those newer human rows existed, the original comment was no longer "the most recent human comment," so it became permanently unclearable — no future AI reply, however substantive, could ever reach it again. Manually verified and fixed for this one row via a direct `UPDATE track_comments SET is_replied = TRUE WHERE id = 14487` — this track is about the actual mechanism, not this one instance.

**Scope for planning**: (1) decide what should actually count as "an AI/system comment counts as a reply to prior unreplied human comments" — likely: any `claude`/`gemini`/`system`-authored comment marks **every** currently-`is_replied = FALSE` human comment on that track as replied, not just the newest one, and not gated on specific keywords in the body; (2) audit whether the three keyword triggers ("Answered", "i updated", "done") were intentionally narrow for a reason (e.g. avoiding false-clearing on unrelated routine sync noise) before just removing the gate — check git blame/history on that block; (3) check for other tracks currently carrying the same stuck-forever shape (an old unreplied human comment behind newer human comments) as a one-off data cleanup, separate from the code fix; (4) add a regression test asserting an older unreplied human comment gets cleared by a later AI reply even when newer human comments exist in between.
**Summary**: Confirmed live on track 10067: an unreplied human comment from earlier got permanently buried once newer human comments (retries, lane moves) landed, since the reply-detection UPDATE only ever…
