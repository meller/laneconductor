// ui/src/lib/useComposerAutocomplete.js
// Track 10080 Phase 3: headless autocomplete state for the Chat composer.
// Owns trigger detection, the three item sources (files/tracks/commands),
// keyboard navigation and the accept/dismiss lifecycle — the composer
// component itself only needs to render `items` and call `onKeyDown`.
//
// File results come from a debounced GET /api/projects/:id/files call
// (REQ-14) using the same tested pattern as ConnectionsStep.jsx's
// credential check: a setTimeout, a `cancelled` flag, and a clearTimeout
// cleanup. The `cancelled` flag also discards a stale in-flight response
// that resolves after a newer keystroke (no AbortController needed).
// Track and command results are filtered client-side with no request
// (REQ-15, REQ-16), since ChatView already holds the full track list and
// SLASH_COMMANDS is static data.

import { useEffect, useState } from 'react';
import { detectTrigger, applyCompletion } from './composerTriggers.js';
import { fuzzyRank } from '../../../conductor/services/fuzzy-match.mjs';
import { SLASH_COMMANDS, commandInsertText } from '../../../conductor/services/slash-commands.mjs';

const FILE_DEBOUNCE_MS = 200;
const ITEM_LIMIT = 20;

function buildFileItems(paths) {
  return paths.map(path => ({ id: path, label: path, insertText: path }));
}

function buildTrackItems(tracks, query) {
  const ranked = fuzzyRank(tracks, query, {
    limit: ITEM_LIMIT,
    key: t => `${t.track_number} ${t.title ?? ''}`,
  });
  return ranked.map(t => ({
    id: String(t.track_number),
    label: `#${t.track_number}${t.title ? ` — ${t.title}` : ''}`,
    insertText: `#${t.track_number}`,
  }));
}

function buildCommandItems(query) {
  const ranked = fuzzyRank(SLASH_COMMANDS, query, { limit: ITEM_LIMIT, key: c => c.name });
  return ranked.map(cmd => ({
    id: cmd.name,
    label: `/laneconductor ${cmd.name}${cmd.args ? ` ${cmd.args}` : ''}`,
    description: cmd.description,
    insertText: commandInsertText(cmd),
  }));
}

/**
 * @param {object} opts
 * @param {string} opts.value - the composer's current text
 * @param {number} opts.caret - caret position within `value`
 * @param {number|string} opts.projectId
 * @param {Array} opts.tracks - the project's track list ({ track_number, title })
 * @param {(path: string, opts?: object) => Promise<Response>} opts.apiFetch
 */
export function useComposerAutocomplete({ value, caret, projectId, tracks = [], apiFetch }) {
  const trigger = detectTrigger(value, caret);
  const triggerToken = trigger ? value.slice(trigger.start, trigger.end) : null;

  // REQ-20: Escape is a real dismissal, not a one-frame flicker — it stays
  // dismissed until the trigger token itself changes (more typing, or the
  // trigger moves/disappears), at which point a fresh trigger is allowed
  // to open again.
  const [dismissedToken, setDismissedToken] = useState(null);
  const isDismissed = trigger !== null && dismissedToken === triggerToken;
  const activeTrigger = isDismissed ? null : trigger;

  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => {
    setActiveIndex(0);
  }, [activeTrigger?.kind, activeTrigger?.query]);

  const [fileState, setFileState] = useState({ paths: [], source: null, loading: false });

  // REQ-14: debounced file search — a burst of keystrokes issues one
  // request, and a stale response arriving after a newer keystroke is
  // discarded via the `cancelled` flag.
  useEffect(() => {
    if (!activeTrigger || activeTrigger.kind !== 'file' || !projectId || !apiFetch) {
      return undefined;
    }
    let cancelled = false;
    setFileState(prev => ({ ...prev, loading: true }));
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: activeTrigger.query, limit: String(ITEM_LIMIT) });
      apiFetch(`/api/projects/${projectId}/files?${params.toString()}`)
        .then(res => (res && res.ok ? res.json() : null))
        .then(data => {
          if (cancelled) return;
          setFileState({ paths: data?.files?.map(f => f.path) ?? [], source: data?.source ?? 'none', loading: false });
        })
        .catch(() => {
          if (!cancelled) setFileState({ paths: [], source: 'none', loading: false });
        });
    }, FILE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeTrigger?.kind, activeTrigger?.query, projectId, apiFetch]);

  let items = [];
  let emptyReason = null;
  if (activeTrigger?.kind === 'file') {
    items = buildFileItems(fileState.paths);
    if (items.length === 0 && !fileState.loading) {
      emptyReason = fileState.source === 'none' ? 'unavailable' : 'no-matches';
    }
  } else if (activeTrigger?.kind === 'track') {
    items = buildTrackItems(tracks, activeTrigger.query);
    if (items.length === 0) emptyReason = 'no-matches';
  } else if (activeTrigger?.kind === 'command') {
    items = buildCommandItems(activeTrigger.query);
    if (items.length === 0) emptyReason = 'no-matches';
  }

  const isOpen = activeTrigger !== null;

  function accept(index = activeIndex) {
    const item = items[index];
    if (!item || !trigger) return null;
    setDismissedToken(null);
    return applyCompletion(value, trigger, item.insertText);
  }

  function dismiss() {
    if (trigger) setDismissedToken(triggerToken);
  }

  // Returns true when the key was handled by the menu (caller must not
  // also treat it as a normal composer keystroke — e.g. Enter submitting).
  function onKeyDown(e) {
    if (!isOpen) return false;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (items.length > 0) setActiveIndex(i => (i + 1) % items.length);
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length > 0) setActiveIndex(i => (i - 1 + items.length) % items.length);
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      return true; // caller checks the return value of accept() itself if needed
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      dismiss();
      return true;
    }
    return false;
  }

  return {
    isOpen,
    kind: activeTrigger?.kind ?? null,
    items,
    activeIndex,
    setActiveIndex,
    emptyReason,
    accept,
    dismiss,
    onKeyDown,
  };
}
