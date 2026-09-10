# Track 1094: Conversation Tab Auto-Scroll Steals User Control

**Lane**: quality-gate
**Lane Status**: queue
**Progress**: 100%
**Last Run**: claude/claude-sonnet-5 (primary)
**Phase**: Complete
**Type**: dev
**Summary**: Auto-scroll steal was already fixed on main (commit 4e985e9c); this run confirmed root cause, verified the fix, and added regression tests.

## Problem

Reported live: scrolling up to read conversation history in the track
detail panel's Conversation tab keeps getting pulled back down to the
bottom, fighting the user's own scroll.

**Resolved.** Investigation found the fix was already present on `main`
(see `plan.md` Phase 1) — this run verified it, confirmed it actually
guards against the bug (by reverting it locally and watching new tests
fail), and added the missing regression test coverage.

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
- [x] Phase 1: Investigate — confirm root cause (reproduce, correlate with poll interval, check `comments` reference-vs-content semantics)
- [x] Phase 2: Fix — already present on `main`; verified, not re-implemented
- [x] Phase 3: Tests — added `ui/src/components/TrackDetailPanel.conversation-scroll.test.jsx` (4 cases)
