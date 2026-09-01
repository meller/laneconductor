#!/usr/bin/env node
// conductor/stream-json-tail.mjs
// Track 1087 Phase 2: incremental JSONL tailing for claude's stream-json
// output (see claude-cli-args.mjs, Phase 1). Reads only the bytes appended
// since the last check rather than re-reading the whole log file, and holds
// back any trailing line that hasn't been fully written yet — the next call
// picks it up once it's complete.

export function parseNewJsonlLines(content, previousOffset = 0) {
  const chunk = content.slice(previousOffset);
  const lastNewline = chunk.lastIndexOf('\n');
  if (lastNewline === -1) return { events: [], newOffset: previousOffset };

  const complete = chunk.slice(0, lastNewline);
  const newOffset = previousOffset + lastNewline + 1;

  const events = [];
  for (const line of complete.split('\n')) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // Malformed line — skip it but keep advancing; the UI's raw-<pre>
      // fallback (Phase 3) is for non-Claude CLIs, not for tolerating a
      // corrupted claude stream-json line here.
    }
  }
  return { events, newOffset };
}

// Track 1086 (conversation-gap fix, 2026-08-12): pull the run's closing
// assistant message out of a full stream-json log, so conversation.md can
// carry the actual response instead of only "PASS (exit 0)". The LAST
// non-empty assistant text block is the one that matters — it's the
// closing summary; earlier blocks are working narration. Returns null for
// logs with no assistant text at all (non-claude CLIs, empty/killed runs),
// letting the caller fall back to the terse line alone.
// Track 10047 (REQ-2): the token measurement resolveTrackSession's cap
// decision needs, taken from the same stream-json log spawnCli already
// reads at its exit handler. MUST read `assistant` events only, never
// `result` events — a `result` event's `cache_read_input_tokens` is a
// CUMULATIVE sum across every turn in the run, not the current context
// size (confirmed on a real log: 2,152,229 on the result event vs a true
// 148,710 on the final assistant event, a 14x difference). Reading it
// would trip any cap threshold on the very first measurement. Mirrors
// extractFinalAssistantText's last-assistant-wins shape and malformed-line
// tolerance immediately above.
export function extractSessionContextTokens(logContent) {
  if (!logContent) return null;
  let final = null;
  for (const line of logContent.split('\n')) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e?.type !== 'assistant') continue;
    const usage = e.message?.usage;
    if (!usage) continue;
    const cacheRead = usage.cache_read_input_tokens;
    const cacheCreation = usage.cache_creation_input_tokens;
    if (typeof cacheRead !== 'number' && typeof cacheCreation !== 'number') continue;
    final = (cacheRead || 0) + (cacheCreation || 0);
  }
  return final;
}

export function extractFinalAssistantText(logContent, maxChars = 2000) {
  if (!logContent) return null;
  let final = null;
  for (const line of logContent.split('\n')) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e?.type !== 'assistant') continue;
    for (const c of e.message?.content ?? []) {
      if (c?.type === 'text' && typeof c.text === 'string' && c.text.trim()) {
        final = c.text.trim();
      }
    }
  }
  if (final === null) return null;
  if (final.length > maxChars) {
    final = final.slice(0, maxChars) + `\n[truncated — full transcript in the track's log]`;
  }
  return final;
}

// Track 10020: a dispatched lane action can end its turn on a genuine
// blocking question (e.g. "should I apply this DB migration?") instead of
// finishing the work — the CLI harness records this as a `post_turn_summary`
// system event with `status_category: 'blocked'`, but nothing previously
// read that event. Left alone, the question sits stranded in the raw
// transcript: it's never posted to conversation.md/track_comments (the only
// path a human reply flows through), and the Inbox's bucket logic — driven
// entirely by track_comments — confidently classifies the track as
// "awaiting_ai" (nothing needed from you) when a human decision is actually
// pending. The LAST post_turn_summary is the one that matters, mirroring
// extractFinalAssistantText's same "most recent wins" reasoning above.
export function extractBlockedQuestion(logContent) {
  if (!logContent) return null;
  let blocked = null;
  for (const line of logContent.split('\n')) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e?.type !== 'system' || e?.subtype !== 'post_turn_summary') continue;
    blocked = e.status_category === 'blocked' ? (e.status_detail || '').trim() || null : null;
  }
  return blocked;
}
