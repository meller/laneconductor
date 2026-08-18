#!/usr/bin/env node
// conductor/tests/track-10018-pr-flow.test.mjs
// Track 10018 Phases 2-3: PR creation, polling, status mapping, and merge —
// entirely against an injected fake `exec`, never a real `gh`/git process.
// Run: node --test conductor/tests/track-10018-pr-flow.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkGhAuth, createTrackPr, pollTrackPr, resolvePrStatus, mergeTrackPr,
} from '../services/pr-flow.mjs';

function fakeExec(responses) {
  const calls = [];
  const exec = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    const key = `${cmd} ${args.join(' ')}`;
    for (const [pattern, result] of responses) {
      if (pattern.test(key)) {
        if (result instanceof Error) throw result;
        return result;
      }
    }
    throw new Error(`fakeExec: no response configured for "${key}"`);
  };
  exec.calls = calls;
  return exec;
}

describe('checkGhAuth', () => {
  it('returns ok:true when gh auth status succeeds', () => {
    const exec = fakeExec([[/^gh auth status$/, '']]);
    assert.deepEqual(checkGhAuth({ cwd: '/repo', exec }), { ok: true });
  });

  it('returns ok:false with the error message when gh auth status fails, never throws', () => {
    const err = new Error('not logged in'); err.stderr = Buffer.from('gh: not authenticated');
    const exec = fakeExec([[/^gh auth status$/, err]]);
    const result = checkGhAuth({ cwd: '/repo', exec });
    assert.equal(result.ok, false);
    assert.match(result.error, /not authenticated/);
  });
});

describe('createTrackPr', () => {
  it('pushes the branch then creates a PR, parsing number+url from stdout', () => {
    const exec = fakeExec([
      [/^git push -u origin track-10018$/, ''],
      [/^gh pr create /, 'https://github.com/org/repo/pull/42\n'],
    ]);
    const result = createTrackPr({
      repoRoot: '/repo', trackNumber: '10018', mainBranch: 'main',
      title: 'Track 10018: Foo', body: 'Body text', exec,
    });
    assert.deepEqual(result, { number: 42, url: 'https://github.com/org/repo/pull/42' });
    assert.equal(exec.calls[0].cmd, 'git');
    assert.deepEqual(exec.calls[0].args, ['push', '-u', 'origin', 'track-10018']);
    assert.equal(exec.calls[1].cmd, 'gh');
    assert.deepEqual(exec.calls[1].args, [
      'pr', 'create', '--base', 'main', '--head', 'track-10018',
      '--title', 'Track 10018: Foo', '--body', 'Body text',
    ]);
  });

  it('throws a descriptive error when gh pr create output has no PR URL', () => {
    const exec = fakeExec([
      [/^git push /, ''],
      [/^gh pr create /, 'Some unexpected output\n'],
    ]);
    assert.throws(
      () => createTrackPr({ repoRoot: '/repo', trackNumber: '1', title: 't', body: 'b', exec }),
      /didn't contain a PR URL/
    );
  });

  it('propagates a push failure without attempting gh pr create', () => {
    const pushErr = new Error('push rejected');
    const exec = fakeExec([[/^git push /, pushErr]]);
    assert.throws(
      () => createTrackPr({ repoRoot: '/repo', trackNumber: '1', title: 't', body: 'b', exec }),
      /push rejected/
    );
    assert.equal(exec.calls.length, 1);
  });
});

describe('pollTrackPr', () => {
  it('parses state/mergeStateStatus/checksStatus=passing when all checks succeeded', () => {
    const exec = fakeExec([[/^gh pr view 42 /, JSON.stringify({
      state: 'OPEN', mergeStateStatus: 'CLEAN',
      statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
    })]]);
    const result = pollTrackPr({ repoRoot: '/repo', prNumber: 42, exec });
    assert.deepEqual(result, { state: 'OPEN', mergeStateStatus: 'CLEAN', checksStatus: 'passing' });
  });

  it('reports checksStatus=failing when any check failed', () => {
    const exec = fakeExec([[/^gh pr view /, JSON.stringify({
      state: 'OPEN', mergeStateStatus: 'CLEAN',
      statusCheckRollup: [
        { status: 'COMPLETED', conclusion: 'SUCCESS' },
        { status: 'COMPLETED', conclusion: 'FAILURE' },
      ],
    })]]);
    assert.equal(pollTrackPr({ repoRoot: '/repo', prNumber: 1, exec }).checksStatus, 'failing');
  });

  it('reports checksStatus=pending when a check is still running', () => {
    const exec = fakeExec([[/^gh pr view /, JSON.stringify({
      state: 'OPEN', mergeStateStatus: 'CLEAN',
      statusCheckRollup: [{ status: 'IN_PROGRESS', conclusion: null }],
    })]]);
    assert.equal(pollTrackPr({ repoRoot: '/repo', prNumber: 1, exec }).checksStatus, 'pending');
  });

  it('reports checksStatus=none when there are no checks configured', () => {
    const exec = fakeExec([[/^gh pr view /, JSON.stringify({
      state: 'OPEN', mergeStateStatus: 'CLEAN', statusCheckRollup: [],
    })]]);
    assert.equal(pollTrackPr({ repoRoot: '/repo', prNumber: 1, exec }).checksStatus, 'none');
  });

  it('returns null (never throws) on a transient gh failure', () => {
    const exec = fakeExec([[/^gh pr view /, new Error('rate limited')]]);
    assert.equal(pollTrackPr({ repoRoot: '/repo', prNumber: 1, exec }), null);
  });

  it('returns null on unparseable JSON', () => {
    const exec = fakeExec([[/^gh pr view /, 'not json']]);
    assert.equal(pollTrackPr({ repoRoot: '/repo', prNumber: 1, exec }), null);
  });
});

describe('resolvePrStatus', () => {
  it('maps a transient poll failure (null) to null — caller leaves state alone', () => {
    assert.equal(resolvePrStatus(null), null);
  });
  it('maps MERGED to merged', () => {
    assert.equal(resolvePrStatus({ state: 'MERGED' }), 'merged');
  });
  it('maps CLOSED (unmerged) to closed', () => {
    assert.equal(resolvePrStatus({ state: 'CLOSED' }), 'closed');
  });
  it('maps mergeStateStatus=DIRTY to conflicted, even with open state', () => {
    assert.equal(resolvePrStatus({ state: 'OPEN', mergeStateStatus: 'DIRTY', checksStatus: 'passing' }), 'conflicted');
  });
  it('maps failing checks to checks-failed', () => {
    assert.equal(resolvePrStatus({ state: 'OPEN', mergeStateStatus: 'CLEAN', checksStatus: 'failing' }), 'checks-failed');
  });
  it('maps a clean, green PR to open', () => {
    assert.equal(resolvePrStatus({ state: 'OPEN', mergeStateStatus: 'CLEAN', checksStatus: 'passing' }), 'open');
  });
});

describe('mergeTrackPr', () => {
  it('merges through gh pr merge, never a local git merge', () => {
    const exec = fakeExec([[/^gh pr merge 42 --merge$/, '']]);
    mergeTrackPr({ repoRoot: '/repo', prNumber: 42, exec });
    assert.equal(exec.calls.length, 1);
    assert.equal(exec.calls[0].cmd, 'gh');
    assert.deepEqual(exec.calls[0].args, ['pr', 'merge', '42', '--merge']);
  });
});
