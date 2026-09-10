#!/usr/bin/env node
// conductor/tests/track-10086-dependency-resume.test.mjs
// Track AM-10086 Phase 1 + Phase 3b: unit coverage of the pure decision
// module conductor/services/dependency-resume.mjs. No I/O, no spawned
// process — pure function assertions, same style as
// track-10055-waiting-any-lane.test.mjs.
//
// Run: node --test conductor/tests/track-10086-dependency-resume.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseWaitingOnTracks,
  writeWaitingOnTracks,
  clearWaitingOnTracks,
  parseAutoResumedMarker,
  writeAutoResumedMarker,
  clearAutoResumedMarker,
  resolveBlockedDependencies,
  isDependencyShipped,
  decideAutoResume,
} from '../services/dependency-resume.mjs';

describe('parseWaitingOnTracks / writeWaitingOnTracks / clearWaitingOnTracks', () => {
  it('TC-1.1 (partial): reads a plain comma list', () => {
    assert.deepEqual(parseWaitingOnTracks('**Waiting On Tracks**: 1000, 1002\n'), ['1000', '1002']);
  });

  it('TC-1.2: normalises INITIALS- prefix and leading zeros', () => {
    assert.deepEqual(parseWaitingOnTracks('**Waiting On Tracks**: AM-1000, 0999\n'), ['1000', '999']);
  });

  it('returns [] when the marker is absent', () => {
    assert.deepEqual(parseWaitingOnTracks('no markers here\n'), []);
  });

  it('returns [] on a malformed value rather than throwing (REQ-7)', () => {
    assert.deepEqual(parseWaitingOnTracks('**Waiting On Tracks**: , ,\n'), []);
  });

  it('does not match the marker name quoted inside prose (REQ-10)', () => {
    const prose = '**Problem**: parked with **Waiting On Tracks**: 1000 mentioned mid-sentence\n';
    assert.deepEqual(parseWaitingOnTracks(prose), []);
  });

  it('write is sparse-emission and round-trips through clear', () => {
    const written = writeWaitingOnTracks('# Track\n**Lane**: implement\n', ['1000', '1002']);
    assert.match(written, /\*\*Waiting On Tracks\*\*: 1000, 1002/);
    assert.deepEqual(parseWaitingOnTracks(written), ['1000', '1002']);
    const cleared = clearWaitingOnTracks(written);
    assert.doesNotMatch(cleared, /Waiting On Tracks/);
  });

  it('write with an empty list clears instead of writing an empty marker', () => {
    const withMarker = writeWaitingOnTracks('base\n', ['1000']);
    const cleared = writeWaitingOnTracks(withMarker, []);
    assert.doesNotMatch(cleared, /Waiting On Tracks/);
  });

  it('clear is a no-op when the marker was never present', () => {
    assert.equal(clearWaitingOnTracks('plain content\n'), 'plain content\n');
  });

  it('updates an existing marker in place rather than duplicating it', () => {
    const once = writeWaitingOnTracks('base\n', ['1000']);
    const twice = writeWaitingOnTracks(once, ['1002']);
    assert.equal((twice.match(/\*\*Waiting On Tracks\*\*/g) || []).length, 1);
    assert.deepEqual(parseWaitingOnTracks(twice), ['1002']);
  });
});

describe('parseAutoResumedMarker / writeAutoResumedMarker / clearAutoResumedMarker', () => {
  it('round-trips a written marker', () => {
    const at = new Date('2026-09-09T00:00:00.000Z');
    const written = writeAutoResumedMarker('base\n', ['1000', '1002'], at);
    const parsed = parseAutoResumedMarker(written);
    assert.equal(parsed.at, at.toISOString());
    assert.deepEqual(parsed.deps, ['1000', '1002']);
  });

  it('returns null when absent', () => {
    assert.equal(parseAutoResumedMarker('no marker\n'), null);
  });

  it('clear removes it entirely, unlocking a future auto-resume', () => {
    const written = writeAutoResumedMarker('base\n', ['1000']);
    const cleared = clearAutoResumedMarker(written);
    assert.equal(parseAutoResumedMarker(cleared), null);
  });

  it('updates an existing marker in place, not append', () => {
    const once = writeAutoResumedMarker('base\n', ['1000']);
    const twice = writeAutoResumedMarker(once, ['1002', '1003']);
    assert.equal((twice.match(/\*\*Auto Resumed\*\*/g) || []).length, 1);
    assert.deepEqual(parseAutoResumedMarker(twice).deps, ['1002', '1003']);
  });
});

describe('resolveBlockedDependencies — attribution (spec.md)', () => {
  it('TC-1.1: **Waiting On Tracks** wins regardless of **Depends On**', () => {
    const content = '**Waiting On Tracks**: 1000, 1002\n**Depends On**: 9999\n**Waiting Reason**: unrelated text\n';
    assert.deepEqual(resolveBlockedDependencies({ content }), { deps: ['1000', '1002'], source: 'marker' });
  });

  it('TC-1.3: inferred from Depends On + Waiting Reason naming it (the live AM-1003 case)', () => {
    const content = '**Depends On**: 1000\n**Waiting Reason**: AM-1000 unmerged; Phase 4 done; awaiting merge order\n';
    assert.deepEqual(resolveBlockedDependencies({ content }), { deps: ['1000'], source: 'inferred' });
  });

  it('TC-1.4: only the dependency numbers actually named are attributed', () => {
    const content = '**Depends On**: 1000, 1002\n**Waiting Reason**: AM-1000 unmerged\n';
    assert.deepEqual(resolveBlockedDependencies({ content }), { deps: ['1000'], source: 'inferred' });
  });

  it('TC-1.5 (AC-3): a Depends On present but not mentioned in an unrelated reason is not attributed', () => {
    const content = '**Depends On**: 1000\n**Waiting Reason**: Needs approval to run the destructive 0042 migration on prod\n';
    assert.deepEqual(resolveBlockedDependencies({ content }), { deps: [], source: null });
  });

  it('TC-1.6 (AC-5): no dependency markers at all', () => {
    assert.deepEqual(resolveBlockedDependencies({ content: 'plain track, no dependency markers\n' }), { deps: [], source: null });
  });

  it('TC-1.7: no substring false positive (10001 does not attribute to Depends On: 1000)', () => {
    const content = '**Depends On**: 1000\n**Waiting Reason**: blocked on 10001 for now\n';
    assert.deepEqual(resolveBlockedDependencies({ content }), { deps: [], source: null });
  });

  it('Depends On present, no Waiting Reason at all — not attributable', () => {
    const content = '**Depends On**: 1000\n';
    assert.deepEqual(resolveBlockedDependencies({ content }), { deps: [], source: null });
  });

  it('TC-7.5 / AC-10: never attributes to marker names quoted in prose', () => {
    const content =
      '**Problem**: incident text **Depends On**: 1000; AM-1000 merged to main shortly after, ' +
      'but AM-1003 sat parked indefinitely. `Waiting Reason`: quoted here too.\n' +
      '**Lane Status**: waiting\n';
    assert.deepEqual(resolveBlockedDependencies({ content }), { deps: [], source: null });
  });
});

describe('isDependencyShipped — satisfaction (spec.md: done:success, not done alone)', () => {
  const state = {
    1000: { lane: 'done', laneActionStatus: 'success' },
    1001: { lane: 'done', laneActionStatus: 'queue' },
    1002: { lane: 'done', laneActionStatus: 'waiting' },
    1003: { lane: 'review', laneActionStatus: 'success' },
  };

  it('TC-2.1: done + success is shipped', () => {
    assert.equal(isDependencyShipped('1000', state), true);
  });

  it('TC-2.2: done + queue (unmerged) is not shipped', () => {
    assert.equal(isDependencyShipped('1001', state), false);
  });

  it('TC-2.3: done + waiting (PR open) is not shipped', () => {
    assert.equal(isDependencyShipped('1002', state), false);
  });

  it('TC-2.4: review + success is not shipped (wrong lane)', () => {
    assert.equal(isDependencyShipped('1003', state), false);
  });

  it('TC-2.5 (AC-9): absent from the state map fails closed', () => {
    assert.equal(isDependencyShipped('9999', state), false);
  });
});

describe('decideAutoResume — the full eligibility rule', () => {
  const shippedState = { 1000: { lane: 'done', laneActionStatus: 'success' } };
  const unmergedState = { 1000: { lane: 'done', laneActionStatus: 'queue' } };
  const parkedAttributed =
    '**Lane Status**: waiting\n**Depends On**: 1000\n**Waiting Reason**: AM-1000 unmerged; awaiting merge order\n';

  it('TC-3.1: not at waiting at all', () => {
    const result = decideAutoResume({ content: '**Lane Status**: queue\n', stateByTrackNumber: shippedState });
    assert.deepEqual(result, { resume: false, deps: [], source: null, skipReason: 'not-waiting' });
  });

  it('TC-3.2 (AC-1): attributable, dependency shipped — resumes', () => {
    const result = decideAutoResume({ content: parkedAttributed, stateByTrackNumber: shippedState });
    assert.equal(result.resume, true);
    assert.deepEqual(result.deps, ['1000']);
    assert.equal(result.source, 'inferred');
    assert.equal(result.skipReason, null);
  });

  it('TC-3.3 (AC-2): attributable, dependency unshipped — stays parked, names the unmet track', () => {
    const result = decideAutoResume({ content: parkedAttributed, stateByTrackNumber: unmergedState });
    assert.equal(result.resume, false);
    assert.equal(result.skipReason, 'unmet:1000');
  });

  it('TC-3.4 (AC-5): not attributable at all', () => {
    const content = '**Lane Status**: waiting\n**Waiting Reason**: Needs approval to run the destructive 0042 migration\n';
    const result = decideAutoResume({ content, stateByTrackNumber: shippedState });
    assert.deepEqual(result, { resume: false, deps: [], source: null, skipReason: 'no-attribution' });
  });

  it('TC-3.5 (AC-8): already auto-resumed for the same dependency set — not resumed again', () => {
    const withMarker = writeAutoResumedMarker(parkedAttributed, ['1000']);
    const result = decideAutoResume({ content: withMarker, stateByTrackNumber: shippedState });
    assert.equal(result.resume, false);
    assert.equal(result.skipReason, 'already-auto-resumed');
  });

  it('TC-3.6: a different auto-resumed dependency set does not block this one', () => {
    const withDifferentMarker = writeAutoResumedMarker(parkedAttributed, ['1002']);
    const result = decideAutoResume({ content: withDifferentMarker, stateByTrackNumber: shippedState });
    assert.equal(result.resume, true);
  });

  it('TC-3.7 (REQ-7): malformed Waiting On Tracks never throws, falls through to inference', () => {
    const content = `**Lane Status**: waiting\n**Waiting On Tracks**: , ,\n${parkedAttributed}`;
    assert.doesNotThrow(() => decideAutoResume({ content, stateByTrackNumber: shippedState }));
    const result = decideAutoResume({ content, stateByTrackNumber: shippedState });
    assert.equal(result.resume, true);
    assert.equal(result.source, 'inferred');
  });

  it('AC-4: a marker-attributed park needs every named dependency shipped, not just one', () => {
    const content = '**Lane Status**: waiting\n**Waiting On Tracks**: 1000, 1002\n';
    const oneShipped = { 1000: { lane: 'done', laneActionStatus: 'success' }, 1002: { lane: 'implement', laneActionStatus: 'success' } };
    const bothShipped = { 1000: { lane: 'done', laneActionStatus: 'success' }, 1002: { lane: 'done', laneActionStatus: 'success' } };
    assert.equal(decideAutoResume({ content, stateByTrackNumber: oneShipped }).resume, false);
    assert.equal(decideAutoResume({ content, stateByTrackNumber: bothShipped }).resume, true);
  });

  it('AC-9: an unknown dependency track number is treated as unmet, never satisfied', () => {
    const content = '**Lane Status**: waiting\n**Waiting On Tracks**: 9999\n';
    const result = decideAutoResume({ content, stateByTrackNumber: {} });
    assert.equal(result.resume, false);
    assert.equal(result.skipReason, 'unmet:9999');
  });
});
