// Phase 5d Task 7: the privacy scan for published documents (connector/src/scan.mjs).
// Fake secrets (helpers/fakes.mjs) are assembled at run time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanText } from '../src/scan.mjs';
import { FAKES } from './helpers/fakes.mjs';

test('scanText: every pattern class is detected, with the line and the class name only', () => {
  for (const [pattern, fake] of Object.entries(FAKES)) {
    const found = scanText(`first line is fine\nthe value is ${fake} here\nlast`);
    const names = found.map((f) => f.pattern);
    const want = pattern === 'GitHub token (fine-grained)' ? 'GitHub token' : pattern;
    assert.ok(names.includes(want), `${pattern} detected (got ${names.join(', ') || 'nothing'})`);
    for (const f of found) {
      assert.deepEqual(Object.keys(f).sort(), ['line', 'pattern']);
      assert.equal(f.line, 2);
    }
    assert.ok(!JSON.stringify(found).includes(fake), `${pattern}: the matched text is never in the result`);
    for (const piece of fake.split(/[\s@:]/).filter((x) => x.length >= 8)) assert.ok(!JSON.stringify(found).includes(piece), `${pattern}: no piece of the match leaks`);
  }
  assert.equal(scanText(`a\n\n${FAKES['phone number']}\n${FAKES['email address']}`).map((f) => f.line).join(), '3,4');
});

test('scanText: other phone and credential forms', () => {
  for (const t of ['+972 54 123 4567', '(555) 123-4567', '555-123-4567', '+1-555-123-4567', `${'api_'}key: "${'k9x2m4p7q1z8'}"`, `${'DB_PASS'}WORD=${'abc12345xyz'}`, `${'secr'}et = '${'longvalue123'}'`]) {
    assert.ok(scanText(`value ${t} end`).length >= 1, t);
  }
});

test('scanText: ordinary text is not flagged', () => {
  const clean = [
    'Created 2026-11-17 and updated 2026-11-17T10:00:00.000Z, build 2026-11-170000',
    'ports 8090-8091, tracks 10106-10110, ip 192.168.100.100, version 1.2.345',
    'Co-Authored-By: Claude <noreply@anthropic.com>',
    'Created By: 2565050+meller@users.noreply.github.com',
    'write to user@example.com or you@example.org or me@localhost.test',
    'remote is git@github.com:acme/widgets.git and ssh://git@github.com/acme/widgets.git',
    'postgres://postgres:postgres@localhost:5432/laneconductor and redis://u:pass123@127.0.0.1:6379',
    'a password = required here, password: "$DB_PASSWORD", password = <your-password>, password = process.env.PW',
    'the task-abcdefghijklmnopqrstuvwxyz0123 and ask-abcdefghijklmnopqrstuvwxyz0123',
    'tokens: a short token = abc, secret = short',
    '@scope/package@1.2.3 and foo@1.2.3',
  ].join('\n');
  assert.deepEqual(scanText(clean), []);
  assert.deepEqual(scanText(''), []);
  assert.deepEqual(scanText(undefined), []);
});

test('scanText: several matches on several lines, and CRLF line endings', () => {
  const r = scanText(`${FAKES['email address']}\r\nok\r\n${FAKES['phone number']} and ${FAKES['GitHub token']}`);
  assert.deepEqual(r.map((x) => [x.line, x.pattern]).sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1])), [[1, 'email address'], [3, 'GitHub token'], [3, 'phone number']]);
});

test('scanText: a very long line does not take long', () => {
  const t0 = Date.now();
  scanText(`${'a'.repeat(200000)}\n${'1-'.repeat(50000)}\n${'@'.repeat(50000)}`);
  assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0} ms`);
});
