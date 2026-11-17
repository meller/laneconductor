// Directory readiness: the connector finds its repository without a ${CLAUDE_PROJECT_DIR} argument.
// Order: --repo flag, else the CLAUDE_PROJECT_DIR environment variable, else the git top level of the
// current directory, else a clear startup error. The real-session check (does `/mcp` still connect
// after updating the plugin?) is HUMAN, see plan Phase 5e.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveRepoSource } from '../src/repo-source.mjs';
import { BIN } from './helpers/mcp.mjs';
import { makeRepo } from './helpers/repo.mjs';
import { spawnRaw } from './helpers/rawstdio.mjs';

const TMP = fs.realpathSync(os.tmpdir());
const cleanEnv = (extra = {}) => {
  const env = { ...process.env, GIT_CEILING_DIRECTORIES: TMP, ...extra };
  if (!('CLAUDE_PROJECT_DIR' in extra)) delete env.CLAUDE_PROJECT_DIR;
  return env;
};
const rm = (...dirs) => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));

test('resolveRepoSource: flag beats env beats cwd; cwd uses the git top level; nothing found throws', () => {
  const a = makeRepo({ prefix: 'lc-rs-a-' });
  const b = makeRepo({ prefix: 'lc-rs-b-' });
  const plain = fs.mkdtempSync(path.join(TMP, 'lc-rs-plain-'));
  const prev = process.env.GIT_CEILING_DIRECTORIES;
  process.env.GIT_CEILING_DIRECTORIES = TMP;
  try {
    assert.deepEqual(resolveRepoSource({ flags: [a, b], env: { CLAUDE_PROJECT_DIR: '/ignored' }, cwd: plain }), { repos: [a, b], source: 'flag' });
    assert.deepEqual(resolveRepoSource({ flags: [], env: { CLAUDE_PROJECT_DIR: b }, cwd: a }), { repos: [b], source: 'env' });
    assert.deepEqual(resolveRepoSource({ flags: [], env: { CLAUDE_PROJECT_DIR: '  ' }, cwd: a }).source, 'cwd', 'a blank variable counts as unset');
    const deep = path.join(a, 'conductor', 'tracks');
    assert.deepEqual(resolveRepoSource({ flags: [], env: {}, cwd: deep }), { repos: [a], source: 'cwd' }, 'a subdirectory resolves to the repo top level');
    assert.throws(() => resolveRepoSource({ flags: [], env: {}, cwd: plain }), /no repository to serve.*--repo.*CLAUDE_PROJECT_DIR.*git checkout/s);
  } finally {
    if (prev === undefined) delete process.env.GIT_CEILING_DIRECTORIES; else process.env.GIT_CEILING_DIRECTORIES = prev;
    rm(a, b, plain);
  }
});

async function serveWith({ args = [], env, cwd }) {
  const raw = spawnRaw(process.execPath, [BIN, ...args], { cwd, env });
  try {
    const init = await raw.initialize();
    assert.ok(init.result, JSON.stringify(init));
    return raw.stderr();
  } finally {
    await raw.kill();
  }
}

test('started with no --repo: CLAUDE_PROJECT_DIR is used and the choice is logged', async () => {
  const proj = makeRepo({ prefix: 'lc-rs-env-' });
  const elsewhere = fs.mkdtempSync(path.join(TMP, 'lc-rs-cwd-'));
  try {
    const log = await serveWith({ env: cleanEnv({ CLAUDE_PROJECT_DIR: proj }), cwd: elsewhere });
    assert.ok(log.includes(`repo ${proj} (chosen by CLAUDE_PROJECT_DIR)`), log);
    assert.ok(log.includes(`serving ${proj}`), log);
  } finally {
    rm(proj, elsewhere);
  }
});

test('--repo wins over CLAUDE_PROJECT_DIR', async () => {
  const flagRepo = makeRepo({ prefix: 'lc-rs-flag-' });
  const envRepo = makeRepo({ prefix: 'lc-rs-envlose-' });
  try {
    const log = await serveWith({ args: ['--repo', flagRepo], env: cleanEnv({ CLAUDE_PROJECT_DIR: envRepo }), cwd: TMP });
    assert.ok(log.includes(`repo ${flagRepo} (chosen by --repo flag)`), log);
    assert.ok(!log.includes(envRepo), log);
  } finally {
    rm(flagRepo, envRepo);
  }
});

test('no flag and no variable: the current directory is used when it is inside a git repo (top level)', async () => {
  const proj = makeRepo({ prefix: 'lc-rs-cwdrepo-' });
  try {
    const log = await serveWith({ env: cleanEnv(), cwd: path.join(proj, 'conductor') });
    assert.ok(log.includes(`repo ${proj} (chosen by current directory)`), log);
  } finally {
    rm(proj);
  }
});

test('outside any repo with no flag and no variable: a clear error and exit code 2, nothing on stdout', () => {
  const plain = fs.mkdtempSync(path.join(TMP, 'lc-rs-none-'));
  try {
    const r = spawnSync(process.execPath, [BIN], { cwd: plain, env: cleanEnv(), encoding: 'utf8', input: '', timeout: 15_000 });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /no repository to serve/);
    assert.match(r.stderr, /--repo/);
    assert.match(r.stderr, /CLAUDE_PROJECT_DIR/);
    assert.equal(r.stdout, '');
  } finally {
    rm(plain);
  }
});
