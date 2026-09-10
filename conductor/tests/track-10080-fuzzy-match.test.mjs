#!/usr/bin/env node
// conductor/tests/track-10080-fuzzy-match.test.mjs
// Track 10080 Phase 1: pure unit tests for fuzzy-match.mjs and
// slash-commands.mjs. Neither module is reachable by vitest — its include
// globs are scoped to ui/ — so these follow the node:test convention
// already used by merge-mode.mjs/workspace-mode.mjs.
//
// Run: node --test conductor/tests/track-10080-fuzzy-match.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fuzzyScore, fuzzyRank } from '../services/fuzzy-match.mjs';
import { SLASH_COMMANDS, commandInsertText } from '../services/slash-commands.mjs';

describe('fuzzyScore', () => {
  it('TC-1: matches a subsequence and returns a number', () => {
    const score = fuzzyScore('ui/src/components/ChatView.jsx', 'chatview');
    assert.equal(typeof score, 'number');
    assert.notEqual(score, null);
  });

  it('TC-2: returns null when query is not a subsequence', () => {
    assert.equal(fuzzyScore('Makefile', 'zzz'), null);
  });

  it('TC-3: matching is case-insensitive in both directions', () => {
    assert.notEqual(fuzzyScore('ChatView', 'chatview'), null);
    assert.notEqual(fuzzyScore('chatview', 'CHATVIEW'), null);
  });

  it('TC-4: a path-segment-boundary match outranks a mid-segment match', () => {
    const boundary = fuzzyScore('ui/src/lib/chat.js', 'chat');
    const midSegment = fuzzyScore('ui/src/archat/x.js', 'chat');
    assert.ok(boundary > midSegment, `expected ${boundary} > ${midSegment}`);
  });

  it('TC-5: a consecutive-run match outranks a scattered subsequence', () => {
    const consecutive = fuzzyScore('chatview.js', 'chatview');
    const scattered = fuzzyScore('c_h_a_t_v_i_e_w.js', 'chatview');
    assert.ok(consecutive > scattered, `expected ${consecutive} > ${scattered}`);
  });

  it('TC-6: a basename match outranks a directory-only match', () => {
    const basename = fuzzyScore('lib/ChatView.jsx', 'chatview');
    const directoryOnly = fuzzyScore('chatview/other.js', 'chatview');
    assert.ok(basename > directoryOnly, `expected ${basename} > ${directoryOnly}`);
  });

  it('TC-7: two equal-score candidates are ordered by candidate string ascending, stably', () => {
    // Identical shape and length, differing only in the unmatched directory
    // name, so their raw scores tie exactly.
    const list = ['bbbb/Chat.js', 'aaaa/Chat.js'];
    const ranked1 = fuzzyRank(list, 'Chat');
    const ranked2 = fuzzyRank(list, 'Chat');
    assert.deepEqual(ranked1, ['aaaa/Chat.js', 'bbbb/Chat.js']);
    assert.deepEqual(ranked1, ranked2);
  });

  it('TC-8: fuzzyRank with an empty query returns the first N in input order', () => {
    const list = ['b.js', 'a.js', 'c.js', 'd.js', 'e.js', 'f.js'];
    assert.deepEqual(fuzzyRank(list, '', { limit: 5 }), ['b.js', 'a.js', 'c.js', 'd.js', 'e.js']);
  });

  it('TC-9: fuzzyRank respects limit', () => {
    const list = ['chat1.js', 'chat2.js', 'chat3.js', 'chat4.js'];
    const ranked = fuzzyRank(list, 'chat', { limit: 2 });
    assert.equal(ranked.length, 2);
  });

  it('fuzzyRank supports a key accessor for object candidates', () => {
    const list = [{ path: 'b/Chat.js' }, { path: 'a/Chat.js' }];
    const ranked = fuzzyRank(list, 'Chat', { key: c => c.path });
    assert.deepEqual(ranked.map(c => c.path), ['a/Chat.js', 'b/Chat.js']);
  });
});

describe('SLASH_COMMANDS / commandInsertText', () => {
  it('TC-10: includes the minimum required commands, each with a description', () => {
    const required = ['plan', 'implement', 'review', 'move', 'brainstorm', 'pulse', 'comment'];
    for (const name of required) {
      const cmd = SLASH_COMMANDS.find(c => c.name === name);
      assert.ok(cmd, `expected SLASH_COMMANDS to include "${name}"`);
      assert.ok(cmd.description && cmd.description.length > 0, `expected "${name}" to have a description`);
    }
  });

  it('TC-11: commandInsertText formats the command for insertion', () => {
    assert.equal(commandInsertText({ name: 'move' }), '/laneconductor move ');
  });
});
