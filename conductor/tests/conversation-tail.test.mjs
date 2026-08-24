#!/usr/bin/env node
// conductor/tests/conversation-tail.test.mjs
// Run: node --test conductor/tests/conversation-tail.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractUnansweredHumanTail } from '../conversation-tail.mjs';

describe('extractUnansweredHumanTail (Track 10020: resumed sessions need this signal)', () => {
  it('returns null for empty/no content', () => {
    assert.equal(extractUnansweredHumanTail(''), null);
    assert.equal(extractUnansweredHumanTail(null), null);
  });

  it('returns null when the last entry is not from the human (already answered)', () => {
    const content = [
      '> **human**: what is the status?',
      '',
      '> **claude**: 50% done, still working.',
    ].join('\n');
    assert.equal(extractUnansweredHumanTail(content), null);
  });

  it('returns the single trailing human message when nothing has replied to it yet', () => {
    const content = [
      '> **system**: Session turn — dispatch-implement: PASS (exit 0).',
      '',
      '> **claude**: closing response — blocked on your go-ahead.',
      '',
      '> **human** (note, implement): f10c go, f15 can you verify with playwright',
    ].join('\n');
    const tail = extractUnansweredHumanTail(content);
    assert.match(tail, /f10c go, f15 can you verify with playwright/);
    assert.doesNotMatch(tail, /closing response/, 'must not include already-answered earlier entries');
  });

  it('returns MULTIPLE trailing human messages when several arrived back-to-back with no reply', () => {
    const content = [
      '> **claude**: last thing I said.',
      '',
      '> **human**: first follow-up',
      '',
      '> **human**: second follow-up, clarifying the first',
    ].join('\n');
    const tail = extractUnansweredHumanTail(content);
    assert.match(tail, /first follow-up/);
    assert.match(tail, /second follow-up, clarifying the first/);
  });

  it('handles a multi-line human entry (every line "> "-prefixed per the conversation.md convention)', () => {
    const content = [
      '> **claude**: ok, done.',
      '',
      '> **human**: please also do this:\n> - item one\n> - item two',
    ].join('\n');
    const tail = extractUnansweredHumanTail(content);
    assert.match(tail, /item one/);
    assert.match(tail, /item two/);
  });

  it('does not misfire on a "system" or "claude" entry that merely quotes the word human', () => {
    const content = [
      '> **claude**: I will wait for the human to reply before continuing.',
    ].join('\n');
    assert.equal(extractUnansweredHumanTail(content), null);
  });
});
