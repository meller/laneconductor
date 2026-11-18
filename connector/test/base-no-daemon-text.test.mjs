// Track AM-10130: the base plugin (the one submitted to the directory) works by editing files in git. Nothing it ships may talk about the
// retired daemon era: `make install`, the rc file, a worker, collection or the daemon. The source skill still carries that material, but
// only under legacy/, which the plugin build does not ship, and in the base-only rewordings of the generator (DAEMON_FREE_EDITS).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, buildPlugin } from '../../scripts/build-plugin.mjs';

const BAD = /make install|laneconductorrc|\bworkers?\b|collection|daemon/i;
const BASE = path.join(REPO, 'plugins/laneconductor');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

test('no file of the committed base plugin mentions make install, the rc file, a worker, collection or the daemon', () => {
  const files = walk(BASE).filter((f) => !/\.png$/.test(f));
  assert.ok(files.length > 30, `read ${files.length} files; the walk is probably broken`);
  const hits = [];
  for (const f of files) fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => { if (BAD.test(l)) hits.push(`${path.relative(BASE, f)}:${i + 1}: ${l.trim().slice(0, 100)}`); });
  assert.deepEqual(hits, []);
});

test('the same holds for what the generator builds in memory', () => {
  const built = buildPlugin(REPO, 'base');
  const hits = [];
  let read = 0;
  for (const [rel, f] of built.files ?? built) {
    if (/\.png$/.test(rel)) continue;
    const content = f.content ?? f;
    const text = Buffer.isBuffer(content) ? content.toString('utf8') : String(content);
    read += 1;
    if (BAD.test(text)) hits.push(rel);
  }
  assert.ok(read > 30, `read ${read} generated files`);
  assert.deepEqual(hits, []);
});

test('the daemon-era setup text lives only under legacy/, which the plugin does not ship', () => {
  const skill = path.join(REPO, '.claude/skills/laneconductor');
  const legacy = fs.readFileSync(path.join(skill, 'legacy/setup-daemon.md'), 'utf8');
  assert.match(legacy, /make install/);
  assert.match(legacy, /laneconductorrc/);
  assert.match(legacy, /## setup collection/);
  // The live setup procedure of the source skill is the plugin-era one, too.
  const setup = fs.readFileSync(path.join(skill, 'setup/setup.md'), 'utf8');
  assert.match(setup, /^# setup: add LaneConductor to this project$/m);
  for (const rel of ['setup/setup.md', 'ops/new-project.md', 'setup/scaffold.md']) assert.ok(!BAD.test(fs.readFileSync(path.join(skill, rel), 'utf8')), `${rel} has no daemon-era text`);
  assert.ok(!fs.existsSync(path.join(BASE, 'skills/laneconductor/legacy')), 'legacy/ is not shipped');
});

test('the generated /laneconductor:setup command follows new-project; `scaffold` goes straight to scaffold.md; the hook point for the starter set is in both procedures', () => {
  const cmd = fs.readFileSync(path.join(BASE, 'commands/setup.md'), 'utf8');
  assert.match(cmd, /ops\/new-project\.md/);
  assert.match(cmd, /`\/laneconductor:setup scaffold` is the explicit action that goes straight to the files: follow\n`setup\/scaffold\.md`/);
  assert.match(cmd, /runs only because I named it/);
  assert.ok(!/make install|laneconductorrc/.test(cmd), 'the command carries no daemon-era install text');
  const skill = path.join(BASE, 'skills/laneconductor');
  for (const rel of ['setup/setup.md', 'ops/new-project.md']) assert.match(fs.readFileSync(path.join(skill, rel), 'utf8'), /<!-- Starter set: reserved for the skill advisor \(track 10124\) -->/, rel);
});
