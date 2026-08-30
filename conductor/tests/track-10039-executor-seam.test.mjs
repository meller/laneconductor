#!/usr/bin/env node
// conductor/tests/track-10039-executor-seam.test.mjs
// Track 10039 Phase 2: the executor seam (conductor/services/executor.mjs).
//
// Run: node --test conductor/tests/track-10039-executor-seam.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createExecutor, extractPromptFromArgs, runToCompletion } from '../services/executor.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');

describe('createExecutor (REQ-2 factory)', () => {
  it('returns the injected localCliExecutor for runtime "machine"', () => {
    const localCliExecutor = { run: async () => ({ id: 1 }), poll: async () => ({ state: 'running' }), result: async () => null };
    assert.equal(createExecutor('machine', { localCliExecutor }), localCliExecutor);
  });

  it('defaults to "machine" when runtime is null/undefined', () => {
    const localCliExecutor = {};
    assert.equal(createExecutor(null, { localCliExecutor }), localCliExecutor);
    assert.equal(createExecutor(undefined, { localCliExecutor }), localCliExecutor);
  });

  it('throws if the "machine" dependency is missing', () => {
    assert.throws(() => createExecutor('machine', {}), /localCliExecutor dependency is required/);
  });

  it('throws a clear not-yet-implemented error for "remote" and "cloud" (Phase 3b/4 land these later)', () => {
    assert.throws(() => createExecutor('remote', {}), /"remote" has no executor yet/);
    assert.throws(() => createExecutor('cloud', {}), /"cloud" has no executor yet/);
  });
});

describe('extractPromptFromArgs', () => {
  it('returns the argv element right after -p', () => {
    assert.equal(extractPromptFromArgs(['--dangerously-skip-permissions', '-p', 'do the thing']), 'do the thing');
  });

  it('falls back to the last argv element when there is no -p flag', () => {
    assert.equal(extractPromptFromArgs(['some-custom-cli', 'a raw prompt']), 'a raw prompt');
  });

  it('returns null for empty/missing argv', () => {
    assert.equal(extractPromptFromArgs([]), null);
    assert.equal(extractPromptFromArgs(null), null);
    assert.equal(extractPromptFromArgs(undefined), null);
  });
});

describe('runToCompletion (TC-11: same outcome fields the spawnCli path produced)', () => {
  let tmp;
  it('resolves with the exit code and log path on success — mirrors spawnCli-observable fields', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'lc-executor-test-'));
    const logPath = join(tmp, 'run.log');
    const result = await runToCompletion('node', [MOCK_CLI, 'implement', '999'], {
      cwd: ROOT,
      env: { ...process.env, MOCK_CLI_EXIT_CODE: '0', MOCK_CLI_DELAY_MS: '10' },
      logPath,
    });
    assert.equal(result.code, 0);
    assert.equal(result.logPath, logPath);
    const logged = readFileSync(logPath, 'utf8');
    assert.ok(logged.length > 0, 'mock CLI stdout/stderr should have been redirected into the log file, same as spawnCli');
    rmSync(tmp, { recursive: true, force: true });
  });

  it('resolves with the real non-zero exit code on failure — same exit-code mapping spawnCli relies on', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'lc-executor-test-'));
    const logPath = join(tmp, 'run.log');
    const result = await runToCompletion('node', [MOCK_CLI, 'implement', '999'], {
      cwd: ROOT,
      env: { ...process.env, MOCK_CLI_EXIT_CODE: '7', MOCK_CLI_DELAY_MS: '10' },
      logPath,
    });
    assert.equal(result.code, 7);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('resolves (never rejects) with code 1 and an error message when the command cannot be spawned at all', async () => {
    const result = await runToCompletion('this-binary-does-not-exist-xyz', ['--flag'], {});
    assert.equal(result.code, 1);
    assert.ok(result.error, 'should carry the spawn error message');
  });
});

describe('TC-12: no direct spawnCli/bespoke spawn invocation remains outside the seam', () => {
  const source = readFileSync(join(ROOT, 'conductor', 'laneconductor.sync.mjs'), 'utf8');

  it('spawnCli(...) is only called from its own definition and the LocalCliExecutor adapter', () => {
    const callSites = [...source.matchAll(/\bspawnCli\(/g)];
    // Exactly two occurrences of the literal call form `spawnCli(`:
    // the function's own `async function spawnCli(` declaration, and the
    // one delegation inside localCliExecutor.run(). Every other former
    // call site (autoLaunchLocalFs, startNextAutoCompleteStage,
    // checkDispatchInbox's lane-action dispatch) now calls executor.run()
    // instead.
    assert.equal(callSites.length, 2, `expected exactly 2 occurrences of "spawnCli(", found ${callSites.length}`);
  });

  it('runCreateProject no longer builds its own inline spawn+exit Promise', () => {
    const fnStart = source.indexOf('async function runCreateProject(');
    assert.ok(fnStart !== -1, 'runCreateProject should still exist');
    const fnEnd = source.indexOf('\nasync function ', fnStart + 1);
    const fnBody = source.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);
    assert.match(fnBody, /runToCompletion\(/, 'runCreateProject should route its scaffold spawn through runToCompletion()');
    assert.doesNotMatch(fnBody, /new Promise\(\(resolvePromise\)/, 'the old inline spawn+exit Promise should be gone');
  });

  it('the four named call sites resolve their executor through executor.run(...)', () => {
    const runCallSites = [...source.matchAll(/executor\.run\(/g)];
    // autoLaunchLocalFs, startNextAutoCompleteStage, checkDispatchInbox's
    // lane-action dispatch — three executor.run() call sites; the fourth
    // named site (runCreateProject) uses runToCompletion() instead (see
    // the test above and executor.mjs's own doc comment for why: project
    // creation has no track/lane/worktree, so it doesn't fit the
    // lane-action-shaped run/poll/result contract).
    assert.equal(runCallSites.length, 3, `expected exactly 3 "executor.run(" call sites, found ${runCallSites.length}`);
  });
});
