// ui/src/lib/streamTranscript.test.js
// Track 1087 Phase 3: reduces claude's stream-json events (Phase 1/2) into
// renderable transcript blocks — assistant text and tool calls, with tool
// results attached once they arrive.
//
// Event shapes below are copied verbatim from real `claude --output-format
// stream-json --include-partial-messages --verbose` runs (see track
// 1087's plan.md Phase 3 notes), not guessed: one `assistant` event per
// *completed content block* (not a cumulative full-message snapshot) — a
// message with a thinking block followed by a tool_use arrives as two
// separate `assistant` events, each with a single-item `content` array.
//
// Run: npx vitest run src/lib/streamTranscript.test.js   (from ui/)

import { describe, it, expect } from 'vitest';
import { createTranscriptState, reduceStreamEvent } from './streamTranscript.js';

describe('reduceStreamEvent', () => {
  it('starts with no blocks', () => {
    expect(createTranscriptState().blocks).toEqual([]);
  });

  it('appends a text block from an assistant text event', () => {
    const event = {
      type: 'assistant',
      message: { id: 'msg_1', content: [{ type: 'text', text: 'Hi' }] },
    };
    const state = reduceStreamEvent(createTranscriptState(), event);
    expect(state.blocks).toEqual([{ kind: 'text', role: 'assistant', text: 'Hi' }]);
  });

  it('appends a tool_use block with result: null from an assistant tool_use event', () => {
    const event = {
      type: 'assistant',
      message: {
        id: 'msg_1',
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'echo hi' } }],
      },
    };
    const state = reduceStreamEvent(createTranscriptState(), event);
    expect(state.blocks).toEqual([
      { kind: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'echo hi' }, result: null },
    ]);
  });

  it('attaches a tool_result to the matching tool_use block by tool_use_id', () => {
    let state = reduceStreamEvent(createTranscriptState(), {
      type: 'assistant',
      message: { id: 'msg_1', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'echo hi' } }] },
    });
    state = reduceStreamEvent(state, {
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'hi', is_error: false }] },
    });
    expect(state.blocks).toEqual([
      { kind: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'echo hi' }, result: { content: 'hi', isError: false } },
    ]);
  });

  it('does not touch unrelated tool_use blocks when a tool_result arrives for a different id', () => {
    let state = reduceStreamEvent(createTranscriptState(), {
      type: 'assistant',
      message: { id: 'msg_1', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: {} }] },
    });
    state = reduceStreamEvent(state, {
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_OTHER', content: 'x', is_error: false }] },
    });
    expect(state.blocks[0].result).toBeNull();
  });

  it('preserves order across a thinking-then-tool_use message split across two assistant events', () => {
    // Real observed shape: the "thinking" block is intentionally not
    // rendered (Task 1 scope is text + tool calls), so only the tool_use
    // block should appear.
    let state = reduceStreamEvent(createTranscriptState(), {
      type: 'assistant',
      message: { id: 'msg_1', content: [{ type: 'thinking', thinking: '...', signature: '...' }] },
    });
    state = reduceStreamEvent(state, {
      type: 'assistant',
      message: { id: 'msg_1', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'echo hi' } }] },
    });
    expect(state.blocks).toEqual([
      { kind: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'echo hi' }, result: null },
    ]);
  });

  it('ignores non-renderable event types for blocks (system, stream_event, result, rate_limit_event)', () => {
    // Track 10069 Phase 2: these event types now feed `turn` (REQ-20), so
    // the returned state object itself is no longer guaranteed reference-
    // identical — `blocks` is the guarantee this test protects.
    const start = createTranscriptState();
    for (const event of [
      { type: 'system', subtype: 'init' },
      { type: 'stream_event', event: { type: 'content_block_delta' } },
      { type: 'result', is_error: false },
      { type: 'rate_limit_event' },
      null,
      { type: 'assistant', message: { id: 'msg_1', content: [] } },
    ]) {
      const state = reduceStreamEvent(start, event);
      expect(state.blocks).toBe(start.blocks); // no-op: same array reference, nothing appended
    }
  });

  it('accumulates blocks across a realistic multi-turn sequence in arrival order', () => {
    let state = createTranscriptState();
    const events = [
      { type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'echo hello-tool-test' } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'hello-tool-test', is_error: false }] } },
      { type: 'assistant', message: { id: 'm2', content: [{ type: 'text', text: 'Output: `hello-tool-test`' }] } },
    ];
    for (const event of events) state = reduceStreamEvent(state, event);

    expect(state.blocks).toEqual([
      { kind: 'tool_use', id: 't1', name: 'Bash', input: { command: 'echo hello-tool-test' }, result: { content: 'hello-tool-test', isError: false } },
      { kind: 'text', role: 'assistant', text: 'Output: `hello-tool-test`' },
    ]);
  });
});

describe('reduceStreamEvent — turn tracking (Track 10069 Phase 2, REQ-20..REQ-24)', () => {
  // Every event below except `system/init` is copied verbatim from a real
  // `claude --output-format stream-json --include-partial-messages --verbose`
  // log captured on this track's own dispatch-plan run
  // (conductor/tracks/AM-10069-.../last_run.log). `system/init` was not
  // present in that particular log (a --resume continuation, which skips
  // it) — its shape here matches the fields this track's own spec.md
  // documented against a real run during planning: session_id, model.

  const INIT = { type: 'system', subtype: 'init', session_id: 'sess-1', model: 'claude-opus-5' };
  const STATUS = { type: 'system', subtype: 'status', status: 'requesting', session_id: 'sess-1', uuid: 'u1' };
  const THINKING = { type: 'system', subtype: 'thinking_tokens', estimated_tokens: 150, estimated_tokens_delta: 100, session_id: 'sess-1', uuid: 'u2' };
  const MESSAGE_DELTA = {
    type: 'stream_event',
    event: { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 617 } },
  };
  const MESSAGE_DELTA_2 = {
    type: 'stream_event',
    event: { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 766 } },
  };
  const TOOL_START = {
    type: 'stream_event',
    event: { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'Bash' } },
  };
  const ASSISTANT_USAGE = {
    type: 'assistant',
    timestamp: '2026-09-06T11:36:18.816Z',
    message: { usage: { input_tokens: 2, cache_creation_input_tokens: 950, cache_read_input_tokens: 174697, output_tokens: 3 } },
  };
  const RESULT = { type: 'result', is_error: false, subtype: 'success' };

  it('TC-2.2: system/init sets active, model and sessionId from the event, not defaulted', () => {
    const state = reduceStreamEvent(createTranscriptState(), INIT, 1000);
    expect(state.turn.active).toBe(true);
    expect(state.turn.model).toBe('claude-opus-5');
    expect(state.turn.sessionId).toBe('sess-1');
  });

  it('TC-2.3: a sequence of message_delta events leaves outputTokens at the LAST value, not a sum', () => {
    let state = createTranscriptState();
    state = reduceStreamEvent(state, MESSAGE_DELTA, 1000);
    state = reduceStreamEvent(state, MESSAGE_DELTA_2, 2000);
    expect(state.turn.outputTokens).toBe(766);
  });

  it('TC-2.4: contextTokens derives from assistant events only; a result event does not change it', () => {
    let state = createTranscriptState();
    state = reduceStreamEvent(state, ASSISTANT_USAGE, 1000);
    expect(state.turn.contextTokens).toBe(174697 + 950);

    state = reduceStreamEvent(state, RESULT, 2000);
    expect(state.turn.contextTokens).toBe(174697 + 950); // unchanged by result
  });

  it('TC-2.5: content_block_start with a tool_use block sets activity to that tool name', () => {
    const state = reduceStreamEvent(createTranscriptState(), TOOL_START, 1000);
    expect(state.turn.activity).toBe('Bash');
  });

  it('TC-2.6: system/status and system/thinking_tokens each change activity; replaying the real log produces >=3 distinct values', () => {
    let state = createTranscriptState();
    const seen = new Set();
    for (const [event, now] of [[STATUS, 1000], [THINKING, 2000], [TOOL_START, 3000]]) {
      state = reduceStreamEvent(state, event, now);
      seen.add(state.turn.activity);
    }
    expect(seen.size).toBeGreaterThanOrEqual(3);
    expect(state.turn.activity).toBe('Bash');
  });

  it('TC-2.7: a terminal result event clears active', () => {
    let state = reduceStreamEvent(createTranscriptState(), STATUS, 1000);
    expect(state.turn.active).toBe(true);
    state = reduceStreamEvent(state, RESULT, 2000);
    expect(state.turn.active).toBe(false);
  });

  it('TC-2.8: a log with no stream-json events yields active:false and zero tokens', () => {
    const state = createTranscriptState();
    expect(state.turn.active).toBe(false);
    expect(state.turn.outputTokens).toBe(0);
    expect(state.turn.contextTokens).toBeNull();
  });

  it('startedAt is set once and does not move on subsequent events', () => {
    let state = reduceStreamEvent(createTranscriptState(), STATUS, 1000);
    expect(state.turn.startedAt).toBe(1000);
    state = reduceStreamEvent(state, THINKING, 5000);
    expect(state.turn.startedAt).toBe(1000);
    expect(state.turn.lastEventAt).toBe(5000);
  });
});
