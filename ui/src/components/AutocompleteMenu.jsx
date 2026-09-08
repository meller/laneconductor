import { useEffect, useRef } from 'react';

// ui/src/components/AutocompleteMenu.jsx
// Track 10080 (REQ-21): presentational menu for the Chat composer's
// @file / #track / /command triggers. Dark surface matching the
// surrounding ChatView conventions (bg-gray-900/border-gray-800/text-gray-200,
// blue accent for the active row), keyboard-reachable without a pointer —
// all keyboard handling lives in useComposerAutocomplete.js; this component
// only renders state and reports pointer selection back up.

const EMPTY_COPY = {
  unavailable: 'File list unavailable on this deployment.',
  'no-matches': 'No matches.',
};

export function AutocompleteMenu({ items, activeIndex, onSelect, emptyReason, kind }) {
  const activeRef = useRef(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (items.length === 0) {
    if (!emptyReason) return null;
    return (
      <div
        className="mb-1.5 rounded border border-gray-800 bg-gray-900 px-3 py-2 text-xs text-gray-500 italic"
        data-testid="autocomplete-empty"
        data-empty-reason={emptyReason}
      >
        {EMPTY_COPY[emptyReason] ?? 'No matches.'}
      </div>
    );
  }

  return (
    <div
      className="mb-1.5 max-h-56 overflow-y-auto rounded border border-gray-800 bg-gray-900"
      data-testid="autocomplete-menu"
      data-kind={kind}
    >
      {items.map((item, index) => {
        const active = index === activeIndex;
        return (
          <button
            key={item.id}
            type="button"
            ref={active ? activeRef : null}
            onMouseDown={e => e.preventDefault()}
            onClick={() => onSelect(index)}
            data-testid="autocomplete-item"
            data-active={active}
            className={`flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left text-xs ${active ? 'bg-blue-600 text-white' : 'text-gray-200 hover:bg-gray-800'
              }`}
          >
            <span className="font-mono truncate w-full">{item.label}</span>
            {item.description && (
              <span className={`text-[11px] truncate w-full ${active ? 'text-blue-100' : 'text-gray-500'}`}>
                {item.description}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
