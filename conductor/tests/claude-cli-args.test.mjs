#!/usr/bin/env node
// conductor/tests/claude-cli-args.test.mjs
// Track 1087 Phase 1: claude spawns switch to stream-json output so the
// worker can parse structured events as they're written, instead of tailing
// plain text every 5s.
//
// --verbose is required alongside --output-format stream-json --print (not
// in the original plan) — confirmed against the real claude CLI, which
// exits with "Error: When using --print, --output-format=stream-json
// requires --verbose" otherwise.
//
// Run: node --test conductor/tests/claude-cli-args.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildClaudeArgs } from '../claude-cli-args.mjs';

describe('buildClaudeArgs', () => {
  it('includes stream-json output flags', () => {
    const args = buildClaudeArgs({ prompt: 'do the thing' });
    assert.ok(args.includes('--output-format'));
    assert.equal(args[args.indexOf('--output-format') + 1], 'stream-json');
    assert.ok(args.includes('--include-partial-messages'));
  });

  it('includes --verbose (required by the real CLI alongside --print --output-format=stream-json)', () => {
    const args = buildClaudeArgs({ prompt: 'do the thing' });
    assert.ok(args.includes('--verbose'));
  });

  it('preserves --dangerously-skip-permissions and session args ahead of the new flags', () => {
    const args = buildClaudeArgs({ sessionArgs: ['--session-id', 'abc-123'], prompt: 'do the thing' });
    assert.deepEqual(
      args.slice(0, 3),
      ['--dangerously-skip-permissions', '--session-id', 'abc-123']
    );
  });

  it('concatenates freshnessMarker and prompt into the -p value', () => {
    const args = buildClaudeArgs({ freshnessMarker: 'FRESH_SESSION: true\n\n', prompt: 'do the thing' });
    const pIndex = args.indexOf('-p');
    assert.ok(pIndex !== -1);
    assert.equal(args[pIndex + 1], 'FRESH_SESSION: true\n\ndo the thing');
  });

  it('appends --model at the end when provided', () => {
    const args = buildClaudeArgs({ prompt: 'do the thing', model: 'sonnet' });
    assert.deepEqual(args.slice(-2), ['--model', 'sonnet']);
  });

  it('omits --model when not provided', () => {
    const args = buildClaudeArgs({ prompt: 'do the thing' });
    assert.ok(!args.includes('--model'));
  });
});
