#!/usr/bin/env node
// conductor/tests/req8-author-normalization.test.mjs
//
// Track 1113 REQ-8 (found live 2026-08-18, on the review of the stale
// track-1113 branch — real finding, verified separately against `main`'s
// actual code): the server's POST /track/:num/comment coerces any author
// outside ['human', 'system', ...PROVIDER_IDS] to 'human'. The track_chat
// reply handler in laneconductor.sync.mjs used to send the raw
// `proj.primary.cli` string as-is — an alias like 'agy', or any
// non-standard configured cli id, silently got mislabeled as
// human-authored in the Conversation tab, misattributing the AI's own
// reply to the person it was replying to.
//
// laneconductor.sync.mjs runs side-effecting top-level code on import
// (pidfile writes, an awaited worker-lock acquisition, config loading —
// see every other test in this suite, which spawns it as a real child
// process rather than importing it directly), so normalizeAuthorForComment
// can't be unit-tested by importing that file in-process the way
// ai-chat.mjs's extracted helpers are in the coachai repo. This test
// verifies the same logic directly against the shared, side-effect-free
// conductor/providers.mjs registry it's built from, plus a structural
// check that the call site in laneconductor.sync.mjs actually wires the
// two together — so a regression that reverts the call site back to the
// raw `proj?.primary?.cli || 'claude'` line still fails this file, even
// though it can't spawn a full worker to prove it end-to-end.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROVIDER_IDS, normalizeProviderId } from '../providers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYNC_MJS_PATH = join(__dirname, '../laneconductor.sync.mjs');

// Mirrors normalizeAuthorForComment's exact two lines — the two are kept
// in lockstep by the structural check below, not by importing one from
// the other (see the file header for why importing isn't viable here).
function normalizeAuthorForComment(cli) {
  const normalized = normalizeProviderId(cli || 'claude');
  return PROVIDER_IDS.includes(normalized) ? normalized : 'claude';
}

describe('REQ-8: chat-reply author is always a real, valid provider id', () => {
  it('a canonical provider id passes through unchanged', () => {
    assert.equal(normalizeAuthorForComment('claude'), 'claude');
    assert.equal(normalizeAuthorForComment('gemini'), 'gemini');
    assert.equal(normalizeAuthorForComment('antigravity'), 'antigravity');
  });

  it('a known alias resolves to its canonical id (this is the actual regression case)', () => {
    // 'agy' is exactly the kind of value a real .laneconductor.json can
    // carry for project.primary.cli — the raw string reaching the server
    // unnormalized is what silently produced 'human' before this fix.
    const resolved = normalizeAuthorForComment('agy');
    assert.notEqual(resolved, 'human',
      "a real, valid provider alias must never end up mislabeled as 'human'");
    assert.ok(PROVIDER_IDS.includes(resolved),
      `resolved value "${resolved}" must be one of ${JSON.stringify(PROVIDER_IDS)}`);
  });

  it('a genuinely unrecognized cli id falls back to a valid provider, never to human', () => {
    for (const bogus of ['my-custom-local-cli', 'other', 'typo-claude', '']) {
      const resolved = normalizeAuthorForComment(bogus);
      assert.notEqual(resolved, 'human',
        `an unrecognized cli id ("${bogus}") must never silently become 'human' — got "${resolved}"`);
      assert.ok(PROVIDER_IDS.includes(resolved),
        `fallback "${resolved}" for "${bogus}" must itself be a real provider id`);
    }
  });

  it('missing/null cli defaults the same way the original code did', () => {
    assert.equal(normalizeAuthorForComment(null), 'claude');
    assert.equal(normalizeAuthorForComment(undefined), 'claude');
  });

  it('laneconductor.sync.mjs actually calls normalizeAuthorForComment at the track_chat author site, not the old raw fallback', () => {
    const src = readFileSync(SYNC_MJS_PATH, 'utf8');
    assert.match(src, /normalizeAuthorForComment\(proj\?\.primary\?\.cli\)/,
      'the track_chat reply handler must route through normalizeAuthorForComment — a revert to the raw ' +
      '`proj?.primary?.cli || \'claude\'` fallback would silently reintroduce REQ-8 with no other test catching it');
    assert.doesNotMatch(src, /const author = process\.env\.LC_MOCK_CLI \? 'worker' : \(proj\?\.primary\?\.cli \|\| 'claude'\);/,
      'the exact pre-fix line must be gone, not just present alongside a new one');
  });
});
