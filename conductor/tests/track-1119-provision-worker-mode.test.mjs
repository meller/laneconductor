#!/usr/bin/env node
// conductor/tests/track-1119-provision-worker-mode.test.mjs
// New Worker modal gained a mode picker (Auto/Manual), defaulting to Auto —
// per-track **Auto Run** (default no) already gates which tracks a worker
// may pick up unattended, so the worker-level mode no longer needs to
// default to the conservative sync-only.
//
// laneconductor.sync.mjs isn't imported directly (it has real side effects
// on load — spawns the worker main loop; see req8-author-normalization's
// test for the established precedent), so this mirrors the tiny decision
// logic inline and asserts it matches. Keep in sync with the
// `entry.action === 'provision-worker'` handler in laneconductor.sync.mjs.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

function buildProvisionCommand({ workerNumber, cli, model, payloadMode }) {
  const mode = payloadMode === 'sync-only' ? 'sync-only' : 'sync+poll';
  let cmd = `lc worker start --worker-number ${workerNumber}`;
  if (cli) cmd += ` --cli ${cli}`;
  if (model) cmd += ` --model ${model}`;
  if (mode === 'sync+poll') cmd += ' --sync-and-work';
  return { cmd, mode };
}

describe('Track 1119: provision-worker defaults to auto (sync+poll)', () => {
  it('no mode in payload → defaults to sync+poll, adds --sync-and-work', () => {
    const { cmd, mode } = buildProvisionCommand({ workerNumber: 2, cli: 'claude', model: 'claude-sonnet-5' });
    assert.equal(mode, 'sync+poll');
    assert.match(cmd, /--sync-and-work/);
  });

  it('mode: "sync+poll" explicitly → adds --sync-and-work', () => {
    const { cmd, mode } = buildProvisionCommand({ workerNumber: 2, payloadMode: 'sync+poll' });
    assert.equal(mode, 'sync+poll');
    assert.match(cmd, /--sync-and-work/);
  });

  it('mode: "sync-only" → no --sync-and-work flag (matches lc default MANUAL mode)', () => {
    const { cmd, mode } = buildProvisionCommand({ workerNumber: 2, payloadMode: 'sync-only' });
    assert.equal(mode, 'sync-only');
    assert.doesNotMatch(cmd, /--sync-and-work/);
  });

  it('an unrecognized mode value falls back to auto rather than silently going manual', () => {
    const { mode } = buildProvisionCommand({ workerNumber: 2, payloadMode: 'bogus' });
    assert.equal(mode, 'sync+poll');
  });
});
