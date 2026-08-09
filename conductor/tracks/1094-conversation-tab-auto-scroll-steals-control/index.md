# Track 1094: Conversation Tab Auto-Scroll Steals User Control

**Lane**: plan
**Lane Status**: queue
**Progress**: 0%
**Phase**: Reported, not yet investigated
**Type**: dev
**Summary**: Scrolling up in a track's Conversation tab keeps getting yanked back to the bottom, uncontrollably.

## Problem

Reported live: scrolling up to read conversation history in the track
detail panel's Conversation tab keeps getting pulled back down to the
bottom, fighting the user's own scroll — not investigated/root-caused yet
(deliberately deferred, per user request, to get back to track 1086).

## Likely cause (not yet confirmed — needs Phase 1 investigation before fixing)

`ui/src/components/TrackDetailPanel.jsx` polls comments every 2s
(`fetchComments()`, `setInterval(fetchComments, 2000)`) and has:

```js
useEffect(() => {
  if (tab === 'conversation') {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }
}, [comments, tab]);
```

This fires on every `comments` state update — which happens every poll
cycle regardless of whether the content actually changed, since
`setComments(data)` from a fresh `fetch().json()` call always produces a
new array reference. If so, the panel force-scrolls to the bottom every 2
seconds while the tab is open, which would explain exactly this symptom:
a user scrolling up gets yanked back down before they can read anything,
on a ~2s cycle.

**Not yet verified**: whether this fires even when the comment count/content
is unchanged (likely, since the effect dependency is the array reference,
not a length/content comparison), and whether the intended behavior was
"auto-scroll to bottom only when a genuinely new comment arrives" — almost
certainly yes, matching the analogous, correctly-scoped pattern elsewhere in
this file for `logsEndRef`/`last_log_tail`.

## Likely fix direction (not yet implemented)

Only auto-scroll when the comment *count* (or last comment id/timestamp)
actually increased since the last render — not on every poll tick — and/or
only auto-scroll if the user was already scrolled near the bottom (don't
yank them down if they've deliberately scrolled up to read history, even
when a new comment does arrive). Needs real investigation (Phase 1: reproduce,
confirm the poll-interval correlation, check the exact condition) before
committing to a specific fix — this is a hypothesis, not a diagnosis yet.

## Phases
- [ ] Phase 1: Investigate — confirm root cause (reproduce, correlate with poll interval, check `comments` reference-vs-content semantics)
- [ ] Phase 2: Fix — likely "only scroll on genuinely new content" + possibly "only if already near bottom"
- [ ] Phase 3: Tests
