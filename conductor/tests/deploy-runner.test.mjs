#!/usr/bin/env node
// conductor/tests/deploy-runner.test.mjs
// Track 1085 Phase 5: runDeploy(projectRoot, env) — shared deploy execution
// logic used by both `lc deploy` (bin/lc.mjs) and the worker's dispatch
// handler (conductor/laneconductor.sync.mjs), so both paths run identical
// code instead of duplicating the deploy.json-running logic.
//
// Run: node --test conductor/tests/deploy-runner.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDeploy, resolveDeployedUrl } from '../deploy-runner.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const TMP = join(ROOT, '.test-tmp-deploy-runner');

function writeDeployJson(config) {
  mkdirSync(join(TMP, 'conductor'), { recursive: true });
  writeFileSync(join(TMP, 'conductor', 'deploy.json'), JSON.stringify(config, null, 2));
}

describe('runDeploy', () => {
  before(() => {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
  });

  after(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it('fails clearly when deploy.json does not exist', async () => {
    const result = await runDeploy(TMP, 'prod');
    assert.equal(result.ok, false);
    assert.match(result.error, /deploy\.json/i);
    assert.equal(result.logFile, null);
  });

  it('fails clearly when the environment is not configured', async () => {
    writeDeployJson({ environments: { prod: { command: 'echo hi' } } });
    const result = await runDeploy(TMP, 'staging');
    assert.equal(result.ok, false);
    assert.match(result.error, /staging/);
    assert.match(result.error, /prod/); // lists available environments
  });

  it('runs a single command and writes a log file', async () => {
    writeDeployJson({ environments: { prod: { command: 'echo deploy-output-marker' } } });
    const result = await runDeploy(TMP, 'prod');
    assert.equal(result.ok, true);
    assert.equal(result.exitCode, 0);
    assert.ok(existsSync(result.logFile), 'log file should exist');
    const logContent = readFileSync(result.logFile, 'utf8');
    assert.match(logContent, /deploy-output-marker/);
  });

  it('runs multiple commands in order and stops at the first failure', async () => {
    writeDeployJson({
      environments: {
        prod: {
          commands: [
            { label: 'step-one', command: 'echo step-one-ran' },
            { label: 'step-two', command: 'exit 1' },
            { label: 'step-three', command: 'echo step-three-ran' },
          ],
        },
      },
    });
    const result = await runDeploy(TMP, 'prod');
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 1);
    assert.equal(result.failedStep, 'step-two');
    const logContent = readFileSync(result.logFile, 'utf8');
    assert.match(logContent, /step-one-ran/);
    assert.doesNotMatch(logContent, /step-three-ran/);
  });

  it('fails clearly when no command(s) are configured for the environment', async () => {
    writeDeployJson({ environments: { prod: {} } });
    const result = await runDeploy(TMP, 'prod');
    assert.equal(result.ok, false);
    assert.match(result.error, /No deploy command/i);
    assert.equal(result.logFile, null);
  });

  it('defaults to the "prod" log naming convention deploy-<env>-<timestamp>.log', async () => {
    writeDeployJson({ environments: { staging: { command: 'echo ok' } } });
    const result = await runDeploy(TMP, 'staging');
    assert.match(result.logFile, /deploy-staging-\d+\.log$/);
  });

  it('closes stdin so a command reading from it (e.g. an interactive confirmation prompt) fails fast instead of hanging', async () => {
    // Mirrors scripts/deploy.sh's `read -p "Continue? (y/N)"` pattern for a
    // script that doesn't check `[ -t 0 ]` first — with stdin closed, `read`
    // hits EOF immediately (exit 1) rather than blocking. -t 5 is a generous
    // ceiling; a genuinely closed stdin resolves in milliseconds, a hang
    // would still be blocking after 5s and this test would time out instead
    // of completing, which is the actual regression this guards against.
    writeDeployJson({ environments: { prod: { command: 'read -t 5 -n 1 x; exit $?' } } });
    const start = Date.now();
    const result = await runDeploy(TMP, 'prod');
    const elapsed = Date.now() - start;
    assert.equal(result.ok, false, 'read on closed stdin should fail (EOF), not succeed');
    assert.ok(elapsed < 4000, `expected fast EOF failure, took ${elapsed}ms (stdin may not be closed)`);
  });

  // Track AM-1119 Phase 4 (Task 2): a successful deploy resolves + returns
  // the live URL — deploy.json's own `expected_url` (Firebase) or one
  // parsed from real command output (GCP Cloud Run and friends).
  it('returns url from deploy.json\'s expected_url when present, without needing to parse output', async () => {
    writeDeployJson({ environments: { prod: { command: 'echo no url printed here', expected_url: 'https://digger-game-prod.web.app' } } });
    const result = await runDeploy(TMP, 'prod');
    assert.equal(result.ok, true);
    assert.equal(result.url, 'https://digger-game-prod.web.app');
  });

  it('parses a "Service URL:" line from command output when expected_url is absent (GCP Cloud Run)', async () => {
    writeDeployJson({ environments: { prod: { command: 'echo Service URL: https://digger-game-abc123-uc.a.run.app' } } });
    const result = await runDeploy(TMP, 'prod');
    assert.equal(result.ok, true);
    assert.equal(result.url, 'https://digger-game-abc123-uc.a.run.app');
  });

  it('returns url: null, not a guess, when nothing is found', async () => {
    writeDeployJson({ environments: { prod: { command: 'echo no url here at all' } } });
    const result = await runDeploy(TMP, 'prod');
    assert.equal(result.ok, true);
    assert.equal(result.url, null);
  });
});

describe('resolveDeployedUrl', () => {
  it('prefers envConfig.expected_url over anything in output', () => {
    const url = resolveDeployedUrl({ expected_url: 'https://a.web.app' }, 'Service URL: https://b.run.app');
    assert.equal(url, 'https://a.web.app');
  });

  it('falls back to a generic known-suffix URL in output', () => {
    const url = resolveDeployedUrl({}, 'Deployed to https://my-app.vercel.app successfully');
    assert.equal(url, 'https://my-app.vercel.app');
  });

  it('returns null when nothing matches', () => {
    assert.equal(resolveDeployedUrl({}, 'no url anywhere in this text'), null);
  });
});
