#!/usr/bin/env node
// conductor/tests/track-10099-scaffold-entries-gitignore.test.mjs
// Track 10099/AM-1005 (dual-reader incident): runCreateProject's git-init
// guard refuses to `git add -A` a directory holding anything it didn't
// scaffold itself — necessary, since that could commit a user's own
// pre-existing files, secrets included. But SKILL.md's own scaffold-generate
// step writes `.gitignore` one step before this guard runs, and `.gitignore`
// was missing from the allowlist — so the guard fired on a file the SAME
// dispatch had just created, and every brand-new project's create-project
// dispatch reported "failed" unconditionally, even though the scaffold
// itself was already complete and correct. Confirmed live creating the
// "Dual Reader" project.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filterNonScaffoldEntries, SCAFFOLD_ENTRIES } from '../create-project-utils.mjs';

describe('filterNonScaffoldEntries', () => {
  it('does not flag .gitignore as pre-existing content (the dual-reader regression)', () => {
    const entries = ['.laneconductor.json', 'conductor', '.git', '.gitignore'];
    assert.deepEqual(filterNonScaffoldEntries(entries), []);
  });

  it('still allows every previously-allowlisted scaffold entry', () => {
    const entries = [...SCAFFOLD_ENTRIES];
    assert.deepEqual(filterNonScaffoldEntries(entries), []);
  });

  it('still flags genuinely pre-existing, non-scaffold content', () => {
    const entries = ['.laneconductor.json', 'conductor', '.git', '.gitignore', 'node_modules', 'README.md'];
    assert.deepEqual(filterNonScaffoldEntries(entries).sort(), ['README.md', 'node_modules']);
  });

  it('never allowlists .env itself (only .env.example)', () => {
    assert.equal(SCAFFOLD_ENTRIES.has('.env'), false);
    assert.equal(SCAFFOLD_ENTRIES.has('.env.example'), true);
  });
});
