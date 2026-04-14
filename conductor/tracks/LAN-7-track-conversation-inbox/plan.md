# Track 015: Track Conversation Inbox



**Files**: `ui/server/index.mjs`

**Problem**: Track list endpoints have no way to surface per-track conversation state (how many AI messages the user hasn't responded to). No dedicated endpoint exists for aggregating inbox-style data.

**Solution**: Add a `unreplied_count` LATERAL subquery to both existing track list queries, and add a new `GET /api/inbox` endpoint.

- [x] Task 1: Add `unreplied_count` LATERAL subquery to `GET /api/projects/:id/tracks`
  - SQL counts AI comments after the last human comment for each track (see spec REQ-1)
  - Add as a second LATERAL join alongside existing `lc` (last comment) join

- [x] Task 2: Add same `unreplied_count` LATERAL subquery to `GET /api/tracks` (all-projects)

- [x] Task 3: Implement `GET /api/inbox` endpoint
  - Optional `?project_id=` query param; filters by project when provided
  - Only returns tracks with at least one comment (`last_comment_at IS NOT NULL`)
  - Ordered by `last_comment_at DESC`
  - Response fields: `track_id`, `track_number`, `title`, `lane_status`, `project_id`, `project_name`, `lane_action_status`, `last_comment_author`, `last_comment_body`, `last_comment_at`, `unreplied_count`
  - Reuse the same LATERAL join pattern as the track list queries

---



**Files**: `ui/src/components/InboxPanel.jsx` (new), `ui/src/App.jsx`

**Problem**: No UI surface to see active conversations across all tracks at a glance.

**Solution**: Create `InboxPanel.jsx` component and wire it into `App.jsx` with a header button and badge.

- [x] Task 1: Create `ui/src/components/InboxPanel.jsx`
  - Props: `projectId` (nullable), `onSelectTrack(projectId, trackNumber)`, `onClose`
  - Fetches `GET /api/inbox?project_id=...` on mount and every 5s
  - Renders two sections using the same `AUTHOR_STYLES` palette as `TrackDetailPanel`:
    1. **Awaiting your reply** (last_comment_author IN 'claude'/'gemini')
    2. **Awaiting AI** (last_comment_author = 'human' + lane_action_status in 'waiting'/'running')
  - Each item row: `#NNN Title`, lane badge, project name (if multi-project), author dot + preview (120 char truncated), time ago, orange badge with unreplied_count
  - Empty state: "No active conversations" in muted italic
  - Clicking a row calls `onSelectTrack(projectId, trackNumber)`
  - Panel renders as fixed right overlay, `max-w-md`, with backdrop (same as TrackDetailPanel pattern)

- [x] Task 2: Update `ui/src/App.jsx`
  - Add `const [inboxOpen, setInboxOpen] = useState(false)`
  - Compute `inboxBadgeCount`: sum of `unreplied_count` from `tracks` array (already in polling data after Phase 1)
  - Add "Inbox" button to header with count badge, left of "+ Track" group
  - Render `<InboxPanel>` when `inboxOpen`, passing `projectId={selectedProjectId}`
  - Wire `onSelectTrack` to a new `handleInboxSelect(projectId, trackNumber)` function that:
    1. Sets `activeTrack({ projectId, trackNumber, initialTab: 'conversation' })`
    2. Calls `setInboxOpen(false)`

---



**Files**: `ui/src/components/TrackDetailPanel.jsx`, `ui/src/App.jsx`

**Problem**: TrackDetailPanel always opens on the Plan tab (or auto-switches to Conversation on first load if comments exist). When opened from the inbox, we need to land directly on the Conversation tab without the auto-switch ambiguity.

**Solution**: Add `initialTab` prop to `TrackDetailPanel`; update `activeTrack` state shape in `App.jsx`.

- [x] Task 1: Add `initialTab` prop to `TrackDetailPanel.jsx`
  - Change `const [tab, setTab] = useState('plan')` → `useState(initialTab ?? 'plan')`
  - When `initialTab` is provided, set `initialTabSet.current = true` on mount so the auto-switch-to-conversation logic is skipped (prevents fighting with the explicit initialTab)
  - No other changes to TrackDetailPanel logic

- [x] Task 2: Update `activeTrack` state in `App.jsx`
  - `activeTrack` shape changes from `{ projectId, trackNumber }` to `{ projectId, trackNumber, initialTab? }`
  - `handleTrackClick(track)` — no change, `initialTab` remains undefined (auto-switch logic in TrackDetailPanel handles it)
  - New `handleInboxSelect(projectId, trackNumber)` — sets `initialTab: 'conversation'`
  - Pass `initialTab={activeTrack?.initialTab}` to `<TrackDetailPanel>`




---
---



**Files**: `ui/server/index.mjs`, `ui/src/components/TrackDetailPanel.jsx`, `conductor/tracks/015-track-conversation-inbox/migrate-is-replied.sql`

**Problem**: AI comments can propose bugs/features, but there's no UI to act on them. The unreplied logic is purely timestamp-based and doesn't align with the latest `SKILL.md` pulse markers.

**Solution**: Update schema, refine unreplied query, and add action buttons to the Conversation tab.

- [x] Task 1: Add `is_replied` column to `track_comments`
  - Create a migration script or run via psql: `ALTER TABLE track_comments ADD COLUMN is_replied BOOLEAN DEFAULT FALSE;`
  - Update `POST /api/projects/:id/tracks/:num/comments` to support initial state.

- [x] Task 2: Update Unreplied Logic in Server
  - Update `LATERAL` subquery to prioritize `is_replied` markers if present.

- [x] Task 3: Implement Conversation Actions UI
  - In `TrackDetailPanel.jsx` (Conversation tab), scan AI messages for proposal patterns (e.g., "Should I open a bug?").
  - Add a sticky toolbar at the bottom of the conversation thread with [Open Bug] and [Open Feature Request] buttons.

- [x] Task 4: Wire UI Buttons to API
  - Map [Open Bug] to a call that triggers `/laneconductor reportaBug` logic.
  - Map [Open Feature Request] to a call that triggers `/laneconductor featureRequest` logic.
  - Ideally, reuse `app.post('/api/projects/:id/tracks/:num/update')` or similar.

- [x] Task 5: Pulse Update
  - Update any `pulse` calls to set `is_replied = TRUE` on the corresponding human comment when an answer is provided.

## ✅ REVIEWED

## ✅ QUALITY PASSED
