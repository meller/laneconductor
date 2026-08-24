#!/usr/bin/env node
// conductor/conversation-tail.mjs
// Track 10020: a resumed Claude session (Track 1086's persistent-session
// design) deliberately skips full context re-injection — including
// conversation.md — to avoid the redundant-reload cost of re-sending
// everything on every turn. But that leaves it with NO reliable way to
// learn a human posted something new since its last turn: it only finds
// out if it happens to re-check the file on its own initiative, which is
// exactly the inconsistency observed live on track 1102 (some resumed
// turns noticed a new human note, most didn't).
//
// extractUnansweredHumanTail() gives spawnCli a small, targeted signal to
// inject even on a resumed session, without reintroducing the full reload:
// the trailing run of consecutive `> **human**...` entries at the end of
// conversation.md — i.e. exactly the human messages nothing has responded
// to yet. Every entry's lines are all `>`-prefixed (the conversation.md
// format's own convention — see spawnCli's session-turn append comment),
// and entries are separated by a blank line, so splitting on blank-line
// runs reliably yields one block per entry without needing a full markdown
// parser.

export function extractUnansweredHumanTail(conversationContent) {
  if (!conversationContent) return null;
  const blocks = conversationContent.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  const trailingHuman = [];
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (/^>\s*\*\*human\*\*/i.test(blocks[i])) {
      trailingHuman.unshift(blocks[i]);
    } else {
      break;
    }
  }
  return trailingHuman.length ? trailingHuman.join('\n\n') : null;
}
