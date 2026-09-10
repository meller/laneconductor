# Spec

## Problem Statement

The track detail panel's Conversation tab polls `GET
/api/projects/:id/tracks/:num/comments` every 2 seconds
(`ui/src/components/TrackDetailPanel.jsx`). The effect that auto-scrolls to
the bottom depended only on the `comments` state reference:

```js
useEffect(() => {
  if (tab === 'conversation') {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }
}, [comments, tab]);
```

`setComments(data)` from a fresh `fetch().json()` call always produces a new
array reference, even when the returned comments are identical to what was
already shown. That made the effect re-fire — and force-scroll to the
bottom — on every single poll tick regardless of whether any new comment
had actually arrived, fighting a user who had scrolled up to read history.

## Root Cause (confirmed)

Investigated by diffing against `main`: the fix was already present on
`main` (introduced in commit `4e985e9c`, well before this track's implement
run) and is inherited unchanged on this branch. Diffing
`ui/src/components/TrackDetailPanel.jsx` against `main` for this track
shows no changes needed to the fix itself — root cause and fix direction
in this track's original hypothesis (see `index.md`) were both correct,
and had already been acted on in a previous, differently-attributed
commit (a bundled `chore: sync track state...` commit rather than a
`feat(track-1094): ...` one, which is why this track's own files never
reflected it as done).

## Requirements

- REQ-1: The Conversation tab must auto-scroll to the bottom the first
  time it is opened for a track (if comments already exist).
- REQ-2: A poll tick that returns the same comment count MUST NOT trigger
  a scroll — the user's current scroll position must be left alone.
- REQ-3: When a genuinely new comment arrives (comment count increases)
  while the user is already near the bottom of the list, auto-scroll to
  the new bottom.
- REQ-4: When a genuinely new comment arrives while the user has
  deliberately scrolled up (away from the bottom), do NOT force-scroll
  them back down.

## Acceptance Criteria

- [x] Opening the Conversation tab with existing comments scrolls to the
      bottom.
- [x] Two consecutive 2s poll ticks with an unchanged comment count
      produce no additional scroll calls.
- [x] A poll tick that adds a new comment, with the user near the bottom,
      scrolls to the new comment.
- [x] A poll tick that adds a new comment, with the user scrolled up away
      from the bottom, does not move the scroll position.

## Implementation

`ui/src/components/TrackDetailPanel.jsx` — the auto-scroll effect (search
"Track 1094") gates on `comments.length` growing (or the tab having just
been opened) via `prevCommentCountRef`/`prevConversationTabRef`, and
additionally checks `conversationScrollRef.current`'s scroll position
(`scrollHeight - scrollTop - clientHeight < 120`) before auto-scrolling on
new content, so a user who has scrolled up is left alone even when a new
comment does arrive.

This matches the pre-existing, correctly-scoped pattern used for
`logsEndRef`/`last_log_tail` elsewhere in the same file.
