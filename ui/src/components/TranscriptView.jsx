import React, { useState } from 'react';

// Track 1087 Phase 3: renders the blocks produced by
// ui/src/lib/streamTranscript.js's reducer — assistant text as chat-style
// blocks, tool calls as collapsible entries (name + input summary, expands
// to full input/result). Fallback for non-Claude CLI runs is the existing
// raw <pre> block already used by the Logs tab (TrackDetailPanel) — left
// untouched, not duplicated here.

function summarizeInput(input) {
  if (!input || typeof input !== 'object') return '';
  const first = Object.values(input)[0];
  const s = typeof first === 'string' ? first : JSON.stringify(first);
  if (!s) return '';
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
}

function ToolCallBlock({ block }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/60 text-xs overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left text-gray-400 hover:text-gray-200"
      >
        <span className="font-mono w-3 shrink-0">{expanded ? '▾' : '▸'}</span>
        <span className="font-medium text-gray-300 shrink-0">{block.name}</span>
        <span className="truncate text-gray-500">{summarizeInput(block.input)}</span>
        {block.result && (
          <span
            className={`ml-auto shrink-0 px-1.5 py-0.5 rounded text-[10px] ${block.result.isError ? 'bg-red-900 text-red-300' : 'bg-green-900 text-green-300'
              }`}
          >
            {block.result.isError ? 'error' : 'done'}
          </span>
        )}
      </button>
      {expanded && (
        <div className="px-3 pb-2 space-y-2 border-t border-gray-800 pt-2">
          <pre className="whitespace-pre-wrap break-words text-gray-500">
            {JSON.stringify(block.input, null, 2)}
          </pre>
          {block.result && (
            <pre className="whitespace-pre-wrap break-words text-gray-400 border-t border-gray-800 pt-2">
              {typeof block.result.content === 'string'
                ? block.result.content
                : JSON.stringify(block.result.content, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export function TranscriptView({ blocks }) {
  if (!blocks?.length) {
    return <p className="text-gray-600 text-sm italic pt-4">No transcript yet.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {blocks.map((block, i) =>
        block.kind === 'text' ? (
          <div
            key={i}
            className="rounded-lg px-3 py-2 text-sm leading-relaxed bg-orange-950/40 text-gray-200 border border-orange-900/50 whitespace-pre-wrap"
          >
            {block.text}
          </div>
        ) : (
          <ToolCallBlock key={block.id ?? i} block={block} />
        )
      )}
    </div>
  );
}
