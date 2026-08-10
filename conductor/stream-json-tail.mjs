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
