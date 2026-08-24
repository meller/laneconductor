#!/usr/bin/env node
// conductor/tests/track-10018-merge-mode.test.mjs
// Track 10018 Phase 1 + 6: per-track merge mode resolution and marker parsing.
// Run: node --test conductor/tests/track-10018-merge-mode.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseMergeModeMarker, resolveMergeMode } from '../services/merge-mode.mjs';

describe('resolveMergeMode', () => {
  it('defaults NULL merge_mode to pr', () => {
    assert.equal(resolveMergeMode({ merge_mode: null }), 'pr');
  });

  it('defaults absent merge_mode to pr', () => {
    assert.equal(resolveMergeMode({}), 'pr');
  });

  it('defaults undefined track to pr', () => {
    assert.equal(resolveMergeMode(undefined), 'pr');
  });

  it('respects explicit direct', () => {
    assert.equal(resolveMergeMode({ merge_mode: 'direct' }), 'direct');
  });

  it('respects explicit pr', () => {
    assert.equal(resolveMergeMode({ merge_mode: 'pr' }), 'pr');
  });

  it('is case-insensitive', () => {
    assert.equal(resolveMergeMode({ merge_mode: 'DIRECT' }), 'direct');
  });

  it('defaults garbage values to pr with a warning, not a throw', () => {
    assert.equal(resolveMergeMode({ merge_mode: 'yolo' }), 'pr');
  });

  it('treats empty string as unspecified', () => {
    assert.equal(resolveMergeMode({ merge_mode: '' }), 'pr');
  });
});

describe('parseMergeModeMarker', () => {
  it('parses **Merge Mode**: direct', () => {
    assert.equal(parseMergeModeMarker('**Merge Mode**: direct\n'), 'direct');
  });

  it('parses **Merge Mode**: pr', () => {
    assert.equal(parseMergeModeMarker('**Merge Mode**: pr\n'), 'pr');
  });

  it('is case-insensitive on both marker and value', () => {
    assert.equal(parseMergeModeMarker('**merge mode**: DIRECT\n'), 'direct');
  });

  it('returns null when marker is absent', () => {
    assert.equal(parseMergeModeMarker('# Track 1: Foo\n\n**Lane**: plan\n'), null);
  });

  it('returns null for an invalid value rather than guessing', () => {
    assert.equal(parseMergeModeMarker('**Merge Mode**: banana\n'), null);
  });

  it('round-trips through resolveMergeMode', () => {
    const marker = parseMergeModeMarker('**Merge Mode**: direct\n');
    assert.equal(resolveMergeMode({ merge_mode: marker }), 'direct');
  });
});
