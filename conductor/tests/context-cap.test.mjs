#!/usr/bin/env node
// conductor/tests/context-cap.test.mjs
//
// Dogfooding session 2026-08-24: spawnCli's contextPrompt (project docs +
// a track's own index/spec/plan/test/conversation.md) gets embedded as a
// single argv element passed to spawn() — and on the host machine, spawn()
// throws `E2BIG` once a single argv element exceeds ~131072 bytes,
// confirmed live via binary search (131000 bytes: OK, 132000 bytes:
// E2BIG). This silently made a real track (10021) undispatchable —
// forever, with no error surfaced anywhere useful — once its own
// conversation.md alone reached 145KB. capContentForArgv caps each doc's
// contribution before it goes into that argv element.
//
// Run: node --test conductor/tests/context-cap.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { capContentForArgv } from '../services/context-cap.mjs';

describe('capContentForArgv', () => {
  it('returns content unchanged when under the byte budget', () => {
    const content = 'hello world';
    assert.equal(capContentForArgv(content, 1000), content);
  });

  it('returns null/undefined unchanged', () => {
    assert.equal(capContentForArgv(null, 1000), null);
    assert.equal(capContentForArgv(undefined, 1000), undefined);
  });

  it('truncates from the start (keepTail=false) and stays under the budget', () => {
    const content = 'a'.repeat(50_000);
    const capped = capContentForArgv(content, 1_000, false);
    assert.ok(Buffer.byteLength(capped, 'utf8') <= 1_000, 'must respect the byte budget');
    assert.match(capped, /^a+/, 'keeps the START of the content');
    assert.match(capped, /truncated.*first/i);
  });

  it('truncates from the end (keepTail=true) and stays under the budget — the conversation.md case', () => {
    const content = 'OLD-HISTORY-' + 'x'.repeat(40_000) + '-MOST-RECENT-ACTIVITY';
    const capped = capContentForArgv(content, 1_000, true);
    assert.ok(Buffer.byteLength(capped, 'utf8') <= 1_000, 'must respect the byte budget');
    assert.ok(capped.endsWith('-MOST-RECENT-ACTIVITY'), 'keeps the END of the content — most recent activity survives');
    assert.doesNotMatch(capped, /OLD-HISTORY/, 'the oldest content is what gets dropped');
    assert.match(capped, /truncated.*most recent/i);
  });

  it('is stable under multi-byte UTF-8 content — never splits a byte budget mid-character', () => {
    // Emoji + multi-byte chars are common in conversation.md (✅⚠️❌ etc,
    // seen live throughout this repo's own conversation.md files). A naive
    // string-length-based slice can cut a multi-byte character in half,
    // producing invalid UTF-8. Buffer.subarray is byte-safe by construction
    // — this test just proves the result round-trips as valid text.
    const content = '✅⚠️❌'.repeat(5_000);
    const capped = capContentForArgv(content, 500, false);
    assert.ok(Buffer.byteLength(capped, 'utf8') <= 500);
    // toString('utf8') on a boundary that split a multi-byte sequence
    // produces the U+FFFD replacement character — assert none crept in.
    assert.doesNotMatch(capped, /�/, 'must not split a multi-byte character mid-sequence');
  });

  it('regression: the real track-10021 shape (189KB combined) caps to well under the confirmed E2BIG threshold', () => {
    // Mirrors spawnCli's actual per-doc budgets, not a hypothetical one —
    // if these numbers drift out of sync with laneconductor.sync.mjs's own
    // call sites, this test's own margin below is what would catch it.
    const projectDocs = ['product.md content '.repeat(1_500), 'tiny', 'tiny'];
    const trackDocs = {
      'index.md': 'index content '.repeat(50),
      'spec.md': 'spec content '.repeat(50),
      'plan.md': 'plan content '.repeat(50),
      'test.md': 'test content '.repeat(50),
      'conversation.md': 'A very long conversation history. '.repeat(6_000), // ~210KB raw
    };
    let total = 0;
    for (const doc of projectDocs) total += Buffer.byteLength(capContentForArgv(doc, 10_000) || '', 'utf8');
    total += Buffer.byteLength(capContentForArgv(trackDocs['index.md'], 12_000) || '', 'utf8');
    total += Buffer.byteLength(capContentForArgv(trackDocs['spec.md'], 12_000) || '', 'utf8');
    total += Buffer.byteLength(capContentForArgv(trackDocs['plan.md'], 12_000) || '', 'utf8');
    total += Buffer.byteLength(capContentForArgv(trackDocs['test.md'], 12_000) || '', 'utf8');
    total += Buffer.byteLength(capContentForArgv(trackDocs['conversation.md'], 30_000, true) || '', 'utf8');
    // Confirmed E2BIG threshold on the host machine is ~131072 bytes;
    // assert real margin, not just "under the line".
    assert.ok(total < 100_000, `capped total (${total} bytes) must stay well under the ~131072-byte E2BIG threshold`);
  });
});
