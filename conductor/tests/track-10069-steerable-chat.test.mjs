// Track AM-10069 Phase 4c: Steerable Track Chat
// Tests verifying prompt instructions, guardrails, and exit handler git staging
// for in-conversation design doc updates and lane transitions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getConversationRunWriteScope } from '../services/conversation-run-write-scope.mjs';

const SYNC_SRC = readFileSync(new URL('../laneconductor.sync.mjs', import.meta.url), 'utf8');

test('TC-1: customPrompt for numbered track conversation reply instructs updating design documents', () => {
  assert.ok(
    SYNC_SRC.includes("Update the track's design documents in conductor/tracks/${dir}/ (spec.md, plan.md, test.md, and index.md summary/phase)"),
    'conversation reply customPrompt must instruct updating spec.md, plan.md, test.md, and index.md summary/phase when changes are requested'
  );
});

test('TC-2: customPrompt instructs transitioning lane via /laneconductor move when implementation/replanning requested', () => {
  assert.ok(
    SYNC_SRC.includes('/laneconductor move ${track_number} implement:queue (or plan:queue)'),
    'conversation reply customPrompt must instruct using /laneconductor move ${track_number} implement:queue (or plan:queue) for requested work'
  );
});

test('TC-3: customPrompt enforces guardrail against direct application source code edits in chat turn', () => {
  assert.ok(
    SYNC_SRC.includes('GUARDRAIL: Do NOT write or edit application source code directly during this conversation turn'),
    'conversation reply customPrompt must enforce the lock-free primary checkout source code guardrail'
  );
  assert.ok(
    SYNC_SRC.includes('All code implementation must be performed via /laneconductor move'),
    'conversation reply customPrompt must instruct that code implementation happens via /laneconductor move'
  );
});

test('TC-4: customPrompt for manager pseudo-track is distinct and forbids lane transitions', () => {
  assert.ok(
    SYNC_SRC.includes("track_number === 'manager'"),
    'sync.mjs should distinguish manager pseudo-track from numbered tracks in customPrompt'
  );
  assert.ok(
    SYNC_SRC.includes('The manager track is a supervisory pseudo-track; do NOT change **Lane**, **Lane Status**, or move this track'),
    'manager prompt must note supervisory role and forbid lane changes'
  );
});

test('TC-5: exit handler stages relTrackDir and commits doc updates for conversation runs', () => {
  const exitCommitBlock = SYNC_SRC.slice(SYNC_SRC.indexOf('// Commit changes to git (in worktree context'));
  assert.ok(
    exitCommitBlock.includes('if (isConversationRun)'),
    'exit handler must special-case conversation runs for git commit'
  );
  assert.ok(
    exitCommitBlock.includes('execSync(`git add "${relTrackDir}"`'),
    'exit handler must stage the entire track directory (relTrackDir) for conversation runs'
  );
  assert.ok(
    exitCommitBlock.includes('git diff --cached --quiet'),
    'exit handler must check for staged changes before committing'
  );
  assert.ok(
    exitCommitBlock.includes('conversation reply and track updates'),
    'exit handler commit message must reflect conversation reply and track updates'
  );
});

test('TC-6: writeScope preserves canWriteLane: false so exit handler preserves explicit /laneconductor move', () => {
  const scope = getConversationRunWriteScope({ isConversationRun: true });
  assert.equal(scope.canWriteLane, false, 'writeScope must not allow exit handler to overwrite Lane');
  assert.equal(scope.canWriteLaneStatus, false, 'writeScope must not allow exit handler to overwrite Lane Status');
});
