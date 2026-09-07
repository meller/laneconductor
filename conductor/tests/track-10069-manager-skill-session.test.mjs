// Track AM-10069 Phase 5: Manager target — skill-driven turns with live state
// (REQ-6..REQ-8, REQ-14, REQ-15, REQ-21, 10067 REQ-14/REQ-21)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MANAGER_PSEUDO_TRACK, isManagerPseudoTrack, ensureManagerPseudoTrack } from '../services/manager-pseudo-track.mjs';
import { buildLocalStateDigest } from '../services/instance-state.mjs';

const ROOT = process.cwd();
const SYNC_SRC = readFileSync(new URL('../laneconductor.sync.mjs', import.meta.url), 'utf8');

test('TC-5.0a (contract assertion, 10067 REQ-14): conductor/tracks/manager exists with index.md and conversation.md', () => {
  const managerDir = join(ROOT, 'conductor', 'tracks', MANAGER_PSEUDO_TRACK);
  assert.ok(existsSync(managerDir), 'conductor/tracks/manager directory must exist');
  assert.ok(existsSync(join(managerDir, 'index.md')), 'conductor/tracks/manager/index.md must exist');
  assert.ok(existsSync(join(managerDir, 'conversation.md')), 'conductor/tracks/manager/conversation.md must exist');
});

test('TC-5.0b (contract assertion, 10067 REQ-21): MANAGER_PSEUDO_TRACK contains no digit in any position', () => {
  assert.equal(MANAGER_PSEUDO_TRACK, 'manager');
  assert.doesNotMatch(MANAGER_PSEUDO_TRACK, /\d/, 'reserved manager name must have no digit anywhere');
});

test('TC-5.1: ensureManagerPseudoTrack scaffolds pseudo-track directory and initial files idempotently', () => {
  const tmpRepo = mkdtempSync(join(tmpdir(), 'lc-mgr-test-'));
  try {
    const dir = ensureManagerPseudoTrack(tmpRepo);
    assert.ok(existsSync(join(dir, 'index.md')));
    assert.ok(existsSync(join(dir, 'conversation.md')));
    const index = readFileSync(join(dir, 'index.md'), 'utf8');
    assert.ok(index.includes('**Type**: manager'));
    assert.ok(index.includes('**Waiting for reply**: no'));

    // Idempotent call doesn't clobber
    ensureManagerPseudoTrack(tmpRepo);
    assert.ok(existsSync(join(dir, 'index.md')));
  } finally {
    rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('TC-5.2a (REQ-14): buildLocalStateDigest produces compact digest under character budget and references lc state --json', () => {
  const digest = buildLocalStateDigest({ projectRoot: ROOT });
  assert.ok(digest, 'digest should be generated');
  assert.ok(digest.includes('LaneConductor instance snapshot'));
  assert.ok(digest.includes('Call `lc state --json` for the full snapshot'));
  assert.ok(digest.length <= 900, `digest length ${digest.length} must be <= 900 chars`);
});

test('TC-5.2b (REQ-14, REQ-15): spawnCli injects instance_state_digest on fresh manager turn and gates re-injection on session.isFresh', () => {
  assert.ok(
    SYNC_SRC.includes('isManagerPseudoTrack(trackNumber) && session?.isFresh !== false'),
    'spawnCli must check isManagerPseudoTrack and session?.isFresh !== false before injecting digest'
  );
  assert.ok(
    SYNC_SRC.includes('<instance_state_digest>'),
    'spawnCli must inject <instance_state_digest> tag'
  );
});

test('TC-5.3 (REQ-8): resolveTrackSession states context cap reset explicitly in conversation.md', () => {
  assert.ok(
    SYNC_SRC.includes('Session context cap reached'),
    'resolveTrackSession must post a notice when session cap is reached'
  );
});
