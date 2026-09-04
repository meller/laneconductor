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

// ── Track 10060 Phase 3 (REQ-6) ──────────────────────────────────────────────
// The done lane is workspace: main, so a dirty-checkout block halts EVERY merge
// in the project, not just this track. The original wording named a path and
// nothing else, which read as one card's housekeeping chore — spec Finding 4,
// and the reason the 10051 incident went unnoticed for a day.

test('TC-14: a dirty-checkout warn leads with ⚠️, states the project-wide halt, and echoes the reason', () => {
  const reason = "the primary checkout has unrelated uncommitted changes outside this track's folder: prisma/schema.sql.";
  const body = formatBlockComment({ action: 'warn', kind: BLOCK_KINDS.DIRTY_CHECKOUT, reason });
  assert.equal(body[0], '⚠️'[0], 'the Inbox buckets match on the literal leading character');
  assert.match(body, /prisma\/schema\.sql/);
  assert.match(body, /every merge/i);
  assert.match(body, /project/i);
});

test('TC-15: a dirty-checkout escalate leads with ❌ and still states the project-wide halt', () => {
  const body = formatBlockComment({ action: 'escalate', kind: BLOCK_KINDS.DIRTY_CHECKOUT, reason: 'prisma/schema.sql' });
  assert.equal(body[0], '❌'[0]);
  assert.match(body, /every merge/i);
});

test('TC-16: silent still posts nothing, for dirty-checkout as for any other kind', () => {
  assert.equal(formatBlockComment({ action: 'silent', kind: BLOCK_KINDS.DIRTY_CHECKOUT, reason: 'x' }), null);
});

test('TC-17: non-dirty-checkout kinds keep their original wording verbatim', () => {
  for (const kind of [BLOCK_KINDS.MAIN_MODE_LOCK, BLOCK_KINDS.EXPIRED_CREDENTIALS, BLOCK_KINDS.GITHUB_APP_MISSING, BLOCK_KINDS.PREFLIGHT_FAILED]) {
    assert.equal(
      formatBlockComment({ action: 'warn', kind, reason: 'R' }),
      '⚠️ Main-mode run blocked — R. Not spawning; will retry next cycle.'
    );
    assert.equal(
      formatBlockComment({ action: 'escalate', kind, reason: 'R' }),
      `❌ Permanently blocked (${kind}) after repeated consecutive failures — R. Marking failure; this needs human attention.`
    );
  }
});

test('formatBlockComment stays pure — same outcome object in, same string out', () => {
  const outcome = { action: 'warn', kind: BLOCK_KINDS.DIRTY_CHECKOUT, reason: 'r' };
  assert.equal(formatBlockComment(outcome), formatBlockComment(outcome));
  assert.deepEqual(outcome, { action: 'warn', kind: BLOCK_KINDS.DIRTY_CHECKOUT, reason: 'r' });
});

test('DEFAULT_ESCALATE_AFTER is 5 unless overridden by env (module loaded without the env var in this test run)', () => {
  assert.equal(DEFAULT_ESCALATE_AFTER, 5);
});
