// Pure conversation.md parsing helper used by syncConversation (FS→DB
// direction) in laneconductor.sync.mjs. Extracted so it's unit-testable
// without importing that file's side effects (chokidar watchers,
// setIntervals, run at module load) — same move as sync-timestamp-utils.mjs
// and deploy-runner.mjs.

import { PROVIDER_IDS } from './providers.mjs';

// The bounded vocabulary of real turn authors (see this skill's own
// "Protocol: conversation.md Format": human/claude/gemini/system, extended
// to the full provider registry). A `> **Word**: ...` line only starts a
// new turn when `Word` is one of these — anything else (e.g. a structured
// completion report's own `**Result**: PASS` or `**Verdict**: FAIL` line)
// is prose inside the current turn, not a new author. Track 10072: without
// this check, any reply whose body contained a bold label on its own
// `>`-prefixed line got split mid-body, and the label word (unrecognized)
// fell back to `author: 'human'` server-side — silently minting a brand
// new, permanently-unreplied fake human comment out of the AI's own review
// text. Confirmed live: a `gemini` review comment ending in
// `> **Result**: PASS` produced a second DB row, `author: 'human',
// body: 'PASS'`, tripping the badge with nothing actually waiting.
const KNOWN_TURN_AUTHORS = new Set(['human', 'system', ...PROVIDER_IDS]);

// Parses `> **author** (options): body` turn blocks out of new
// conversation.md content. Content that doesn't match this format (e.g. a
// narrative document with section headers and plain blockquotes, not
// turn markers) yields an empty array — callers must treat "non-empty
// input, zero comments out" as worth reporting, not silently discarding;
// see laneconductor.sync.mjs's syncConversation for that check.
export function parseConversationComments(newContent) {
  const lines = newContent.split('\n');
  const comments = [];
  let current = null;
  for (const line of lines) {
    // Matches: > **human**: Hello
    // Matches: > **human** (no-wake): Hello
    const m = line.match(/^> \*\*(\w+)\*\*(?:\s*\(([^)]+)\))?: (.*)$/);
    const isTurnStart = m && KNOWN_TURN_AUTHORS.has(m[1].toLowerCase());
    if (isTurnStart) {
      if (current) comments.push(current);
      const options = m[2] ? m[2].toLowerCase() : '';
      current = {
        author: m[1],
        body: m[3],
        no_wake: options.includes('no-wake') || options.includes('no-reply') || options.includes('note'),
        is_brainstorm: options.includes('brainstorm'),
        is_replan: options.includes('replan') || options.includes('plan'),
        is_bug: options.includes('bug')
      };
    } else if (current && line.startsWith('>')) {
      // A continuation line — anything starting with '>' that ISN'T a
      // recognized turn start (checked above). Previously this excluded
      // any line starting with "> **", which also caught quoted content
      // with its own bold sub-headers (e.g. pasted contract clauses like
      // "> **1.1 Role.** ...") and silently truncated the comment there;
      // then, once that was loosened to "isn't itself a turn" (any `> **X**:`
      // shape), it over-corrected the other way and started treating bold
      // labels like `> **Result**: PASS` as new turns instead — see
      // KNOWN_TURN_AUTHORS above.
      current.body += '\n' + line.slice(2).trimStart();
    } else if (current && line.trim() !== '') {
      comments.push(current);
      current = null;
    }
  }
  if (current) comments.push(current);
  return comments;
}

// Byte offset of each top-level `> **author**: ...` turn's start line within
// `content`. Used to seed a fresh sync cursor from the DB's existing comment
// count (see laneconductor.sync.mjs's seedCursorFromDB): the Nth offset is
// exactly where content.slice() should resume so parseConversationComments
// picks up cleanly at a turn boundary instead of splitting one mid-body.
// Must recognize turn starts identically to parseConversationComments
// (same KNOWN_TURN_AUTHORS gate) or the two functions disagree on where
// turn N begins, misseeding the cursor.
export function findTurnStartOffsets(content) {
  const lines = content.split('\n');
  const offsets = [];
  let pos = 0;
  for (const line of lines) {
    const m = line.match(/^> \*\*(\w+)\*\*(?:\s*\(([^)]+)\))?: /);
    if (m && KNOWN_TURN_AUTHORS.has(m[1].toLowerCase())) offsets.push(pos);
    pos += line.length + 1; // +1 for the '\n' consumed by split
  }
  return offsets;
}
