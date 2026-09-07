// ui/src/lib/streamTranscript.js
// Track 1087 Phase 3: reduces claude's stream-json events into renderable
// transcript blocks. Pure/no React dependency, so it can be unit tested
// directly and reused by both the live WS feed and a full-log reconstruction
// on panel load (Phase 4).
//
// One `assistant` event = one *completed* content block (not a cumulative
// full-message snapshot) — confirmed against the real CLI, not guessed (see
// streamTranscript.test.js's header comment).
//
// Track 10069 Phase 2 (REQ-20..REQ-24): the same reducer additionally
// tracks a `turn` object — elapsed/token/activity affordances — from event
// types that were previously discarded entirely (the final `return state`
// below). `blocks` behaviour is unchanged; `turn` is derived alongside it.

function initialTurn() {
  return {
    active: false,
    startedAt: null,
    lastEventAt: null,
    outputTokens: 0,
    contextTokens: null,
    activity: null,
    model: null,
    sessionId: null,
  };
}

export function createTranscriptState() {
  return { blocks: [], turn: initialTurn() };
}

// Folds one stream-json event into `turn`. Events with no timestamp of
// their own (system/stream_event) are stamped with the injected `now`;
// `assistant`/`user` events carry a real `timestamp` field and use that
// instead, so lastEventAt reflects the CLI's own clock where available.
function reduceTurn(turn, rawEvent, now) {
  const touch = (patch) => ({
    ...turn,
    ...patch,
    active: true,
    startedAt: turn.startedAt ?? now,
    lastEventAt: now,
  });

  if (rawEvent.type === 'system' && rawEvent.subtype === 'init') {
    return touch({ model: rawEvent.model ?? turn.model, sessionId: rawEvent.session_id ?? turn.sessionId });
  }
  if (rawEvent.type === 'system' && rawEvent.subtype === 'status') {
    return touch({ activity: rawEvent.status ?? turn.activity });
  }
  if (rawEvent.type === 'system' && rawEvent.subtype === 'thinking_tokens') {
    return touch({ activity: 'Thinking…' });
  }
  if (rawEvent.type === 'stream_event') {
    const inner = rawEvent.event;
    if (inner?.type === 'message_delta' && typeof inner.usage?.output_tokens === 'number') {
      return touch({ outputTokens: inner.usage.output_tokens });
    }
    if (inner?.type === 'content_block_start' && inner.content_block?.type === 'tool_use') {
      return touch({ activity: inner.content_block.name ?? turn.activity });
    }
    return turn;
  }
  if (rawEvent.type === 'assistant') {
    const eventNow = rawEvent.timestamp ? Date.parse(rawEvent.timestamp) : now;
    const usage = rawEvent.message?.usage;
    const cacheRead = usage?.cache_read_input_tokens;
    const cacheCreation = usage?.cache_creation_input_tokens;
    const hasContext = typeof cacheRead === 'number' || typeof cacheCreation === 'number';
    return {
      ...turn,
      active: true,
      startedAt: turn.startedAt ?? eventNow,
      lastEventAt: eventNow,
      contextTokens: hasContext ? (cacheRead || 0) + (cacheCreation || 0) : turn.contextTokens,
    };
  }
  if (rawEvent.type === 'result') {
    return { ...turn, active: false };
  }
  return turn;
}

export function reduceStreamEvent(state, rawEvent, now = Date.now()) {
  if (!rawEvent || typeof rawEvent !== 'object') return state;

  const turn = reduceTurn(state.turn ?? initialTurn(), rawEvent, now);

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
    if (newBlocks.length === 0) return { blocks: state.blocks, turn };
    return { blocks: [...state.blocks, ...newBlocks], turn };
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
    return changed ? { blocks, turn } : { blocks: state.blocks, turn };
  }

  if (turn !== state.turn) return { blocks: state.blocks, turn };
  return state; // system/stream_event/result/rate_limit_event/etc with no turn change either — not rendered
}
