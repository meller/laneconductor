#!/usr/bin/env node
// conductor/tests/create-project-utils.test.mjs
// Track 1091 Phase 3: pure resolution logic for a create-project dispatch's
// repo_source — kept separate from checkDispatchInbox (which has real I/O:
// git clone, spawning claude) so the actual path/slug decisions are
// unit-testable without any of that.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, resolveRepoTarget } from '../create-project-utils.mjs';

describe('slugify', () => {
  it('lowercases and hyphenates spaces', () => {
    assert.equal(slugify('My New Project'), 'my-new-project');
  });

  it('replaces runs of non-alphanumeric characters with a single hyphen', () => {
    assert.equal(slugify("Bob's Café & Bar!"), 'bob-s-caf-bar');
  });

  it('collapses repeated separators and trims leading/trailing hyphens', () => {
    assert.equal(slugify('  --Weird   Name--  '), 'weird-name');
  });
});

describe('resolveRepoTarget', () => {
  it('type: path uses the given value directly, no clone needed', () => {
    const result = resolveRepoTarget({
      repoSource: { type: 'path', value: '/home/user/existing-project' },
      scaffoldContext: { project: { name: 'existing-project' } },
      projectsDir: null,
    });
    assert.deepEqual(result, { ok: true, targetPath: '/home/user/existing-project', needsClone: false });
  });

  it('type: git with an explicit target_path uses it, ignoring projectsDir', () => {
    const result = resolveRepoTarget({
      repoSource: { type: 'git', value: 'https://github.com/x/y.git', target_path: '/custom/path' },
      scaffoldContext: { project: { name: 'y' } },
      projectsDir: '/some/other/dir',
    });
    assert.deepEqual(result, { ok: true, targetPath: '/custom/path', needsClone: true, gitUrl: 'https://github.com/x/y.git' });
  });

  it('type: git without target_path resolves to <projectsDir>/<slug>', () => {
    const result = resolveRepoTarget({
      repoSource: { type: 'git', value: 'https://github.com/x/my-repo.git' },
      scaffoldContext: { project: { name: 'My Repo' } },
      projectsDir: '/home/user/Code',
    });
    assert.deepEqual(result, {
      ok: true, targetPath: '/home/user/Code/my-repo', needsClone: true, gitUrl: 'https://github.com/x/my-repo.git',
    });
  });

  it('type: git with neither target_path nor projectsDir fails clearly', () => {
    const result = resolveRepoTarget({
      repoSource: { type: 'git', value: 'https://github.com/x/y.git' },
      scaffoldContext: { project: { name: 'y' } },
      projectsDir: null,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /projects.dir/i);
  });

  it('rejects an unknown repo_source.type rather than guessing', () => {
    const result = resolveRepoTarget({
      repoSource: { type: 'ftp', value: 'whatever' },
      scaffoldContext: { project: { name: 'x' } },
      projectsDir: '/x',
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /type/i);
  });
});
