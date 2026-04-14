# Tests: Track 1059 — Conversation Action Dispatch

## Test Commands
```bash
# E2E test for brainstorm dispatch behaviour
node --test conductor/tests/brainstorm-dispatch.test.mjs

# Verify conversation.md format after brainstorm click simulation
# (manual: click Brainstorm in UI on a track, inspect conversation.md)
```

## Test Cases

### Phase 1: UI Brainstorm Button — No Lane Change

- [ ] TC-1: Clicking Brainstorm does NOT patch lane_status (no PATCH request with `lane_status: 'plan'`)
- [ ] TC-2: Clicking Brainstorm posts comment with `command: 'brainstorm'` in body
- [ ] TC-3: `conversation.md` gets `> **human** (brainstorm): <text>` (not `> **human**: > **system**:...`)
- [ ] TC-4: Track lane_status unchanged after Brainstorm click

### Phase 2: Worker — brainstorm sets waitingForReply only

- [ ] TC-5: After worker processes `(brainstorm)` comment, index.md has `**Waiting for reply**: yes`
- [ ] TC-6: After worker processes `(brainstorm)` comment, Lane does NOT change to 'plan'
- [ ] TC-7: Worker log contains `[conv-command] NNN: brainstorm flag set (waitingForReply only)`
- [ ] TC-8: After worker processes `(replan)` comment, Lane DOES change to 'plan' (existing behaviour preserved)

### Phase 3: Auto-launch — Focused Brainstorm Prompt

- [ ] TC-9: When `waitingForReply = yes` and last message is `(brainstorm)` tagged, auto-launch uses brainstorm-specific prompt
- [ ] TC-10: Brainstorm prompt does NOT instruct "re-scaffold spec.md/plan.md"
- [ ] TC-11: Regular `waitingForReply` (no brainstorm tag) still uses generic answer prompt

### Regression

- [ ] TC-12: Post Note still uses `no_wake: true` — no worker wake
- [ ] TC-13: Regular Send still wakes worker with no command tag
- [ ] TC-14: Replan button still moves to `plan:queue`
- [ ] TC-15: Bug button still calls `/open-bug` endpoint (no change)

## Automated E2E Test: brainstorm-dispatch.test.mjs

Tests to cover in `conductor/tests/brainstorm-dispatch.test.mjs`:
- TC-5 and TC-6: Simulate writing `> **human** (brainstorm): text` to a temp track's `conversation.md`, run worker syncConversation, verify `Waiting for reply: yes` in index.md and lane unchanged
- TC-8: Simulate `(replan)` tagged comment, verify lane moves to plan:queue

## Acceptance Criteria

- [ ] `node --test conductor/tests/brainstorm-dispatch.test.mjs` passes
- [ ] Brainstorm in macrodash UI results in AI responding to the specific question + asking 1 follow-up
- [ ] No regression in Replan, Bug, Note, or Send button behaviour
