// REQ-13: conversation.md turns. The sync parser recognises only `> **author**: ...` plus
// `>`-prefixed continuation lines, so a malformed block is silently dropped by it. The block is
// therefore checked against that same parser BEFORE anything is written.
import { parseConversationComments } from '../../conductor/sync-conversation-utils.mjs';
import { fail } from './errors.mjs';

export const CONVERSATION_AUTHORS = ['human', 'claude', 'gemini', 'system'];
export const MAX_BODY_CHARS = 20_000;

export function parseEntries(content) {
  return parseConversationComments(content).map(({ author, body }) => ({ author, body }));
}

/** Non-blank lines outside any turn, ignoring markdown headings (they are the file's own title). */
export function countUnparsedLines(content) {
  let n = 0;
  let inTurn = false;
  for (const line of content.split('\n')) {
    if (line.startsWith('>')) {
      inTurn = true;
    } else if (line.trim() !== '') {
      inTurn = false;
      if (!/^#{1,6} /.test(line)) n++;
    }
  }
  return n;
}

// The parser trims leading whitespace of continuation lines (`slice(2).trimStart()`), so that is
// the body it will hand back; compare against that, not the raw input.
function expectedBody(body) {
  const [first, ...rest] = body.split('\n');
  return [first, ...rest.map((l) => l.trimStart())].join('\n');
}

export function formatTurn(author, rawBody) {
  if (!CONVERSATION_AUTHORS.includes(author)) {
    throw fail('VALIDATION_FAILED', `Unknown author ${JSON.stringify(author)}`, { hint: `Use one of: ${CONVERSATION_AUTHORS.join(', ')}.` });
  }
  if (typeof rawBody !== 'string' || rawBody.trim() === '') {
    throw fail('VALIDATION_FAILED', 'Conversation body is empty');
  }
  if (rawBody.length > MAX_BODY_CHARS) {
    throw fail('VALIDATION_FAILED', `Conversation body is ${rawBody.length} characters; the limit is ${MAX_BODY_CHARS}`, { hint: 'Put long material in spec.md and link to it from a short comment.' });
  }
  if (/^>\s*\*\*/.test(rawBody)) {
    throw fail('VALIDATION_FAILED', 'Body is already formatted as a turn (starts with "> **")', { hint: 'Pass the plain message text only. The connector adds the "> **author**:" prefix and the ">" on every line.' });
  }
  const body = rawBody.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
  const lines = body.split('\n');
  const block = [`> **${author}**: ${lines[0]}`, ...lines.slice(1).map((l) => (l === '' ? '>' : `> ${l}`))].join('\n');
  const parsed = parseConversationComments(block);
  if (parsed.length !== 1 || parsed[0].author !== author || parsed[0].body !== expectedBody(body)) {
    throw fail('VALIDATION_FAILED', `The formatted block would not parse back as a single "${author}" turn (found ${parsed.length} turn${parsed.length === 1 ? '' : 's'}${parsed.length > 1 ? `, authors ${parsed.map((p) => p.author).join(', ')}` : ''})`, {
      hint: 'A body line shaped like "**human**: ..." starts a new turn for the parser. Rephrase that line or indent it.',
    });
  }
  return block;
}

/** Returns the new file content with one turn appended (blank line between turns, trailing newline). */
export function appendTurn(existing, author, body) {
  const block = formatTurn(author, body);
  if (existing === '') return `${block}\n`;
  const base = existing.endsWith('\n') ? existing : `${existing}\n`;
  const sep = /(^|\n)\n$/.test(base) ? '' : '\n';
  return `${base}${sep}${block}\n`;
}
