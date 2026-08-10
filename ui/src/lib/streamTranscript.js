// ui/src/lib/streamTranscript.js
// Track 1087 Phase 3: reduces claude's stream-json events into renderable
// transcript blocks. Pure/no React dependency, so it can be unit tested
// directly and reused by both the live WS feed and a full-log reconstruction
// on panel load (Phase 4).
//
// One `assistant` event = one *completed* content block (not a cumulative
// full-message snapshot) — confirmed against the real CLI, not guessed (see
// streamTranscript.test.js's header comment).

export function createTranscriptState() {
  return { blocks: [] };
}

export function reduceStreamEvent(state, rawEvent) {
  if (!rawEvent || typeof rawEvent !== 'object') return state;

  if (rawEvent.type === 'assistant' && rawEvent.message?.content) {
    const newBlocks = [];
    for (const item of rawEvent.message.content) {
      if (item.type === 'text' && item.text) {
        newBlocks.push({ kind: 'text', role: 'assistant', text: item.text });
      } else if (item.type === 'tool_use') {
        newBlocks.push({ kind: 'tool_use', id: item.id, name: item.name, input: item.input, result: null });
      }
      // 'thinking' and any other content types are intentionally not
      // rendered — Task 1's scope is assistant text + tool calls.
    }
    if (newBlocks.length === 0) return state;
    return { blocks: [...state.blocks, ...newBlocks] };
  }

  if (rawEvent.type === 'user' && rawEvent.message?.content) {
    let changed = false;
    const blocks = state.blocks.map(block => {
      if (block.kind !== 'tool_use' || block.result) return block;
      const match = rawEvent.message.content.find(
        item => item.type === 'tool_result' && item.tool_use_id === block.id
      );
      if (!match) return block;
      changed = true;
      return { ...block, result: { content: match.content, isError: !!match.is_error } };
    });
    return changed ? { blocks } : state;
  }

  return state; // system/stream_event/result/rate_limit_event/etc — not rendered
}
