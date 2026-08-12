#!/usr/bin/env node
// conductor/tests/stream-json-tail.test.mjs
// Track 1087 Phase 2: incremental JSONL tailing — reads only newly-appended
// bytes since the last check (not the whole file every time), parses each
// complete line as a stream-json event, and leaves any trailing incomplete
// line (still being written) for the next call.
//
// Run: node --test conductor/tests/stream-json-tail.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseNewJsonlLines, extractFinalAssistantText } from '../stream-json-tail.mjs';

describe('parseNewJsonlLines', () => {
  it('returns no events and the same offset when there is no new content', () => {
    const { events, newOffset } = parseNewJsonlLines('', 0);
    assert.deepEqual(events, []);
    assert.equal(newOffset, 0);
  });

  it('parses a single complete JSON line and advances the offset past it', () => {
    const content = '{"type":"assistant","text":"hi"}\n';
    const { events, newOffset } = parseNewJsonlLines(content, 0);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], { type: 'assistant', text: 'hi' });
    assert.equal(newOffset, content.length);
  });

  it('parses multiple complete lines in order', () => {
    const content = '{"type":"a"}\n{"type":"b"}\n{"type":"c"}\n';
    const { events, newOffset } = parseNewJsonlLines(content, 0);
    assert.deepEqual(events.map(e => e.type), ['a', 'b', 'c']);
    assert.equal(newOffset, content.length);
  });

  it('does not parse a trailing incomplete line, and leaves the offset before it', () => {
    const complete = '{"type":"a"}\n';
    const partial = '{"type":"b","text":"still wri';
    const content = complete + partial;
    const { events, newOffset } = parseNewJsonlLines(content, 0);
    assert.deepEqual(events.map(e => e.type), ['a']);
    assert.equal(newOffset, complete.length, 'offset should stop right after the last complete line');
  });

  it('only processes bytes after previousOffset, not the whole file again', () => {
    const first = '{"type":"a"}\n';
    const second = '{"type":"b"}\n';
    const content = first + second;
    const { events, newOffset } = parseNewJsonlLines(content, first.length);
    assert.deepEqual(events.map(e => e.type), ['b']);
    assert.equal(newOffset, content.length);
  });

  it('skips a malformed JSON line without throwing, but still advances past it', () => {
    const content = '{"type":"a"}\nnot valid json\n{"type":"c"}\n';
    const { events, newOffset } = parseNewJsonlLines(content, 0);
    assert.deepEqual(events.map(e => e.type), ['a', 'c']);
    assert.equal(newOffset, content.length);
  });

  it('skips blank lines between events', () => {
    const content = '{"type":"a"}\n\n{"type":"b"}\n';
    const { events } = parseNewJsonlLines(content, 0);
    assert.deepEqual(events.map(e => e.type), ['a', 'b']);
  });

  it('picks up a completed line on a later call using the returned offset (simulates incremental growth)', () => {
    const step1 = '{"type":"a"}\n{"type":"b","text":"still wri';
    const r1 = parseNewJsonlLines(step1, 0);
    assert.deepEqual(r1.events.map(e => e.type), ['a']);

    const step2 = step1 + 'ting"}\n{"type":"c"}\n';
    const r2 = parseNewJsonlLines(step2, r1.newOffset);
    assert.deepEqual(r2.events.map(e => e.type), ['b', 'c']);
    assert.equal(r2.newOffset, step2.length);
  });
});

describe('extractFinalAssistantText (track 1086 conversation-gap fix)', () => {
  const ev = (o) => JSON.stringify(o);
  const assistantText = (text) => ev({ type: 'assistant', message: { content: [{ type: 'text', text }] } });

  it('returns the LAST assistant text block — the closing summary, not the first narration', () => {
    const log = [
      assistantText('Let me look at the files first.'),
      ev({ type: 'system', subtype: 'hook_started' }),
      assistantText('All phases complete. Summary: added the endpoint and 3 tests.'),
      ev({ type: 'result', subtype: 'success' }),
    ].join('\n');
    assert.equal(
      extractFinalAssistantText(log),
      'All phases complete. Summary: added the endpoint and 3 tests.'
    );
  });

  it('returns null when there is no assistant text at all (non-claude / empty logs)', () => {
    assert.equal(extractFinalAssistantText(''), null);
    assert.equal(extractFinalAssistantText(ev({ type: 'system', subtype: 'init' })), null);
    assert.equal(extractFinalAssistantText('plain text log, not jsonl at all'), null);
  });

  it('truncates long finals with a marker, never mid-line silently', () => {
    const long = 'x'.repeat(5000);
    const out = extractFinalAssistantText(assistantText(long), 2000);
    assert.ok(out.length <= 2100);
    assert.match(out, /\[truncated/);
  });

  it('skips whitespace-only text blocks when picking the final', () => {
    const log = [assistantText('Real summary.'), assistantText('   \n  ')].join('\n');
    assert.equal(extractFinalAssistantText(log), 'Real summary.');
  });
});
