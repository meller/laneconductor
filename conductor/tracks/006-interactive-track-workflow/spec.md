# Spec: Interactive Track Workflow

## Problem Statement
The current Kanban is purely a display layer — no interactivity, no conversation, no feedback loop between the UI and the AI doing the work. The desired workflow is:

1. Track created → backlog (with md files auto-visible in UI via DB transport)
2. User chats about the plan in the track detail panel → plan.md updates via heartbeat → UI reflects changes in real time
3. When plan looks good → user drags card to in-progress (confirm dialog) → Claude starts `implement`
4. During implement, Claude runs autonomously but captures anything unplanned or needing human input as a comment on the track
5. UI shows these comments in the track conversation panel → user can respond
6. Each response → Claude moves track back to backlog, updates plan.md with new info, re-implements once files look right

## Requirements

### Phase 1: Drag-and-drop lane change + phase step indicator

**Lane transitions:**
- REQ-1: Cards can be dragged between lanes (backlog → in-progress → review → done)
- REQ-2: On drop, a confirm dialog appears: "Move #NNN to [lane]? [Confirm] [Cancel]"
- REQ-3: On confirm, `PATCH /api/projects/:id/tracks/:num` updates `lane_status` in DB
- REQ-4: No external DnD library — use HTML5 drag-and-drop API (keep it lightweight)

**Phase step tracking:**
- REQ-4b: New `phase_step` TEXT column on `tracks` table — values: `planning` | `coding` | `reviewing` | `complete`
- REQ-4c: Heartbeat worker infers `phase_step` from the current phase badge in plan.md
- REQ-4d: `phase_step` exposed in all track API responses

**Phase stepper widget (on TrackCard):**
- REQ-4e: 4-step visual stepper below the progress bar: Planning → Coding → Reviewing → Complete
- REQ-4f: Completed steps = filled green dot, current step = blue pulsing dot, future = grey
- REQ-4g: Only shown when `current_phase` is set (hidden for not-started tracks)

**Action buttons (on TrackCard):**
- REQ-4h: "Review phase" button — shown on in-progress and review tracks
    - Displays confirm dialog: "Run /laneconductor review on #NNN?"
    - On confirm: POSTs a Claude comment "Review requested" and advances `phase_step` to `reviewing`
- REQ-4i: "→ [Next lane]" button — shown when phase_step = `complete` or lane is review/done
    - Next lane: backlog→in-progress, in-progress→review, review→done
    - On confirm: PATCH lane_status, reset phase_step to `planning`

### Phase 2: Track comments
- REQ-5: New `track_comments` table: id, track_id, author (human|claude), body TEXT, created_at
- REQ-6: `GET /api/projects/:id/tracks/:num/comments` — returns comments ordered by created_at
- REQ-7: `POST /api/projects/:id/tracks/:num/comments` — inserts a comment row
- REQ-8: Track detail panel has a "Conversation" tab showing comments threaded oldest→newest
- REQ-9: Text input + send button in Conversation tab for user to post comments (author='human')
- REQ-10: Claude posts comments via skill (`/laneconductor comment [track] [body]`)

### Phase 3: Blocker capture during implement
- REQ-11: `implement` command wraps each phase in a try-capture block
- REQ-12: If Claude encounters something unplanned or needing human input during a phase, it calls `/laneconductor comment [track] "⚠️ [description of blocker]"` before continuing or pausing
- REQ-13: Comments posted by Claude have author='claude' and are visible immediately in UI
- REQ-14: Worker does NOT pause for blockers it can work around — only for things that genuinely require human decision

### Phase 4: Back-to-backlog loop
- REQ-15: If a phase is blocked (Claude cannot proceed), it posts a blocker comment, pulses track to `review` lane (not in-progress), and stops implementing
- REQ-16: User sees track in review lane, opens detail, reads blocker comment, types a response in Conversation tab
- REQ-17: Claude picks up the response (user invokes `/laneconductor implement [NNN]` again), reads all comments, updates plan.md with the resolved info, pulses back to `in-progress`, continues from the blocked phase

## Acceptance Criteria
- [x] Drag a card from backlog → in-progress, confirm dialog appears, card moves on confirm
- [x] Track card shows phase stepper (Planning → Coding → Reviewing → Complete) when a phase is active
- [x] Heartbeat updates `phase_step` when plan.md phase badge changes (⏳ → ✅)
- [x] "Review phase" button on in-progress card → confirm → posts comment + advances to reviewing
- [x] "→ Review" button on in-progress card when phase_step=complete → confirm → moves lane
- [x] Track detail shows Conversation tab with messages from human and Claude
- [x] During implement, unresolvable blocker → comment posted + card moves to review
- [x] User responds in Conversation → re-run implement → continues where it left off
- [x] Worker heartbeat reflects lane changes made via drag-and-drop within 2s

## API Contracts

### `PATCH /api/projects/:id/tracks/:num`
```json
{ "lane_status": "in-progress" }
```
Returns updated track row.

### `GET /api/projects/:id/tracks/:num/comments`
```json
[
  { "id": 1, "author": "human", "body": "Can we skip auth for now?", "created_at": "..." },
  { "id": 2, "author": "claude", "body": "⚠️ Auth middleware depends on session store — need to choose: JWT or cookie session?", "created_at": "..." }
]
```

### `POST /api/projects/:id/tracks/:num/comments`
```json
{ "author": "human", "body": "Use JWT" }
```

### Phase 5: Graphical Workflow UI & Parallel Workers

- REQ-18: Visual workflow editor in the UI, displaying lanes as nodes and transitions (success/failure) as edges/arrows.
- REQ-19: Ability to visually edit transitions, `max_retries`, and `parallel_workers` per lane via the graphical interface.
- REQ-20: Support configuring `parallel_workers` for each lane in `workflow.md`.
- REQ-21: The sync worker/orchestrator respects the `parallel_workers` setting to run multiple tracks in a lane concurrently.
