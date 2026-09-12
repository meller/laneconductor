// Track AM-10093 Phase 2: unit coverage for the pure revalidation gate
// (conductor/services/dispatch-revalidation.mjs). See that module's doc
// comment for the mechanism this closes (REQ-1).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { revalidateDispatchSnapshot, parseDispatchSnapshot } from '../services/dispatch-revalidation.mjs';

const base = { lane: 'plan', laneActionStatus: 'queue', autoRun: true, waitingForReply: false };

// TC-2.1
test('TC-2.1: identical snapshot and fresh content is not stale', () => {
  const r = revalidateDispatchSnapshot({ snapshot: base, fresh: { ...base } });
  assert.equal(r.stale, false);
  assert.deepEqual(r.changed, []);
});

// TC-2.2
test('TC-2.2: Lane differs — stale, changed includes Lane', () => {
  const r = revalidateDispatchSnapshot({ snapshot: base, fresh: { ...base, lane: 'done' } });
  assert.equal(r.stale, true);
  assert.ok(r.changed.includes('Lane'));
});

// TC-2.3
test('TC-2.3: Lane Status queue -> running — stale (another claimant won)', () => {
  const r = revalidateDispatchSnapshot({ snapshot: base, fresh: { ...base, laneActionStatus: 'running' } });
  assert.equal(r.stale, true);
  assert.ok(r.changed.includes('Lane Status'));
});

// TC-2.4
test('TC-2.4: Auto Run flipped yes -> no — stale', () => {
  const r = revalidateDispatchSnapshot({ snapshot: base, fresh: { ...base, autoRun: false } });
  assert.equal(r.stale, true);
  assert.ok(r.changed.includes('Auto Run'));
});

// TC-2.5
test('TC-2.5: Waiting for reply flipped no -> yes — stale', () => {
  const r = revalidateDispatchSnapshot({ snapshot: base, fresh: { ...base, waitingForReply: true } });
  assert.equal(r.stale, true);
  assert.ok(r.changed.includes('Waiting for reply'));
});

// TC-2.6
test('TC-2.6: only unrelated content changed (not modeled by these 4 fields) — not stale', () => {
  // The caller only ever compares the 4 modeled fields; a Summary/Progress
  // edit never enters this comparison in the first place, so it can never
  // be reported as a change. This test documents that contract at the
  // parseDispatchSnapshot boundary: two different raw contents that only
  // differ in **Summary** parse to IDENTICAL DispatchSnapshot objects.
  const parseAutoRun = () => true;
  const parseWaitingForReply = () => false;
  const contentA = '**Lane**: plan\n**Lane Status**: queue\n**Summary**: original summary\n';
  const contentB = '**Lane**: plan\n**Lane Status**: queue\n**Summary**: a totally different summary\n';
  const snapA = parseDispatchSnapshot(contentA, { parseAutoRun, parseWaitingForReply });
  const snapB = parseDispatchSnapshot(contentB, { parseAutoRun, parseWaitingForReply });
  const r = revalidateDispatchSnapshot({ snapshot: snapA, fresh: snapB });
  assert.equal(r.stale, false);
});

// parseDispatchSnapshot's own parsing contract
test('parseDispatchSnapshot extracts Lane/Lane Status and delegates Auto Run/Waiting for reply', () => {
  const content = '**Lane**: implement\n**Lane Status**: running\n';
  let autoRunCalledWith = null;
  let waitingCalledWith = null;
  const snap = parseDispatchSnapshot(content, {
    parseAutoRun: (c) => { autoRunCalledWith = c; return true; },
    parseWaitingForReply: (c) => { waitingCalledWith = c; return false; },
  });
  assert.equal(snap.lane, 'implement');
  assert.equal(snap.laneActionStatus, 'running');
  assert.equal(snap.autoRun, true);
  assert.equal(snap.waitingForReply, false);
  assert.equal(autoRunCalledWith, content);
  assert.equal(waitingCalledWith, content);
});

test('parseDispatchSnapshot defaults Lane Status to queue when absent', () => {
  const snap = parseDispatchSnapshot('**Lane**: plan\n', {
    parseAutoRun: () => false,
    parseWaitingForReply: () => false,
  });
  assert.equal(snap.laneActionStatus, 'queue');
});
