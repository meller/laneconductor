// Board freshness and refresh (track AM-10115). Generation side: board.json carries the commit the board was built from.
// Page side (below): the freshness chip, Check now, and the Refresh board button.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeRepo, writeFile, commitAll, rm, git, INDEX } from './helpers/repo.mjs';
import { boardPageData, buildBoard } from '../src/board.mjs';

const BIN = new URL('../bin/lc-board.mjs', import.meta.url).pathname;
const NOW = '2026-11-18T10:00:00.000Z';
const cleanup = [];
after(() => rm(...cleanup));
const real = fs.realpathSync(os.tmpdir());
const tmp = (p) => { const d = fs.mkdtempSync(path.join(real, p)); cleanup.push(d); return d; };
const siteOf = (repo) => {
  const dir = tmp('lc-fresh-site-');
  const r = spawnSync('node', [BIN, '--repo', repo, '--now', NOW, '--site', dir, '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(fs.readFileSync(path.join(dir, 'board.json'), 'utf8'));
};
const repoWithTrack = () => {
  const dir = makeRepo();
  cleanup.push(dir);
  writeFile(dir, 'conductor/tracks/AM-801-one/index.md', INDEX(801, 'One', { lane: 'plan', status: 'queue' }));
  commitAll(dir);
  return dir;
};

test('board.json carries the state branch head it was built from, in full and short, next to generated_at', () => {
  const repo = repoWithTrack();
  const head = git(repo, 'rev-parse', 'HEAD');
  const d = siteOf(repo);
  assert.equal(d.commit, head);
  assert.equal(d.commit_short, head.slice(0, 7));
  assert.equal(d.generated_at, NOW);
});

test('the commit is the state branch head even when the checkout is elsewhere, and it moves with the repository', () => {
  const repo = repoWithTrack();
  const main1 = git(repo, 'rev-parse', 'main');
  git(repo, 'checkout', '-q', '-b', 'side');
  writeFile(repo, 'x.txt', 'x');
  commitAll(repo);
  assert.equal(siteOf(repo).commit, main1, 'main is the state branch; the side branch head is not it');
  git(repo, 'checkout', '-q', 'main');
  writeFile(repo, 'y.txt', 'y');
  commitAll(repo);
  const main2 = git(repo, 'rev-parse', 'main');
  assert.notEqual(main2, main1);
  assert.equal(siteOf(repo).commit, main2);
});

test('boardPageData leaves the commit out unless it is a full hash; never copies other text', () => {
  const b = buildBoard([], { generatedAt: NOW, project: 'P' });
  assert.equal('commit' in boardPageData(b), false);
  for (const bad of ['not a sha', '<img onerror=x>', 'abc123', 42, '']) assert.equal('commit' in boardPageData(b, { commit: bad }), false, String(bad));
  const sha = 'A1B2C3D4E5F60718293A4B5C6D7E8F9012345678';
  const d = boardPageData(b, { commit: sha });
  assert.equal(d.commit, sha.toLowerCase());
  assert.equal(d.commit_short, 'a1b2c3d');
});
