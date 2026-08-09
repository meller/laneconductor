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
import { runDeploy } from '../deploy-runner.mjs';

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
});
