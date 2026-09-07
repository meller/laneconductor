#!/usr/bin/env node
// conductor/tests/track-10072-static-checks.test.mjs
// Track 10072: cheap, DB-free regression guards that don't need a live
// Postgres — grep-shaped checks over the source, same style as this
// codebase's other "JSX source check" tests (e.g.
// conductor/tests/brainstorm-dispatch.test.mjs's TC-1).
//
// Run: node --test conductor/tests/track-10072-static-checks.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

test('TC-17: the old keyword gate is gone from all three API copies', () => {
  for (const rel of ['ui/server/index.mjs', 'conductor/collector/index.mjs', 'cloud/functions/index.js']) {
    const content = readFileSync(join(ROOT, rel), 'utf8');
    assert.ok(!content.includes("includes('Answered')"), `${rel} still contains the old keyword gate`);
  }
});

test('TC-18: the reply-marking UPDATE is gone everywhere outside test fixtures', () => {
  for (const rel of ['ui/server/index.mjs', 'conductor/collector/index.mjs', 'cloud/functions/index.js']) {
    const content = readFileSync(join(ROOT, rel), 'utf8');
    assert.ok(!content.includes('UPDATE track_comments SET is_replied'), `${rel} still contains the reply-marking UPDATE`);
  }
});

test('TC-19: the badge predicate is defined once in ui/server/index.mjs and referenced by name at all three query sites', () => {
  const content = readFileSync(join(ROOT, 'ui/server/index.mjs'), 'utf8');
  const definitions = content.match(/const HUMAN_NEEDS_REPLY_SQL = /g) ?? [];
  assert.equal(definitions.length, 1, 'HUMAN_NEEDS_REPLY_SQL must be defined exactly once');

  const references = content.match(/\$\{HUMAN_NEEDS_REPLY_SQL\}/g) ?? [];
  assert.equal(references.length, 3, 'HUMAN_NEEDS_REPLY_SQL must be referenced at exactly the three query sites');
});

test('TC-16 (REQ-8): the non-provider comment-exit path posts author "system", not "worker"', () => {
  const content = readFileSync(join(ROOT, 'conductor/laneconductor.sync.mjs'), 'utf8');
  assert.ok(
    content.includes("author: cli === 'npx' ? 'system' : cli,"),
    "the npx-cli fallback must post author: 'system' — 'worker' is absent from VALID_AUTHORS and gets silently coerced to 'human' server-side"
  );
});

test('TC-13/14 (REQ-7): TrackDetailPanel\'s sendComment posts is_replied: !body, suppressing only the auto-generated fallback body', () => {
  const jsx = readFileSync(join(ROOT, 'ui/src/components/TrackDetailPanel.jsx'), 'utf8');
  const call = jsx.match(/body:\s*JSON\.stringify\(\{\s*author:\s*'human'.*?\}\),?$/m);
  assert.ok(call, 'could not find the sendComment POST body construction');
  assert.match(call[0], /is_replied:\s*!body/, 'sendComment must post is_replied: !body');
  // A body the human actually typed must not force is_replied — !body is
  // false whenever body is non-empty, which is exactly this guarantee.
});
