// Pure conversation.md parsing helper used by syncConversation (FS→DB
// direction) in laneconductor.sync.mjs. Extracted so it's unit-testable
// without importing that file's side effects (chokidar watchers,
// setIntervals, run at module load) — same move as sync-timestamp-utils.mjs
// and deploy-runner.mjs.

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
    if (m) {
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
    } else if (current && line.startsWith('>') && !m) {
      // A continuation line — anything starting with '>' that ISN'T itself
      // a new `> **author**: body` turn (already checked above via `m`).
      // Previously this excluded any line starting with "> **", which also
      // caught quoted content with its own bold sub-headers (e.g. pasted
      // contract clauses like "> **1.1 Role.** ...") and silently
      // truncated the comment there.
      current.body += '\n' + line.slice(2).trimStart();
    } else if (current && line.trim() !== '') {
      comments.push(current);
      current = null;
    }
  }
  if (current) comments.push(current);
  return comments;
}
