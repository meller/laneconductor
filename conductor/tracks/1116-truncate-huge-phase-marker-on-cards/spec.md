# Spec: Truncate huge Phase marker on Kanban cards

## Problem Statement

Lane-view Kanban cards render `**Phase**` marker text with no length cap,
either in the UI or at the point the sync worker parses it into the DB.
An agent writing a full session recap into `**Phase**` (instead of a short
label) inflates card height in the list view.

## Requirements
- REQ-1: The lane-view card (`TrackCard.jsx`) must render `current_phase`
  on a single line, truncated with an ellipsis, regardless of source length.
- REQ-2: The full phase text must remain accessible from the list view
  (hover tooltip) without needing to open the track.
- REQ-3: The track detail/zoom-in view must continue to show the phase
  text in full, untruncated.
- REQ-4: The sync worker must cap `**Phase**` marker length at the source,
  consistent with the existing cap on `**Summary**`.

## Acceptance Criteria
- [x] Lane-view card's phase line never wraps past one line, however long
      the source `**Phase**` marker is
- [x] Full phase text is present in a `title` attribute for hover
- [x] Track detail panel still renders the untruncated phase text
- [x] `parseCurrentPhaseMarker()` truncates via the same `truncateSummary()`
      helper used for Summary (200 chars, word-boundary, ellipsis)
