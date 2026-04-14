# Spec: Track Conversation Inbox

## Problem Statement
AI interactions happen across multiple tracks. Users lose track of which AI is waiting for them (last comment from Claude/Gemini) or which AI is still processing a human request. There is no central place to triage conversation state across all tracks.

## Data Model Context
The `track_comments` table stores all messages with columns: `id`, `track_id`, `author` ('human' | 'claude' | 'gemini'), `body`, `created_at`.

Existing track list endpoints (`GET /api/tracks`, `GET /api/projects/:id/tracks`) already return the last comment's `body`, `author`, and `created_at` via a LATERAL join, plus `lane_action_status` ('waiting' | 'running' | 'done'). We extend these with an `unreplied_count` derived field.

**"Unreplied" definition**: the count of AI messages posted _after_ the most recent human comment. If no human comment exists, all AI messages in the thread count as unreplied. An `unreplied_count > 0` means the user has unread AI responses to act on.

## Requirements

### REQ-1: unreplied_count on Track List Endpoints
Both `GET /api/tracks` and `GET /api/projects/:id/tracks` must include `unreplied_count` — a LATERAL subquery counting AI comments after the last human comment for each track.

```sql
-- unreplied_count LATERAL
SELECT COUNT(*) FROM track_comments uc
WHERE uc.track_id = t.id
  AND uc.author IN ('claude', 'gemini')
  AND uc.created_at > COALESCE(
    (SELECT MAX(created_at) FROM track_comments
     WHERE track_id = t.id AND author = 'human'),
    '1970-01-01'
  )
```

### REQ-2: Dedicated GET /api/inbox Endpoint
Returns only tracks that have at least one comment, ordered by `last_comment_at DESC`. Supports optional `?project_id=` query param for filtering.

Response fields per item:
- `track_id`, `track_number`, `title`, `lane_status`
- `project_id`, `project_name`
- `lane_action_status`
- `last_comment_author`, `last_comment_body` (full), `last_comment_at`
- `unreplied_count`

### REQ-3: Inbox Panel UI (InboxPanel.jsx)
A new `InboxPanel` component that polls `GET /api/inbox` every 5 seconds. Renders two sections:
1. **Awaiting your reply** — tracks where `last_comment_author IN ('claude', 'gemini')`, sorted by `last_comment_at DESC`
2. **Awaiting AI** — tracks where `last_comment_author = 'human'` and `lane_action_status IN ('waiting', 'running')`

Each row shows:
- Track number + title (truncated)
- Lane status badge (color-coded per existing LANE_BADGE palette)
- Project name (visible in all-projects view)
- Author dot (orange = Claude, blue = Gemini, gray = Human)
- Last message body preview (truncated to ~120 chars)
- Relative time ("2m ago")
- Orange badge with `unreplied_count` when > 0

Empty state: "No active conversations" message with muted styling.

### REQ-4: Header Inbox Button + Badge
Add an "Inbox" button to the App header (left of the "+ Track" button group). Shows a count badge:
- Orange filled badge when `totalUnreplied > 0` (sum of `unreplied_count` across visible tracks)
- Muted gray when 0 unread

Clicking toggles the InboxPanel. InboxPanel renders as a slide-over overlay (same right-panel pattern as TrackDetailPanel but narrower, ~420px max-width).

### REQ-5: Deep Link to Conversation Tab
`TrackDetailPanel` accepts an optional `initialTab` prop. When provided, it overrides the default tab ('plan') on first render. The existing auto-switch-to-conversation logic (on first load if comments exist) remains intact but is bypassed when `initialTab` is explicitly set.

When user clicks an inbox item, open `TrackDetailPanel` with `initialTab='conversation'` and close the InboxPanel.

### REQ-6: Project Scoping
- InboxPanel passes `project_id` to `GET /api/inbox` when a project is selected in the main view.
- When no project is selected (all-projects), inbox shows all projects' active conversations with the project name label visible.
- No additional filter controls needed inside the InboxPanel itself (project selector in header drives it).

### REQ-7: Conversation Actions Proposal Detection
The UI and Skill must identify "action proposals" in AI comments. 
- A proposal is detected when an AI comment contains specific phrasing like "Should I open a bug?" or "I can create a feature request for this...".
- Specifically, detect if the AI is suggesting a `/laneconductor reportaBug` or `/laneconductor featureRequest` call.

### REQ-8: Conversation Toolbar & Action Buttons
When a proposal is detected, or based on the latest AI message, show a "Conversation Toolbar" in the `TrackDetailPanel` (Conversation tab):
- **Buttons**: [Open Bug], [Open Feature Request].
- Clicking these buttons triggers a call to the server to act on the proposal.
- Implementation: Use the `app.post('/api/projects/:id/tracks/:num/update')` endpoint (if appropriate) or a new endpoint that invokes the corresponding skill command.

### REQ-9: Replied Status (Alignment with SKILL.md)
To align with the latest `pulse` command logic in `SKILL.md`, add an `is_replied` boolean column to `track_comments`.
- **Definition**: A human comment is "replied" to when an AI pulse summary contains "Answered" or when an AI manually marks it.
- **Inbox Impact**: Tracks "Awaiting AI" should prioritize those where the last human comment has `is_replied = FALSE`.

## Acceptance Criteria
- [ ] `GET /api/tracks` includes `unreplied_count`
- [ ] `GET /api/projects/:id/tracks` includes `unreplied_count`
- [ ] `GET /api/inbox` returns conversation-active tracks with `unreplied_count`, filtered by `?project_id` when provided
- [ ] InboxPanel shows correct "Awaiting your reply" and "Awaiting AI" sections
- [ ] Clicking an inbox item opens TrackDetailPanel directly on the Conversation tab
- [ ] InboxPanel closes when TrackDetailPanel opens
- [ ] Header badge shows total `unreplied_count` and turns orange when > 0
- [ ] Badge is driven by data already loaded in `usePolling` (no extra fetch needed for badge count)
- [ ] Empty state shown when no active conversations
- [ ] Conversation tab shows "Open Bug" / "Open Feature" buttons when AI proposes them
- [ ] Clicking "Open Bug" invokes `/laneconductor reportaBug` logic via API
- [ ] Schema updated with `is_replied` column on `track_comments`

## Out of Scope
- Browser push notifications
- Email notifications
- AI-to-AI message threads

