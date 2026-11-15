import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTurn, appendTurn, parseEntries, countUnparsedLines, CONVERSATION_AUTHORS } from '../src/conversation.mjs';
import { parseConversationComments } from '../../conductor/sync-conversation-utils.mjs';

// TC-2.4
test('multi-line body with blank lines and ## headers: every line prefixed, parses back as one entry', () => {
  const body = 'First line\n\n## A header\n\n- item\n\nlast';
  const block = formatTurn('claude', body);
  assert.ok(block.split('\n').every((l) => l.startsWith('>')), block);
  assert.equal(block.split('\n')[0], '> **claude**: First line');
  const parsed = parseConversationComments(block);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].author, 'claude');
  assert.equal(parsed[0].body, body);
});

// TC-2.5
test('a body that already starts with > ** is rejected with a hint', () => {
  assert.throws(() => formatTurn('claude', '> **claude**: hi'), (e) => e.code === 'VALIDATION_FAILED' && /pre-formatted|plain/i.test(e.hint ?? e.message));
});

test('a body line that would parse as a new turn is rejected (it would split the entry)', () => {
  assert.throws(() => formatTurn('claude', 'intro\n**human**: sneaky'), (e) => e.code === 'VALIDATION_FAILED' && /turn|author/i.test(e.message));
});

test('empty, whitespace-only, over-long and unknown-author inputs are rejected', () => {
  assert.throws(() => formatTurn('claude', '   \n'), { code: 'VALIDATION_FAILED' });
  assert.throws(() => formatTurn('claude', 'x'.repeat(20_001)), { code: 'VALIDATION_FAILED' });
  assert.throws(() => formatTurn('bob', 'hi'), { code: 'VALIDATION_FAILED' });
  assert.deepEqual(CONVERSATION_AUTHORS, ['human', 'claude', 'gemini', 'system']);
});

test('appendTurn separates turns with a blank line and ends with a newline', () => {
  const a = appendTurn('', 'claude', 'one');
  assert.equal(a, '> **claude**: one\n');
  const b = appendTurn(a, 'human', 'two\nthree');
  assert.equal(b, '> **claude**: one\n\n> **human**: two\n> three\n');
  assert.deepEqual(parseEntries(b).map((e) => [e.author, e.body]), [['claude', 'one'], ['human', 'two\nthree']]);
});

test('appendTurn keeps a header and tolerates a missing trailing newline', () => {
  const header = '# Conversation: Track 1\n\n';
  const out = appendTurn(header, 'system', 'hello');
  assert.equal(out, `${header}> **system**: hello\n`);
  const out2 = appendTurn('# C\n\n> **claude**: x', 'human', 'y');
  assert.deepEqual(parseEntries(out2).map((e) => e.author), ['claude', 'human']);
});

test('countUnparsedLines counts prose outside turns and ignores headings', () => {
  const content = '# Title\n\n> **claude**: a\n\nloose prose\n\n> **human**: b\n';
  assert.equal(countUnparsedLines(content), 1);
});
