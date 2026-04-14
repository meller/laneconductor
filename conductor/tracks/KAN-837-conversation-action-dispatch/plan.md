# Plan: Track 1059 — Conversation Action Dispatch ✅ QUALITY PASSED

## Phase 1: Fix UI Brainstorm Button (no lane change)

**Problem**: Brainstorm button passes `'plan'` as `newLaneStatus`, triggering a full plan re-run.
**Solution**: Remove `newLaneStatus` from Brainstorm click — keep current lane.

- [x] In `TrackDetailPanel.jsx`, change Brainstorm button:
  ```jsx
  // Before:
  onClick={() => sendComment(undefined, 'plan', false, 'brainstorm')}
  // After:
  onClick={() => sendComment(undefined, undefined, false, 'brainstorm')}
  ```
- [x] Verify Replan button still uses `sendComment(undefined, 'plan', false, 'replan')` (intentional)
- [x] Commit: `fix(track-1059): Phase 1 - brainstorm button no longer changes lane`

## Phase 2: Fix Worker brainstorm handler in syncConversation

**Problem**: `is_brainstorm` handler moves track to `plan:queue`, triggering auto-plan instead of a dialogue reply.
**Solution**: Only set `waitingForReply: yes`. Let the auto-launch's `waitingForReply` path handle the response.

- [x] In `laneconductor.sync.mjs` → `syncConversation()`, find the `if (c.is_brainstorm)` block:
  ```javascript
  // Before:
  if (c.is_brainstorm) {
    updates = { lane: Lanes.PLAN, lane_action_status: 'queue' };
  }
  // After:
  if (c.is_brainstorm) {
    // Don't move to plan:queue — just flag for reply, keep current lane
    console.log(`[conv-command] ${trackNumber}: brainstorm flag set (waitingForReply only)`);
    // Only update index.md waitingForReply, no API transition
    const indexPath = join(trackDir, 'index.md');
    if (existsSync(indexPath)) {
      let idx = readFileSync(indexPath, 'utf8');
      idx = updateHeader(idx, 'Waiting for reply', 'yes');
      writeFileSync(indexPath, idx, 'utf8');
    }
    continue; // skip the API postToCollectors for this comment
  }
  ```
- [x] Log message: `[conv-command] NNN: brainstorm flag set (waitingForReply only)`
- [x] Commit: `fix(track-1059): Phase 2 - brainstorm sets waitingForReply only, no lane transition`

## Phase 3: Improve brainstorm customPrompt in auto-launch

**Problem**: The `waitingForReply` customPrompt is too generic — the AI re-scaffolds the full plan instead of focusing on the conversation.
**Solution**: Detect when the unanswered message is a `(brainstorm)` tagged message and use a tighter prompt.

- [x] In `laneconductor.sync.mjs` auto-launch, read `conversation.md` to check if latest human message has `(brainstorm)` tag
- [x] If brainstorm-tagged: use focused prompt:
  ```
  The user has sent a brainstorm message. Read conversation.md carefully.
  Respond ONLY to the specific question or topic raised. Keep your answer focused.
  Then ask exactly ONE clarifying question to deepen the spec further.
  Do NOT re-scaffold spec.md, plan.md, or test.md yet.
  When the human says "go ahead" or "that's enough", THEN run /laneconductor plan NNN.
  Set **Waiting for reply**: yes in index.md after posting your question.
  ```
- [x] If regular `waitingForReply` (not brainstorm): keep existing generic answer prompt
- [x] Commit: `fix(track-1059): Phase 3 - focused brainstorm prompt in auto-launch`
