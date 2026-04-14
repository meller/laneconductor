# Spec: Track 1059 — Conversation Action Dispatch

## Problem Statement

Clicking the Brainstorm button from the UI doesn't trigger a brainstorm dialogue. The user types a specific question (e.g. "how should we handle X?"), clicks Brainstorm, and the AI just re-summarizes the plan instead of responding to the question and asking follow-up questions.

### Root Cause (Two Issues)

**Issue 1 — Lane change breaks the reply path:**
The Brainstorm button calls `sendComment(undefined, 'plan', false, 'brainstorm')`. The `'plan'` arg triggers a separate PATCH to change `lane_status → plan`. The worker then sees `lane_action_status: queue` on the plan lane and runs the **full plan auto-action** (re-scaffolding spec/plan/test) rather than responding to the user's message.

**Issue 2 — Worker brainstorm path also moves to plan:queue:**
In `syncConversation()`, when `is_brainstorm = true`, the worker sets `{ lane: PLAN, lane_action_status: 'queue' }`. This compounds the problem — both the UI and the worker independently queue a full plan run.

### What Should Happen

When the user clicks Brainstorm with a specific question, the expected flow is:
1. Message is tagged `(brainstorm)` in `conversation.md`
2. `waitingForReply: yes` is set in `index.md`
3. **Lane does NOT change** — the track stays in its current lane
4. Worker sees `waitingForReply = yes` → runs the current lane's skill with a focused answer+brainstorm prompt
5. AI reads the specific question, responds to it, then asks one clarifying follow-up question
6. Human replies → worker sees `waitingForReply = yes` again → repeat
7. When human says "go ahead" → AI runs `/laneconductor plan NNN` to update spec/plan/test

### How Each Button Should Work

| UI Button | POST body | conversation.md | Lane change | Worker response |
|-----------|-----------|-----------------|-------------|-----------------|
| Send | `{ body, author }` | `> **human**: text` | None | Wake worker, answer question |
| Post Note | `{ body, no_wake: true }` | `> **human** (note): text` | None | No wake |
| Brainstorm | `{ body, command: 'brainstorm' }` | `> **human** (brainstorm): text` | **None** | Set waitingForReply, answer + ask 1 Q |
| Replan | `{ body, command: 'replan' }` | `> **human** (replan): text` | → plan:queue | Run plan skill |
| Bug | via `/open-bug` endpoint | handled separately | None | Creates regression test entry |

## Requirements

- REQ-1: Brainstorm button does NOT change lane — remove `newLaneStatus` arg from Brainstorm click handler
- REQ-2: Worker `syncConversation` for `is_brainstorm`: only set `waitingForReply: yes`, do NOT move to `plan:queue`
- REQ-3: Worker's `waitingForReply` custom prompt for brainstorm case must explicitly instruct: "respond to the specific question, then ask one clarifying follow-up question — do NOT re-scaffold the full plan"
- REQ-4: Replan button keeps the lane→plan:queue behaviour (intentional full replan)
- REQ-5: `sendComment` signature already has `command` param and passes it — no change needed there

## Acceptance Criteria

- [ ] After clicking Brainstorm, `conversation.md` has `> **human** (brainstorm): text`
- [ ] After clicking Brainstorm, track lane does NOT change
- [ ] Worker log shows `[conv-command] NNN: brainstorm flag set (waitingForReply only)`
- [ ] Worker runs the current lane's skill (not auto-plan) with focused brainstorm prompt
- [ ] The AI response is a specific answer + one clarifying question (not a full plan re-scaffold)
- [ ] After Replan click, track moves to plan:queue (existing behavior preserved)
- [ ] Post Note still fires with `no_wake: true`

## Files Changed

- `ui/src/components/TrackDetailPanel.jsx` — remove `'plan'` from Brainstorm button call
- `conductor/laneconductor.sync.mjs` — fix `is_brainstorm` handler + improve brainstorm customPrompt
