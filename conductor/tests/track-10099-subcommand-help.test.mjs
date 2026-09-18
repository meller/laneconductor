#!/usr/bin/env node
// conductor/tests/track-10099-subcommand-help.test.mjs
// Track AM-10099 Phase 5 (item g): `lc <subcommand> --help` must be safe
// (no side effects) and useful (subcommand-specific text) across every
// dispatch branch — not just `args[0] === '--help'`. Recovered from the
// spec/plan written in the stale session referenced in conversation.md
// (git show 4a1d31ec), adapted against the real, current bin/lc.mjs.
//
// Uses makeSandbox() (Phase 1's sanctioned helper), not
// join(ROOT, '.test-tmp-*') — this file must not become a 26th
// unprotected file (TC-5.16). bin/lc.mjs's own commands here never spawn
// the real worker/CLI, but the pattern is followed for consistency and
// because `lc new`/`comment`/etc. still do real git-adjacent file I/O.
//
// Run: node --test conductor/tests/track-10099-subcommand-help.test.mjs

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { makeSandbox, cleanupSandbox } from './helpers/isolated-worker.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const LC = join(ROOT, 'bin/lc.mjs');

let REPO;

function lc(argv, { expectFailure = false } = {}) {
  try {
    const out = execFileSync('node', [LC, ...argv], { cwd: REPO, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    if (expectFailure) throw new Error(`expected lc ${argv.join(' ')} to fail, but it exited 0: ${out}`);
    return { stdout: out, code: 0 };
  } catch (err) {
    if (!expectFailure) throw err;
    return { stdout: (err.stdout || '') + (err.stderr || ''), code: err.status ?? 1 };
  }
}

function setupProject() {
  REPO = makeSandbox('subcommand-help');
  writeFileSync(join(REPO, '.laneconductor.json'), JSON.stringify({
    mode: 'local-fs',
    project: { name: 'subcommand-help-test', repo_path: REPO, primary: { cli: 'mock', model: 'mock' } },
    collectors: [],
  }, null, 2));
  mkdirSync(join(REPO, 'conductor/tracks'), { recursive: true });
}

function trackCount() {
  return readdirSync(join(REPO, 'conductor/tracks')).length;
}

function queueContent() {
  const p = join(REPO, 'conductor/tracks/file_sync_queue.md');
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

describe('Track AM-10099 Phase 5: lc <subcommand> --help', () => {
  after(() => { if (REPO) cleanupSandbox(REPO); });

  it('TC-5.1 (D1/AC-14): lc new --help exits 0, prints new usage, creates no folder and no file_sync_queue.md entry', () => {
    setupProject();
    const { stdout, code } = lc(['new', '--help']);
    assert.equal(code, 0);
    assert.match(stdout, /lc new/);
    assert.equal(trackCount(), 0);
    assert.equal(queueContent(), null);
  });

  it('TC-5.2: lc new -h is identical to --help', () => {
    setupProject();
    const a = lc(['new', '--help']);
    const b = lc(['new', '-h']);
    assert.equal(a.stdout, b.stdout);
    assert.equal(trackCount(), 0);
  });

  it('TC-5.3/TC-5.4 (D2/D3/AC-15): a flag no longer leaks into the title/description, and no "unquoted words" warning fires', () => {
    setupProject();
    const { stdout, code } = lc(['new', 'My Title', 'My desc', '--merge-mode', 'pr']);
    assert.equal(code, 0);
    assert.doesNotMatch(stdout, /unquoted words/i);
    const dirs = readdirSync(join(REPO, 'conductor/tracks'));
    const dir = dirs.find(d => /^[A-Za-z]+-\d+-my-title$/.test(d));
    assert.ok(dir, `expected an exact "*-my-title" folder, got: ${dirs.join(', ')}`);
    const content = readFileSync(join(REPO, 'conductor/tracks', dir, 'index.md'), 'utf8');
    assert.match(content, /# Track [A-Za-z]+-\d+: My Title$/m);
    assert.match(content, /\*\*Problem\*\*:\s*My desc/);
    assert.match(content, /\*\*Merge Mode\*\*:\s*pr/);
  });

  it('TC-5.5: --workspace main and --auto-run no also survive intact', () => {
    setupProject();
    lc(['new', 'Ws Track', 'desc', '--workspace', 'main', '--auto-run', 'no']);
    const dirs = readdirSync(join(REPO, 'conductor/tracks'));
    const dir = dirs.find(d => /^[A-Za-z]+-\d+-ws-track$/.test(d));
    assert.ok(dir);
    const content = readFileSync(join(REPO, 'conductor/tracks', dir, 'index.md'), 'utf8');
    assert.match(content, /\*\*Workspace\*\*:\s*main/);
    assert.match(content, /\*\*Auto Run\*\*:\s*no/);
  });

  it('TC-5.6 (AC-17): lc report-bug --help creates no track', () => {
    setupProject();
    const { code } = lc(['report-bug', '--help']);
    assert.equal(code, 0);
    assert.equal(trackCount(), 0);
  });

  it('TC-5.9 (AC-16): table-driven — every dispatch branch\'s --help exits 0 with non-empty output', () => {
    setupProject();
    const commands = [
      'setup-deploy', 'deploy', 'build', 'builds', 'start', 'stop', 'restart',
      'worker', 'api', 'meta-project', 'ui', 'logs', 'status', 'state', 'new',
      'measure', 'check-skills', 'comment', 'updateTrack', 'update-track',
      'reportaBug', 'report-bug', 'featureRequest', 'feature-request',
      'brainstorm', 'move', 'plan', 'implement', 'review', 'quality-gate',
      'backlog', 'done', 'rerun', 'pulse', 'workflow', 'config', 'project',
      'add-target-mapping', 'add-target', 'remove-target', 'enable-target',
      'disable-target', 'list-targets', 'track-dir', 'abort',
      'verify-isolation', 'worktrees', 'doc', 'show', 'verify', 'remote-sync',
      'init-summary', 'delete', 'remove',
    ];
    const failures = [];
    for (const cmd of commands) {
      const { stdout, code } = lc([cmd, '--help']);
      if (code !== 0 || !stdout.trim()) failures.push(`${cmd}: code=${code} stdout=${JSON.stringify(stdout)}`);
    }
    assert.deepEqual(failures, [], `every subcommand's --help must exit 0 with non-empty output:\n${failures.join('\n')}`);
    assert.equal(trackCount(), 0, 'no side effects from any of the above');
  });

  it('TC-5.10: lc help new prints the same text as lc new --help', () => {
    setupProject();
    const a = lc(['new', '--help']);
    const b = lc(['help', 'new']);
    assert.equal(a.stdout, b.stdout);
  });

  it('TC-5.11 (AC-18): lc comment <NNN> -- --help appends the literal --help', () => {
    setupProject();
    lc(['new', 'Comment Target', 'desc']);
    const dir = readdirSync(join(REPO, 'conductor/tracks')).find(d => /-comment-target$/.test(d));
    const num = dir.match(/-(\d+)-/)[1];
    lc(['comment', num, '--', '--help']);
    const conv = readFileSync(join(REPO, 'conductor/tracks', dir, 'conversation.md'), 'utf8');
    assert.match(conv, /--help/);
  });

  it('TC-5.12 (AC-19): a flag-like title is rejected, non-zero exit, nothing created', () => {
    setupProject();
    const { code } = lc(['new', '--totally-a-flag'], { expectFailure: true });
    assert.notEqual(code, 0);
    assert.equal(trackCount(), 0);
  });

  it('TC-5.13: regression — quoted "T" "D", bracket [T] [D], and --type placed anywhere still work', () => {
    setupProject();
    lc(['new', 'Quoted Title', 'Quoted Desc']);
    let dirs = readdirSync(join(REPO, 'conductor/tracks'));
    assert.ok(dirs.some(d => /-quoted-title$/.test(d)));

    setupProject();
    lc(['new', '[Bracket', 'Title]', '[Bracket', 'Desc]']);
    dirs = readdirSync(join(REPO, 'conductor/tracks'));
    assert.ok(dirs.some(d => /-bracket-title$/.test(d)));

    // --type placed AFTER the positionals (not as the very first token,
    // which has never been a supported placement — splitPositionalArgs
    // cuts at the first flag-like token regardless of which one it is,
    // same as the pre-existing `--type`-only boundary did for this exact
    // shape).
    setupProject();
    lc(['new', 'Type First', 'desc', '--type', 'marketing']);
    dirs = readdirSync(join(REPO, 'conductor/tracks'));
    const dir = dirs.find(d => /-type-first$/.test(d));
    assert.ok(dir);
    const content = readFileSync(join(REPO, 'conductor/tracks', dir, 'index.md'), 'utf8');
    assert.match(content, /\*\*Type\*\*:\s*marketing/);
  });

  it('TC-5.14: an unknown subcommand + --help falls back to top-level help', () => {
    setupProject();
    const { stdout, code } = lc(['totally-bogus-subcommand', '--help']);
    assert.equal(code, 0);
    assert.match(stdout, /Unknown subcommand/);
  });
});
