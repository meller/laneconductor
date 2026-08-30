// Track 10040 Phase 5 (REQ-1,2,3,8,9,10): pre-spawn block counting +
// escalation. REQ-10 is the headline: exactly TWO comments per permanent
// block streak (one warn, one escalate), not 191.

import { test } from 'node:test';
import assert from 'node:assert';
import { decidePreSpawnBlockOutcome, formatBlockComment, BLOCK_KINDS, DEFAULT_ESCALATE_AFTER } from '../services/prespawn-block.mjs';

test('TC-1: countBefore 0 -> warn (first block of a streak)', () => {
  const r = decidePreSpawnBlockOutcome({ kind: BLOCK_KINDS.DIRTY_CHECKOUT, countBefore: 0, threshold: 5 });
  assert.equal(r.action, 'warn');
});

test('TC-2: countBefore 1..3 with threshold 5 -> silent for every one (REQ-10: spam killed at the source)', () => {
  for (const countBefore of [1, 2, 3]) {
    const r = decidePreSpawnBlockOutcome({ kind: BLOCK_KINDS.DIRTY_CHECKOUT, countBefore, threshold: 5 });
    assert.equal(r.action, 'silent', `countBefore=${countBefore} must be silent`);
  }
});

test('TC-3: countBefore 4, threshold 5 -> escalate', () => {
  const r = decidePreSpawnBlockOutcome({ kind: BLOCK_KINDS.DIRTY_CHECKOUT, countBefore: 4, threshold: 5 });
  assert.equal(r.action, 'escalate');
});

test('TC-4: countBefore 9, threshold 5 (counter ran past threshold) -> still escalate, never a second warn', () => {
  const r = decidePreSpawnBlockOutcome({ kind: BLOCK_KINDS.DIRTY_CHECKOUT, countBefore: 9, threshold: 5 });
  assert.equal(r.action, 'escalate');
});

test('TC-5: formatBlockComment — warn body starts with ⚠️, escalate body starts with ❌', () => {
  const warnBody = formatBlockComment({ action: 'warn', kind: BLOCK_KINDS.DIRTY_CHECKOUT, reason: 'D ui/node_modules' });
  const escalateBody = formatBlockComment({ action: 'escalate', kind: BLOCK_KINDS.DIRTY_CHECKOUT, reason: 'D ui/node_modules' });
  assert.equal(warnBody[0], '⚠️'[0]);
  assert.equal(escalateBody[0], '❌'[0]);
});

test('TC-6: escalate body names the disqualifying reason verbatim', () => {
  const body = formatBlockComment({ action: 'escalate', kind: BLOCK_KINDS.DIRTY_CHECKOUT, reason: 'ui/node_modules, conductor/tests/foo.mjs' });
  assert.match(body, /ui\/node_modules, conductor\/tests\/foo\.mjs/);
});

test('TC-7: cause-generic — kind: expired-credentials (10039\'s reserved kind) behaves identically to dirty-checkout', () => {
  const dirty = [0, 1, 4].map(countBefore => decidePreSpawnBlockOutcome({ kind: BLOCK_KINDS.DIRTY_CHECKOUT, countBefore, threshold: 5 }).action);
  const creds = [0, 1, 4].map(countBefore => decidePreSpawnBlockOutcome({ kind: BLOCK_KINDS.EXPIRED_CREDENTIALS, countBefore, threshold: 5 }).action);
  assert.deepEqual(dirty, creds, 'REQ-9: escalation logic must be cause-generic, never branching on dirty-path shape');
});

test('TC-8: unknown/absent kind throws rather than silently counting an unclassified block', () => {
  assert.throws(() => decidePreSpawnBlockOutcome({ kind: 'not-a-real-kind', countBefore: 0 }));
  assert.throws(() => decidePreSpawnBlockOutcome({ countBefore: 0 }));
});

test('formatBlockComment returns null for silent (nothing should ever be posted)', () => {
  assert.equal(formatBlockComment({ action: 'silent', kind: BLOCK_KINDS.DIRTY_CHECKOUT }), null);
});

test('DEFAULT_ESCALATE_AFTER is 5 unless overridden by env (module loaded without the env var in this test run)', () => {
  assert.equal(DEFAULT_ESCALATE_AFTER, 5);
});
