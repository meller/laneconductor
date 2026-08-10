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

  it('ignores non-renderable event types (system, stream_event, result, rate_limit_event)', () => {
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
      expect(state).toBe(start); // no-op: same reference, nothing appended
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
