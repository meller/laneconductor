// conductor/tests/track-10047-session-resume-policy.test.mjs
// Confirmed live 2026-09-01: resolveTrackSession() had no cap — once a
// claude_session_id was persisted for a track, every subsequent dispatch
// resumed it via --resume for the track's entire lifetime, no matter how
// large the accumulated conversation got. Track AM-10045's review session
// hard-failed on "Prompt is too long" after many resumes; AM-10046's
// implement session reached 406K cached input tokens on a single turn.
// This tests the pure retirement decision extracted to close that gap.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldRetireSession, DEFAULT_MAX_RESUME_COUNT } from '../services/session-resume-policy.mjs';

test('does not retire a brand-new session (resumeCount 0)', () => {
  assert.equal(shouldRetireSession({ resumeCount: 0 }), false);
});

test('does not retire while under the cap', () => {
  assert.equal(shouldRetireSession({ resumeCount: DEFAULT_MAX_RESUME_COUNT - 1 }), false);
});

test('THE FIX: retires once resumeCount reaches the cap — this is what stops unbounded growth', () => {
  assert.equal(shouldRetireSession({ resumeCount: DEFAULT_MAX_RESUME_COUNT }), true);
});

test('stays retired past the cap (e.g. a missed cycle pushed the count higher)', () => {
  assert.equal(shouldRetireSession({ resumeCount: DEFAULT_MAX_RESUME_COUNT + 5 }), true);
});

test('a custom, tighter cap is respected', () => {
  assert.equal(shouldRetireSession({ resumeCount: 2, maxResumeCount: 2 }), true);
  assert.equal(shouldRetireSession({ resumeCount: 1, maxResumeCount: 2 }), false);
});
