#!/usr/bin/env node
// conductor/tests/sync-conversation-parser.test.mjs
// Bug: syncConversation() (FS→DB direction for conversation.md) only
// extracts comments from lines matching `> **author**: body` — any new
// content that doesn't match this turn-based format yields zero parsed
// comments, and was previously swallowed silently: the cursor still
// advances past it, so it's never re-checked or reported.
//
// Real-world case (coach ai / aitutor project, track 180): an agent wrote
// conversation.md as a narrative document (`## V2 — Liran's redline
// reply...` section headers + plain blockquoted email/contract text)
// instead of turn-based comments. Result: 15KB of real negotiation history
// never reached track_comments / the UI's Conversation tab, with nothing
// in the logs to say so.
//
// Run: node --test conductor/tests/sync-conversation-parser.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseConversationComments } from '../sync-conversation-utils.mjs';

describe('parseConversationComments', () => {
  it('parses a simple turn', () => {
    const comments = parseConversationComments('> **human**: Hello there\n');
    assert.equal(comments.length, 1);
    assert.equal(comments[0].author, 'human');
    assert.equal(comments[0].body, 'Hello there');
  });

  it('parses multiple turns', () => {
    const comments = parseConversationComments(
      '> **human**: Hi\n\n> **claude**: Hello, how can I help?\n'
    );
    assert.equal(comments.length, 2);
    assert.equal(comments[0].author, 'human');
    assert.equal(comments[1].author, 'claude');
  });

  it('appends continuation lines (leading >) to the current comment body', () => {
    const comments = parseConversationComments(
      '> **human**: First line\n> second line\n> third line\n'
    );
    assert.equal(comments.length, 1);
    assert.equal(comments[0].body, 'First line\nsecond line\nthird line');
  });

  it('parses options: no-wake, brainstorm, replan, bug', () => {
    const [noWake] = parseConversationComments('> **human** (no-wake): quiet note\n');
    assert.equal(noWake.no_wake, true);

    const [brainstorm] = parseConversationComments('> **human** (brainstorm): idea\n');
    assert.equal(brainstorm.is_brainstorm, true);

    const [replan] = parseConversationComments('> **human** (replan): redo it\n');
    assert.equal(replan.is_replan, true);

    const [bug] = parseConversationComments('> **human** (bug): broken\n');
    assert.equal(bug.is_bug, true);
  });

  it('BUG CASE: a bolded sub-header inside a continuation line truncates the comment body', () => {
    // The continuation check excluded ANY line starting with "> **", not
    // just lines that actually match the full `> **author**: body` turn
    // pattern — so quoted content with its own bold sub-headers (e.g.
    // pasted contract clauses like "> **1.1 Role.** Contractor shall...")
    // incorrectly looked like the start of a new turn and silently ended
    // the comment, dropping everything after it (found while backfilling
    // track 180's real negotiation history, which is full of exactly this
    // shape: "> **3.2 Commission Tiers:** A: Referral Only...").
    const comments = parseConversationComments(
      [
        '> **claude**: Summary of the clause.',
        '>',
        '> **1.1 Role.** Contractor shall serve as an advisor.',
        '>',
        '> **2.1 Criteria.** A client counts as Originated if...',
      ].join('\n')
    );
    assert.equal(comments.length, 1, 'a bolded sub-header should not split this into multiple/truncated comments');
    assert.match(comments[0].body, /2\.1 Criteria/, 'content after a bolded sub-header must not be silently dropped');
  });

  it('BUG CASE: a narrative/prose conversation.md (headers + plain blockquotes) parses to zero comments', () => {
    // Shape of track 180's real conversation.md — section headers and long
    // blockquoted reference text, no `> **author**:` turn markers anywhere.
    const narrative = [
      '## V2 — Liran\'s redline reply (received 2026-08-09)',
      '',
      'Liran replied with a full counter-redraft rather than a simple Track election.',
      '',
      '> MASTER INDEPENDENT CONTRACTOR & STRATEGIC ADVISORY AGREEMENT',
      '>',
      '> This Agreement is entered into as of [Date] ("Effective Date")...',
      '',
    ].join('\n');
    const comments = parseConversationComments(narrative);
    assert.equal(comments.length, 0, 'narrative content should not silently parse as zero comments without the caller knowing');
  });

  it('parses the Track 1086 Phase 4 auto-derived session-turn entry format', () => {
    // Exact format spawnCli's exit handler appends — locks in the contract
    // so a future format tweak there doesn't silently stop syncing.
    const entry = '\n> **system**: Session turn — dispatch-implement (resumed session): PASS (exit 0).\n';
    const comments = parseConversationComments(entry);
    assert.equal(comments.length, 1);
    assert.equal(comments[0].author, 'system');
    assert.match(comments[0].body, /Session turn — dispatch-implement \(resumed session\): PASS/);
  });
});
