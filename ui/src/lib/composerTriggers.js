// ui/src/lib/composerTriggers.js
// Track 10080: pure trigger-detection and text-insertion logic for the
// Chat composer's autocomplete menus. No DOM, no React — unit-testable in
// isolation and shared only by ui/src/lib/useComposerAutocomplete.js.
//
// Trigger grammar (spec.md "Trigger grammar"): a trigger is only
// recognised when its character begins a token — position 0, or preceded
// by whitespace. `@track:` is an explicit alias so the bare `@` prefix
// stays unambiguous (`@tracker.js` must open the file menu, not tracks).
// `/` is restricted to position 0 so a path like `@src/lib` never opens
// the command menu on its embedded `/`.

const TRACK_ALIAS_PREFIX = '@track:';

/**
 * @param {string} value - the composer's full text
 * @param {number} caret - caret position (chars to the left of the cursor)
 * @returns {null | { kind: 'file' | 'track' | 'command', query: string, start: number, end: number }}
 */
export function detectTrigger(value, caret) {
  const upToCaret = value.slice(0, caret);

  let tokenStart = 0;
  for (let i = upToCaret.length - 1; i >= 0; i--) {
    if (/\s/.test(upToCaret[i])) {
      tokenStart = i + 1;
      break;
    }
  }

  const token = upToCaret.slice(tokenStart);
  if (token.length === 0) return null;

  const triggerChar = token[0];

  if (triggerChar === '/') {
    if (tokenStart !== 0) return null;
    return { kind: 'command', query: token.slice(1), start: tokenStart, end: caret };
  }

  if (triggerChar === '#') {
    return { kind: 'track', query: token.slice(1), start: tokenStart, end: caret };
  }

  if (triggerChar === '@') {
    if (token.startsWith(TRACK_ALIAS_PREFIX)) {
      return { kind: 'track', query: token.slice(TRACK_ALIAS_PREFIX.length), start: tokenStart, end: caret };
    }
    return { kind: 'file', query: token.slice(1), start: tokenStart, end: caret };
  }

  return null;
}

/**
 * Replaces only the trigger token (`trigger.start`..`trigger.end`) with
 * `insertText`, leaving the rest of the input intact, and appends exactly
 * one trailing space (REQ-19) — never two, even when `insertText` already
 * carries one (REQ-23) or the text following the trigger already starts
 * with whitespace.
 */
export function applyCompletion(value, trigger, insertText) {
  const before = value.slice(0, trigger.start);
  const after = value.slice(trigger.end);
  const clean = insertText.replace(/\s+$/, '');
  const hasLeadingSpace = /^\s/.test(after);

  const newValue = hasLeadingSpace
    ? before + clean + after
    : before + clean + ' ' + after;
  const caret = before.length + clean.length + 1;

  return { value: newValue, caret };
}
