// Track AM-10143 (remaining part): create_track allocates against the track folders of every local and remote-tracking branch, and a
// duplicate number is surfaced as a warning; the repair is the `repair-duplicates` command (text only).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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

test('a folder named differently only on an unmerged branch is a softer note, not a duplicate', async () => {
  const { s } = await open((d) => {
    git(d, 'checkout', '-q', '-b', 'other');
    writeFile(d, T(1, 'different-slug'), INDEX(1, 'Different'));
    commitAll(d, 'same number, other folder');
    git(d, 'checkout', '-q', 'main');
  });
  const r = await create(s, 'Anything else');
  assert.equal(r.isError, false, r.text);
  assert.ok(!r.env.warnings.some((x) => /Duplicate track numbers/.test(x)), JSON.stringify(r.env.warnings));
  const w = r.env.warnings.find((x) => /also named differently on branch other/.test(x));
  assert.match(w, /^Track number 1 also named differently on branch other .*Merge or delete the branch.*repair-duplicates/);
  assert.ok(w.length <= 200 && w.endsWith('.'));
});

// Track AM-10146 (noise fix of 10143): old unmerged track-* branches made the soft note list hundreds of numbers.
const commitOn = (dir, message, isoDate) => {
  git(dir, 'add', '-A');
  execFileSync('git', ['-C', dir, 'commit', '-q', '-m', message], { env: { ...process.env, GIT_COMMITTER_DATE: isoDate, GIT_AUTHOR_DATE: isoDate, GIT_CONFIG_NOSYSTEM: '1' } });
};
const DAY = 24 * 3600 * 1000;
const iso = (ms) => new Date(ms).toISOString();

test('noise fix: 200 stale unmerged branches name numbers differently, and the create answer has no note about them', async () => {
  const { s } = await open((d) => {
    for (let n = 2; n <= 201; n++) writeFile(d, T(n, 'x'), INDEX(n, `X${n}`));
    commitAll(d, 'two hundred tracks on main');
    for (let n = 2; n <= 201; n++) {
      git(d, 'checkout', '-q', '-b', `track-${n}`, 'main');
      writeFile(d, T(n, `old-name-${n}`), INDEX(n, `Old ${n}`));
      commitOn(d, `old work ${n}`, iso(Date.now() - (90 + n) * DAY));
      git(d, 'checkout', '-q', 'main');
    }
  });
  const r = await create(s, 'Anything else');
  assert.equal(r.isError, false, r.text);
  assert.ok(!r.env.warnings.some((x) => /also named differently|\+\d+ more/.test(x)), JSON.stringify(r.env.warnings));
});

test('noise fix: only recent branches count; at most 3 are shown, then "+N more" and the repair-duplicates pointer, within 200 characters', async () => {
  const { s } = await open((d) => {
    for (let n = 2; n <= 60; n++) writeFile(d, T(n, 'x'), INDEX(n, `X${n}`));
    commitAll(d, 'tracks on main');
    for (let n = 2; n <= 60; n++) {
      git(d, 'checkout', '-q', '-b', `track-${n}`, 'main');
      writeFile(d, T(n, `other-name-${n}`), INDEX(n, `Other ${n}`));
      // 5 branches are recent (the newest last), the rest are over 60 days old
      commitOn(d, `work ${n}`, iso(n >= 56 ? Date.now() - (60 - n) * 1000 - 1000 : Date.now() - 100 * DAY));
      git(d, 'checkout', '-q', 'main');
    }
  });
  const r = await create(s, 'Anything else');
  assert.equal(r.isError, false, r.text);
  const notes = r.env.warnings.filter((x) => /also named differently/.test(x));
  assert.equal(notes.length, 1, JSON.stringify(r.env.warnings));
  const w = notes[0];
  assert.ok(w.length <= 200 && w.endsWith('.'), `${w.length}: ${w}`);
  assert.match(w, /\+2 more/);
  assert.match(w, /repair-duplicates/);
  assert.equal((w.match(/track-\d+/g) ?? []).length, 3, 'three branches shown');
  assert.ok(!/track-(?:[2-9]|[1-4]\d|5[0-5])\b/.test(w), `an old branch is shown: ${w}`);
});

test('two folder names for one number on the state branch is a Duplicate warning', async () => {
  const { s } = await open((d) => {
    writeFile(d, T(1, 'second-folder'), INDEX(1, 'Second'));
    commitAll(d, 'duplicate on main');
  });
  const r = await create(s, 'Anything else');
  assert.match(r.env.warnings.find((x) => /Duplicate track numbers/.test(x)), /1 \(2 folders\).*repair-duplicates/);
});

test('a duplicate on main renamed by repair, old name still on an unmerged branch: no Duplicate warning; the branch note goes once it is merged', async () => {
  const { dir, s } = await open((d) => {
    writeFile(d, T(1, 'dup'), INDEX(1, 'Dup'));
    commitAll(d, 'duplicate on main');
    git(d, 'checkout', '-q', '-b', 'old-work');
    writeFile(d, 'conductor/tracks/AM-1-dup/spec.md', 'work on the branch');
    commitAll(d, 'work on the old name');
    git(d, 'checkout', '-q', 'main');
    git(d, 'mv', 'conductor/tracks/AM-1-dup', 'conductor/tracks/AM-2-dup');
    commitAll(d, 'repair: renumber AM-1-dup to AM-2-dup');
  });
  const r = await create(s, 'Anything else');
  assert.equal(r.isError, false, r.text);
  assert.ok(!r.env.warnings.some((x) => /Duplicate track numbers/.test(x)), JSON.stringify(r.env.warnings));
  assert.equal(r.env.data.track.number, 3);
  assert.match(r.env.warnings.find((x) => /old-work/.test(x)) ?? '', /Track number 1 also named differently on branch old-work/);
  // once the other branch is merged (here: ours, keeping the rename) the note does not repeat
  git(dir, 'merge', '-q', '-s', 'ours', 'old-work', '-m', 'merge old-work');
  const again = await create(s, 'Yet another thing');
  assert.ok(!again.env.warnings.some((x) => /Duplicate track numbers|also named differently/.test(x)), JSON.stringify(again.env.warnings));
});

test('more than 100 branch tips: one warning says only the 100 newest were checked', async () => {
  const { s } = await open((d) => {
    for (let i = 0; i < 103; i++) {
      git(d, 'checkout', '-q', '-b', `b${i}`, 'main');
      git(d, 'commit', '-q', '--allow-empty', '-m', `tip ${i}`);
    }
    git(d, 'checkout', '-q', 'main');
  });
  const r = await create(s, 'Many branches');
  assert.equal(r.isError, false, r.text);
  const caps = r.env.warnings.filter((x) => /checked the 100 newest branch tips only/.test(x));
  assert.equal(caps.length, 1, JSON.stringify(r.env.warnings));
  assert.ok(caps[0].length <= 200 && caps[0].endsWith('.'));
});

test('a few branches: no cap warning', async () => {
  const { s } = await open((d) => {
    git(d, 'checkout', '-q', '-b', 'one');
    git(d, 'commit', '-q', '--allow-empty', '-m', 'tip');
    git(d, 'checkout', '-q', 'main');
  });
  const r = await create(s, 'Few branches');
  assert.ok(!r.env.warnings.some((x) => /newest branch tips/.test(x)));
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
  assert.match(text, /exists only on another branch, ask me which branch is the keeper/);
  assert.match(text, /own worktree/);
  assert.match(text, /merged or deleted/);
  assert.match(text, /never `git add -A`/);
});
