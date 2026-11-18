// Track AM-10143 (remaining part): create_track allocates against the track folders of every local and remote-tracking branch, and a
// duplicate number is surfaced as a warning; the repair is the `repair-duplicates` command (text only).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from './helpers/mcp.mjs';
import { makeRepo, writeFile, commitAll, rm, git, INDEX } from './helpers/repo.mjs';
import { duplicateNumbers } from '../src/tracks.mjs';
import { COMMANDS, fillProcedure } from '../src/commands.mjs';

const cleanup = [];
const sessions = [];
after(async () => {
  await Promise.all(sessions.map((s) => s.close().catch(() => {})));
  rm(...cleanup);
});
const T = (n, slug) => `conductor/tracks/AM-${n}-${slug}/index.md`;

async function open(setup) {
  const dir = makeRepo();
  cleanup.push(dir);
  writeFile(dir, T(1, 'one'), INDEX(1, 'One'));
  commitAll(dir, 'fixture');
  setup(dir);
  const s = await connect(dir);
  sessions.push(s);
  return { dir, s };
}
const create = (s, title) => s.call('create_track', { title, problem: 'something unrelated to the others xyzzy' });

test('duplicateNumbers: same number under different folder names only', () => {
  assert.deepEqual(duplicateNumbers(['AM-1-a', 'AM-2-b'], ['AM-1-a', '2-c', 'AM-1-z']), [
    { number: 1, folders: ['AM-1-a', 'AM-1-z'] },
    { number: 2, folders: ['2-c', 'AM-2-b'] },
  ]);
  assert.deepEqual(duplicateNumbers(['AM-5-x'], ['AM-5-x', '_duplicate-9-y']), []);
});

test('a number taken on another local branch is not handed out again', async () => {
  const { dir, s } = await open((d) => {
    git(d, 'checkout', '-q', '-b', 'other');
    writeFile(d, T(40, 'elsewhere'), INDEX(40, 'Elsewhere'));
    commitAll(d, 'other branch track');
    git(d, 'checkout', '-q', 'main');
  });
  const r = await create(s, 'Brand new work');
  assert.equal(r.isError, false, r.text);
  assert.equal(r.env.data.track.number, 41, 'numbered after 40, which exists only on branch other');
  assert.ok(!r.env.warnings.some((w) => /Duplicate track numbers/.test(w)));
  void dir;
});

test('a number taken on a remote-tracking ref counts too', async () => {
  const { s } = await open((d) => {
    git(d, 'checkout', '-q', '-b', 'tmp');
    writeFile(d, T(77, 'remote'), INDEX(77, 'Remote'));
    commitAll(d, 'remote track');
    git(d, 'update-ref', 'refs/remotes/origin/feature', 'HEAD');
    git(d, 'checkout', '-q', 'main');
    git(d, 'branch', '-D', 'tmp');
  });
  const r = await create(s, 'More new work');
  assert.equal(r.env.data.track.number, 78);
});

test('a duplicate number across branches is a create_track warning', async () => {
  const { s } = await open((d) => {
    git(d, 'checkout', '-q', '-b', 'other');
    writeFile(d, T(1, 'different-slug'), INDEX(1, 'Different'));
    commitAll(d, 'same number, other folder');
    git(d, 'checkout', '-q', 'main');
  });
  const r = await create(s, 'Anything else');
  assert.equal(r.isError, false, r.text);
  const w = r.env.warnings.find((x) => /Duplicate track numbers/.test(x));
  assert.match(w, /1 \(2 folders\).*repair-duplicates/);
});

test('the repair-duplicates command asks first, renames the newer folder, never pushes, and is in the catalog', () => {
  const c = COMMANDS.find((x) => x.name === 'repair-duplicates');
  assert.ok(c);
  const text = fillProcedure(c, {});
  assert.match(text, /Nothing is renamed until I say yes/);
  assert.match(text, /\[default: yes\]/);
  assert.match(text, /newer/);
  assert.match(text, /git mv/);
  assert.match(text, /Never push/);
  assert.match(text, /never `git add -A`/);
});
