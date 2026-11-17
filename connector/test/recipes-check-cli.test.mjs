// Phase 2 (TC-2.13): lc-recipe-check exits 0 on a clean library and 1 on any error, one line per finding,
// and never prints a matched secret.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rm } from './helpers/repo.mjs';
import { fakeGoogleKey, makeLibrary, makeRefRepo, skill } from './helpers/recipes.mjs';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'lc-recipe-check.mjs');
const cleanup = [];
after(() => rm(...cleanup));

function world() {
  const ref = makeRefRepo();
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lc-roots-'));
  fs.symlinkSync(ref.dir, path.join(root, 'r'));
  cleanup.push(ref.dir, root);
  return { ref, root };
}
const run = (lib, root) => spawnSync(process.execPath, [BIN, lib, '--ref-root', root], { encoding: 'utf8' });

test('TC-2.13: exit 0 on a clean library, with zero findings', () => {
  const { ref, root } = world();
  const lib = makeLibrary({ 'sample-recipe': { skill: { refs: [{ repo: 'o/r', path: 'a.txt', commit: ref.first }] }, files: { '.env.example.tmpl': 'GCP_PROJECT=x\nDATABASE_URL=\n' } } });
  cleanup.push(lib);
  const r = run(lib, root);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stdout.trim(), '1 recipe checked: 0 errors, 0 warnings');
});

test('TC-2.13: exit 1 with one line per finding; secret text is never printed', () => {
  const { ref, root } = world();
  const key = fakeGoogleKey();
  const lib = makeLibrary({
    'sample-recipe': { skill: { refs: [{ repo: 'o/r', path: 'a.txt', commit: ref.first }] }, files: { 'config.ts': `const k = "${key}";\n`, '.env': 'A=1\n' } },
    'wrong-name': { text: skill({ name: 'other', refs: [{ repo: 'o/r', path: 'a.txt', commit: ref.first }] }) },
    'no-ref-path': { skill: { refs: [{ repo: 'o/r', path: 'missing.txt', commit: ref.first }] } },
  });
  cleanup.push(lib);
  const r = run(lib, root);
  assert.equal(r.status, 1);
  assert.ok(!r.stdout.includes(key));
  const lines = r.stdout.trim().split('\n');
  assert.match(lines.at(-1), /^3 recipes checked: 4 errors, 0 warnings$/);
  assert.ok(lines.some((l) => /^error recipes\/sample-recipe\/files\/config\.ts:1: possible secret \(google_api_key\)/.test(l)));
  assert.ok(lines.some((l) => /^error recipes\/sample-recipe\/files\/\.env: /.test(l)));
  assert.ok(lines.some((l) => /^error recipes\/wrong-name\/SKILL\.md \[name\]/.test(l)));
  assert.ok(lines.some((l) => /^error recipes\/no-ref-path\/SKILL\.md \[metadata\.reference o\/r:missing\.txt@/.test(l)));
});

test('an unresolvable reference repo and a possibly stale recipe are warnings, not errors', () => {
  const { root } = world();
  const lib = makeLibrary({ 'sample-recipe': { skill: { refs: [{ repo: 'o/not-here', path: 'a.txt', commit: 'abc1234' }] } } });
  cleanup.push(lib);
  const r = run(lib, root);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^warn .*no local checkout of this repo/m);
  assert.match(r.stdout, /1 recipe checked: 0 errors, 2 warnings/);
});

test('usage errors exit 2', () => {
  assert.equal(spawnSync(process.execPath, [BIN], { encoding: 'utf8' }).status, 2);
  assert.equal(spawnSync(process.execPath, [BIN, '/no/such/dir'], { encoding: 'utf8' }).status, 2);
});
