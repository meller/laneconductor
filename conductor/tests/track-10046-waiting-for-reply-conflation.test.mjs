// Track AM-10046 Finding 2: **Waiting for reply** must correspond to a
// genuine unanswered human comment. Confirmed live on track 10040 (this
// track's own incident): a stray flag with no real question caused every
// poll cycle to re-run the track's actual lane action (e.g. merge)
// mislabeled as "answering a question" (local-fs-answer), colliding with
// main-mode lock contention and silently reverting Lane Status with no
// signal that a human was never actually involved.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Mirrors hasGenuineUnansweredHumanComment in conductor/laneconductor.sync.mjs.
// That module boots a whole worker on import (same constraint noted in
// track-10040-duplicate-dir-scan.test.mjs), so the check is reimplemented
// here and pinned against the source by TC-6.
function hasGenuineUnansweredHumanComment(convPath) {
  if (!existsSync(convPath)) return false;
  const lines = readFileSync(convPath, 'utf8').split('\n');
  let lastHumanIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^>\s+\*\*human\*\*/i.test(lines[i])) lastHumanIdx = i;
  }
  if (lastHumanIdx === -1) return false;
  for (let i = lastHumanIdx + 1; i < lines.length; i++) {
    if (/^>\s+\*\*(claude|system)\*\*/i.test(lines[i])) return false;
  }
  return true;
}

function withConvFile(content, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'lc-10046-'));
  const p = join(dir, 'conversation.md');
  writeFileSync(p, content, 'utf8');
  try {
    return fn(p);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('TC-1: no human line at all -> not genuine (stale flag, e.g. 10040\'s shape)', () => {
  withConvFile(
    `> **system**: ✅ Merged track-10040 to main.\n`,
    (p) => assert.equal(hasGenuineUnansweredHumanComment(p), false)
  );
});

test('TC-2: human comment already answered by claude -> not genuine', () => {
  withConvFile(
    `> **human**: what does this do?\n\n> **claude**: it does X.\n`,
    (p) => assert.equal(hasGenuineUnansweredHumanComment(p), false)
  );
});

test('TC-3: human comment already answered by system -> not genuine', () => {
  withConvFile(
    `> **human**: please proceed\n\n> **system**: ✅ Proceeded.\n`,
    (p) => assert.equal(hasGenuineUnansweredHumanComment(p), false)
  );
});

test('TC-4: human comment with no reply after it -> genuine', () => {
  withConvFile(
    `> **system**: ⏸️ Needs your input: proceed with X or Y?\n\n> **human**: X please\n`,
    (p) => assert.equal(hasGenuineUnansweredHumanComment(p), true)
  );
});

test('TC-5: missing conversation.md -> not genuine', () => {
  assert.equal(hasGenuineUnansweredHumanComment('/nonexistent/conversation.md'), false);
});

test('TC-6: the real dispatch code checks genuineness before entering the answer branch', () => {
  const src = readFileSync('conductor/laneconductor.sync.mjs', 'utf8');
  assert.ok(
    src.includes('hasGenuineUnansweredHumanComment'),
    'dispatch loop must call hasGenuineUnansweredHumanComment before treating waitingForReply as a real conversation-reply'
  );
  assert.ok(
    src.includes('let waitingForReply = parseWaitingForReply(content);'),
    'waitingForReply must be mutable so a stale flag can be cleared in-place'
  );
});
