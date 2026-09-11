# Track 1094: Conversation Tab Auto-Scroll Steals User Control

## Phase 1: Investigate — confirm root cause

**Problem**: Scrolling up in a track's Conversation tab kept getting yanked
back to the bottom, uncontrollably.

**Findings**: `git diff main -- ui/src/components/TrackDetailPanel.jsx`
showed **no difference** — the fix hypothesized in `index.md` (gate the
auto-scroll effect on `comments.length` growing rather than the array
reference alone, plus a near-bottom check) was already present on `main`,
introduced by commit `4e985e9c` ("chore: sync track state, worker fixes,
and UI updates across sessions") well before this implement run started.
That commit's diff already carries an explicit `// Track 1094: ...` comment
in the fixed code, so the work was done under this track number previously
but landed via a generically-titled sync commit rather than a
`feat(track-1094): ...` one — which is why this track's own `index.md`/
`plan.md`/`test.md` never got updated to reflect it.

- [x] Reproduced/confirmed via code reading + git diff against `main`
- [x] Correlated with the 2s poll interval (`fetchComments`/`pollRef`)
- [x] Confirmed `comments` reference-vs-content semantics: `setComments(data)`
      from `fetch().json()` always creates a new array reference, which is
      exactly what the fix's comment (line ~531) documents

## Phase 2: Fix

Already implemented on `main` (see Phase 1). The effect
(`ui/src/components/TrackDetailPanel.jsx`, search "Track 1094") now:
- Only scrolls on first opening the tab, or when `comments.length` actually
  grew since the last render (`prevCommentCountRef`).
- On new content (not a fresh tab-open), only scrolls if the user was
  already within 120px of the bottom of `conversationScrollRef` — a
  deliberately-scrolled-up user is left alone.

- [x] No code changes required — verified `git diff main` for this file is
      empty on this branch.

## Phase 3: Tests

No test coverage existed for this behavior prior to this run. Added
`ui/src/components/TrackDetailPanel.conversation-scroll.test.jsx` with 4
cases (TC-1..TC-4 — see `test.md`), using fake timers to drive the 2s poll
cycle and a mocked `Element.prototype.scrollIntoView`.

- [x] Wrote the 4 test cases
- [x] Ran them against the current (fixed) code — all 4 pass
- [x] **Verification step**: temporarily reverted the effect to the
      original naive `useEffect(() => { if (tab === 'conversation')
      bottomRef.current?.scrollIntoView(...) }, [comments, tab])`, re-ran
      the new tests — TC-2 and TC-4 failed exactly as expected (proving
      they exercise the real bug), then restored the fix and re-ran the
      full related suite (`TrackDetailPanel.test.jsx`,
      `TrackDetailPanel.mobile.test.jsx`, and the new file — 15/15 pass).

## ✅ QUALITY PASSED
