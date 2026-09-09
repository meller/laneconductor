// ui/src/lib/composerTriggers.test.js
// Track 10080 Phase 1: pure unit tests for the composer's trigger-detection
// and text-insertion logic. No DOM required.

import { describe, it, expect } from 'vitest';
import { detectTrigger, applyCompletion } from './composerTriggers.js';

describe('detectTrigger', () => {
  it('TC-12: @src/comp at end of string opens the file menu', () => {
    expect(detectTrigger('@src/comp', 9)).toMatchObject({ kind: 'file', query: 'src/comp' });
  });

  it('TC-13: #100 opens the track menu', () => {
    expect(detectTrigger('#100', 4)).toMatchObject({ kind: 'track', query: '100' });
  });

  it('TC-14: @track:100 is a track alias', () => {
    expect(detectTrigger('@track:100', 10)).toMatchObject({ kind: 'track', query: '100' });
  });

  it('TC-15: /mo at position 0 opens the command menu', () => {
    expect(detectTrigger('/mo', 3)).toMatchObject({ kind: 'command', query: 'mo' });
  });

  it('TC-16: a / not at position 0 never triggers the command menu', () => {
    expect(detectTrigger('look at /mo', 11)).toBeNull();
  });

  it('TC-17: @src/lib opens the file menu, not the command menu on its embedded /', () => {
    const trigger = detectTrigger('@src/lib', 8);
    expect(trigger.kind).toBe('file');
    expect(trigger).not.toMatchObject({ kind: 'command' });
  });

  it('TC-18: @tracker.js opens the file menu, not the track menu', () => {
    expect(detectTrigger('@tracker.js', 11)).toMatchObject({ kind: 'file', query: 'tracker.js' });
  });

  it('TC-19: a trigger character not beginning a token triggers nothing (@)', () => {
    expect(detectTrigger('foo@bar', 7)).toBeNull();
  });

  it('TC-20: a trigger character not beginning a token triggers nothing (#)', () => {
    expect(detectTrigger('a#b', 3)).toBeNull();
  });

  it('TC-21: a trigger preceded by whitespace mid-string is recognised', () => {
    expect(detectTrigger('see @Chat here', 9)).toMatchObject({ kind: 'file', query: 'Chat' });
  });
});

describe('applyCompletion', () => {
  it('TC-22: replaces only the trigger token, leaving the rest of the sentence intact', () => {
    const trigger = detectTrigger('see @Chat here', 9);
    const result = applyCompletion('see @Chat here', trigger, 'ui/src/ChatView.jsx');
    expect(result.value).toBe('see ui/src/ChatView.jsx here');
    expect(result.value.slice(result.caret)).toBe('here');
  });

  it('TC-23: exactly one trailing space when the trigger is at the end of the string', () => {
    const trigger = detectTrigger('@src/comp', 9);
    const result = applyCompletion('@src/comp', trigger, 'ui/src/components/ChatView.jsx');
    expect(result.value).toBe('ui/src/components/ChatView.jsx ');
    expect(result.value.endsWith('  ')).toBe(false);
    expect(result.caret).toBe(result.value.length);
  });

  it('does not double a trailing space already present in insertText', () => {
    const trigger = detectTrigger('/mo', 3);
    const result = applyCompletion('/mo', trigger, '/laneconductor move ');
    expect(result.value).toBe('/laneconductor move ');
    expect(result.value.endsWith('  ')).toBe(false);
  });
});
