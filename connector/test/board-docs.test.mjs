// Phase 5d Task 7: the documents behind the track detail. `lc-board.mjs --site` writes
// docs/<number>.json for tracks that are not done; privacy scan, caps, conversation flag, GitHub URL.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeRepo, writeFile, commitAll, git, rm, INDEX } from './helpers/repo.mjs';
import { FAKES } from './helpers/fakes.mjs';
import { githubBase, githubFolderUrl, selectDocTracks, buildDoc, capText, MAX_DOC_CHARS, MAX_DOCS } from '../src/board-docs.mjs';
import { buildBoard } from '../src/board.mjs';

const BIN = new URL('../bin/lc-board.mjs', import.meta.url).pathname;
const NOW = '2026-11-17T10:00:00.000Z';
const cleanup = [];
after(() => rm(...cleanup));
const real = fs.realpathSync(os.tmpdir());
const tmp = (p) => { const d = fs.mkdtempSync(path.join(real, p)); cleanup.push(d); return d; };
const run = (repo, ...args) => spawnSync('node', [BIN, '--repo', repo, '--now', NOW, ...args], { encoding: 'utf8' });
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const walkFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walkFiles(path.join(dir, d.name)) : [path.join(dir, d.name)]));

const FOLDER = { 401: 'AM-401-planned', 402: 'AM-402-built', 403: 'AM-403-shipped', 404: 'AM-404-parked' };
function fixture({ board, remote, branch = 'main' } = {}) {
  const dir = makeRepo({ branch });
  cleanup.push(dir);
  writeFile(dir, '.laneconductor.json', JSON.stringify({ project: { name: 'Docs Fixture' }, ...(board ? { board } : {}) }));
  const t = (n, title, lane, status) => writeFile(dir, `conductor/tracks/${FOLDER[n]}/index.md`, INDEX(n, title, { lane, status }));
  t(401, 'Planned one', 'plan', 'queue');
  t(402, 'Built one', 'implement', 'running');
  t(403, 'Shipped one', 'done', 'success');
  t(404, 'Parked one', 'backlog', 'queue');
  for (const n of [401, 402, 403, 404]) {
    writeFile(dir, `conductor/tracks/${FOLDER[n]}/plan.md`, `# Plan ${n}\n\n- [ ] task for ${n}\n`);
    writeFile(dir, `conductor/tracks/${FOLDER[n]}/spec.md`, `# Spec ${n}\n\nspec text ${n}\n`);
    writeFile(dir, `conductor/tracks/${FOLDER[n]}/test.md`, `# Tests ${n}\n`);
    writeFile(dir, `conductor/tracks/${FOLDER[n]}/conversation.md`, `> **human**: CONVERSATION-SENTINEL-${n}\n`);
  }
  writeFile(dir, 'conductor/tracks/_duplicate-401-planned/index.md', INDEX(401, 'Archived copy', { lane: 'plan' }));
  commitAll(dir);
  if (remote) git(dir, 'remote', 'add', 'origin', remote);
  return dir;
}

test('docs: written for live tracks that are not done, with the documented shape', () => {
  const repo = fixture();
  const site = tmp('lc-docs-');
  const r = run(repo, '--site', site);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(fs.readdirSync(path.join(site, 'docs')).sort(), ['401.json', '402.json', '404.json']);
  const d = readJson(path.join(site, 'docs', '401.json'));
  assert.deepEqual(Object.keys(d), ['n', 'folder', 'index', 'plan', 'spec', 'test']);
  assert.equal(d.n, 401);
  assert.equal(d.folder, FOLDER[401]);
  assert.match(d.index, /Track AM-401: Planned one/);
  assert.equal(d.plan, '# Plan 401\n\n- [ ] task for 401\n');
  assert.equal(d.spec, '# Spec 401\n\nspec text 401\n');
  assert.equal(d.test, '# Tests 401\n');
  assert.ok(!('conversation' in d) && !('withheld' in d));
  assert.ok(!fs.readFileSync(path.join(site, 'docs', '401.json'), 'utf8').includes('Archived copy'), 'the archived copy is never used');
  // board.json says which tracks have docs.
  const j = readJson(path.join(site, 'board.json'));
  assert.deepEqual(Object.fromEntries(j.tracks.map((t) => [t.n, t.d])), { 401: true, 402: true, 403: false, 404: true });
  assert.ok(!('docs_dropped' in j));
});

test('docs: a missing file is an empty string, not an error', () => {
  const repo = fixture();
  fs.rmSync(path.join(repo, 'conductor/tracks', FOLDER[404], 'test.md'));
  const site = tmp('lc-docs-');
  assert.equal(run(repo, '--site', site).status, 0);
  assert.equal(readJson(path.join(site, 'docs/404.json')).test, '');
});

test('conversation: absent by default, present only with board.include_conversation: true', () => {
  const site = tmp('lc-conv-off-');
  assert.equal(run(fixture(), '--site', site).status, 0);
  for (const f of walkFiles(site)) assert.ok(!fs.readFileSync(f, 'utf8').includes('CONVERSATION-SENTINEL'), `${f} has no conversation text by default`);
  const explicitOff = tmp('lc-conv-off2-');
  assert.equal(run(fixture({ board: { include_conversation: false } }), '--site', explicitOff).status, 0);
  assert.ok(!('conversation' in readJson(path.join(explicitOff, 'docs/401.json'))));

  const on = tmp('lc-conv-on-');
  assert.equal(run(fixture({ board: { include_conversation: true } }), '--site', on).status, 0);
  const d = readJson(path.join(on, 'docs/401.json'));
  assert.equal(d.conversation, '> **human**: CONVERSATION-SENTINEL-401\n');
  assert.deepEqual(Object.keys(d), ['n', 'folder', 'index', 'plan', 'spec', 'test', 'conversation']);
  assert.ok(!fs.existsSync(path.join(on, 'docs/403.json')));
});

test('conversation: goes through the scan; a match withholds just that conversation', () => {
  const repo = fixture({ board: { include_conversation: true } });
  writeFile(repo, `conductor/tracks/${FOLDER[402]}/conversation.md`, `> **human**: my mail is ${FAKES['email address']}\n`);
  const site = tmp('lc-conv-scan-');
  const r = run(repo, '--site', site);
  assert.equal(r.status, 0, r.stderr);
  const d = readJson(path.join(site, 'docs/402.json'));
  assert.ok(!('conversation' in d));
  assert.match(d.withheld.conversation, /^possible secret or personal data \(1 match\)$/);
  assert.ok(d.plan.includes('Plan 402'), 'the other files of that track are still embedded');
  assert.ok(!r.stderr.includes(FAKES['email address']) && !r.stdout.includes(FAKES['email address']));
  assert.ok(/withheld track 402 conversation\.md/.test(r.stderr));
  for (const f of walkFiles(site)) assert.ok(!fs.readFileSync(f, 'utf8').includes(FAKES['email address'].split('@')[0]));
});

test('board.include_docs: false writes no docs/ and every d is false', () => {
  const repo = fixture({ board: { include_docs: false, include_conversation: true } });
  const site = tmp('lc-nodocs-');
  const r = run(repo, '--site', site, '--json');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!fs.existsSync(path.join(site, 'docs')));
  assert.deepEqual(JSON.parse(r.stdout).files, ['board.json']);
  const j = readJson(path.join(site, 'board.json'));
  assert.ok(j.tracks.every((t) => t.d === false && !('gh' in t)));
});

test('privacy: a spec with a fake secret is withheld (field omitted, reason recorded); the plan is still embedded; the secret is written nowhere', () => {
  const repo = fixture();
  const secret = FAKES['Google API key'];
  writeFile(repo, `conductor/tracks/${FOLDER[402]}/spec.md`, `# Spec\n\nuse the key ${secret} for maps\nand again ${secret}\n`);
  const site = tmp('lc-withheld-');
  const r = run(repo, '--site', site, '--json');
  assert.equal(r.status, 0, r.stderr);
  const d = readJson(path.join(site, 'docs/402.json'));
  assert.ok(!('spec' in d), 'the field is omitted');
  assert.deepEqual(d.withheld, { spec: 'possible secret or personal data (2 matches)' });
  assert.equal(d.plan, '# Plan 402\n\n- [ ] task for 402\n');
  assert.ok(d.index.includes('Track AM-402'));
  for (const f of walkFiles(site)) assert.ok(!fs.readFileSync(f, 'utf8').includes(secret), `${f} does not hold the secret`);
  assert.ok(!r.stdout.includes(secret) && !r.stderr.includes(secret));
  assert.equal(JSON.parse(r.stdout).files.length, 5, 'a withheld file does not drop the docs file (board.json, the workflow ctx file, three docs)');
  assert.match(r.stderr, /withheld track 402 spec\.md: 2 possible secret or personal data matches \(lines 3, 4\)/);
  // The other tracks are untouched.
  assert.ok(readJson(path.join(site, 'docs/401.json')).spec.includes('spec text 401'));
});

test('truncation: a file over 60,000 characters is cut with a visible note', () => {
  assert.equal(capText('x'.repeat(MAX_DOC_CHARS)), 'x'.repeat(MAX_DOC_CHARS));
  const big = capText('y'.repeat(MAX_DOC_CHARS + 50));
  assert.equal(big, `${'y'.repeat(MAX_DOC_CHARS)}\n\n[truncated]`);
  const repo = fixture();
  writeFile(repo, `conductor/tracks/${FOLDER[401]}/plan.md`, `${'line of plan text\n'.repeat(5000)}`);
  const site = tmp('lc-trunc-');
  assert.equal(run(repo, '--site', site).status, 0);
  const p = readJson(path.join(site, 'docs/401.json')).plan;
  assert.ok(p.endsWith('\n\n[truncated]'));
  assert.equal(p.length, MAX_DOC_CHARS + '\n\n[truncated]'.length);
});

test('cap: at most 200 docs files; the oldest backlog tracks are dropped first and counted in board.json', () => {
  const repo = makeRepo();
  cleanup.push(repo);
  writeFile(repo, '.laneconductor.json', JSON.stringify({ project: { name: 'Many' } }));
  for (let n = 501; n <= 515; n++) writeFile(repo, `conductor/tracks/AM-${n}-b${n}/index.md`, INDEX(n, `Backlog ${n}`, { lane: 'backlog' }));
  for (let n = 516; n <= 710; n++) writeFile(repo, `conductor/tracks/AM-${n}-p${n}/index.md`, INDEX(n, `Plan ${n}`, { lane: 'plan' }));
  writeFile(repo, 'conductor/tracks/AM-720-done/index.md', INDEX(720, 'Done', { lane: 'done', status: 'success' }));
  commitAll(repo);
  const site = tmp('lc-cap-');
  const r = run(repo, '--site', site, '--json');
  assert.equal(r.status, 0, r.stderr);
  const files = fs.readdirSync(path.join(site, 'docs'));
  // The fixture's workflow.json gives one ctx file (the Workflow tab); it counts toward the same 200-file cap.
  assert.equal(fs.readdirSync(path.join(site, 'ctx')).length, 1);
  assert.equal(files.length, MAX_DOCS - 1);
  assert.ok(!files.includes('501.json') && !files.includes('511.json') && files.includes('512.json') && files.includes('710.json'));
  const j = readJson(path.join(site, 'board.json'));
  assert.equal(j.docs_dropped, 11);
  assert.equal(j.tracks.filter((t) => t.d).length, 199);
  assert.equal(j.tracks.find((t) => t.n === 501).d, false);
  assert.equal(JSON.parse(r.stdout).files.length, 201, 'board.json plus 200 other files (ctx and docs): within the 255-file publish limit');
  assert.match(r.stderr, /11 track\(s\) have no docs file/);
  // selectDocTracks directly: backlog first, then the lowest numbers.
  const board = buildBoard([
    { folder: 'AM-1-a', index: { content: INDEX(1, 'A', { lane: 'plan' }) } },
    { folder: 'AM-2-b', index: { content: INDEX(2, 'B', { lane: 'backlog' }) } },
    { folder: 'AM-3-c', index: { content: INDEX(3, 'C', { lane: 'plan' }) } },
  ], { generatedAt: NOW });
  const two = selectDocTracks(board, { max: 2 });
  assert.deepEqual(two.keep.map((k) => k.number).sort((x, y) => x - y), [1, 3]);
  assert.equal(two.dropped, 1);
  assert.deepEqual(selectDocTracks(board, { max: 1 }).keep.map((k) => k.number), [3]);
});

test('numbers shared by two live folders get no docs (docs/<n>.json could not tell them apart); legacy folder names work', () => {
  const repo = makeRepo();
  cleanup.push(repo);
  writeFile(repo, 'conductor/tracks/AM-601-a/index.md', INDEX(601, 'One', { lane: 'plan' }));
  writeFile(repo, 'conductor/tracks/AM-601-b/index.md', INDEX(601, 'Two', { lane: 'plan' }));
  writeFile(repo, 'conductor/tracks/602-legacy/index.md', INDEX(602, 'Legacy', { lane: 'plan' }));
  commitAll(repo);
  const site = tmp('lc-dup-');
  assert.equal(run(repo, '--site', site).status, 0);
  assert.deepEqual(fs.readdirSync(path.join(site, 'docs')), ['602.json']);
  assert.equal(readJson(path.join(site, 'docs/602.json')).folder, '602-legacy');
});

test('githubBase: ssh and https remotes are normalised; anything else is null', () => {
  for (const r of ['git@github.com:acme/widgets.git', 'git@github.com:acme/widgets', 'ssh://git@github.com/acme/widgets.git', 'https://github.com/acme/widgets.git', 'https://github.com/acme/widgets', 'https://github.com/acme/widgets/', 'https://x-access-token:abc@github.com/acme/widgets.git\n', 'HTTPS://GitHub.com/acme/widgets.git']) {
    assert.equal(githubBase(r), 'https://github.com/acme/widgets', r);
  }
  assert.equal(githubBase('https://github.com/a.b/c_d-e.git'), 'https://github.com/a.b/c_d-e');
  for (const r of ['', null, undefined, 'git@gitlab.com:acme/widgets.git', 'https://gitlab.com/acme/widgets.git', 'https://github.com.evil.example/acme/widgets', 'https://github.com/acme', '/some/local/path', 'git@github.com:acme/widgets/extra.git', 'https://evil.example/https://github.com/acme/widgets']) {
    assert.equal(githubBase(r), null, String(r));
  }
  assert.equal(githubFolderUrl('https://github.com/a/b', 'main', 'AM-1-x y'), 'https://github.com/a/b/tree/main/conductor/tracks/AM-1-x%20y');
  assert.equal(githubFolderUrl('https://github.com/a/b', 'rel/1.0', 'AM-1-x'), 'https://github.com/a/b/tree/rel/1.0/conductor/tracks/AM-1-x');
});

test('gh: done tracks get a GitHub folder URL from an ssh or https origin; none without a github remote', () => {
  const cases = [
    ['git@github.com:acme/widgets.git', `https://github.com/acme/widgets/tree/main/conductor/tracks/${FOLDER[403]}`],
    ['https://github.com/acme/widgets.git', `https://github.com/acme/widgets/tree/main/conductor/tracks/${FOLDER[403]}`],
    ['https://gitlab.com/acme/widgets.git', undefined],
    [undefined, undefined],
  ];
  for (const [remote, want] of cases) {
    const site = tmp('lc-gh-');
    const r = run(fixture({ remote }), '--site', site);
    assert.equal(r.status, 0, r.stderr);
    const j = readJson(path.join(site, 'board.json'));
    const done = j.tracks.find((t) => t.n === 403);
    assert.equal(done.gh, want, String(remote));
    assert.ok(j.tracks.filter((t) => t.n !== 403).every((t) => !('gh' in t)), 'only done tracks carry gh');
  }
  // The default branch name is resolved like the state branch (here: the current branch master).
  const site = tmp('lc-gh-master-');
  assert.equal(run(fixture({ remote: 'git@github.com:acme/widgets.git', branch: 'master' }), '--site', site).status, 0);
  assert.equal(readJson(path.join(site, 'board.json')).tracks.find((t) => t.n === 403).gh, `https://github.com/acme/widgets/tree/master/conductor/tracks/${FOLDER[403]}`);
});

test('--json: stdout is exactly one { page, root, files } object; the plain two-line output is unchanged without it', () => {
  const repo = fixture();
  const site = tmp('lc-json-');
  const r = run(repo, '--site', site, '--json');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.endsWith('}\n') && r.stdout.trim().split('\n').length === 1);
  const o = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(o), ['page', 'root', 'files']);
  assert.equal(o.page, path.join(site, 'board.html'));
  assert.equal(o.root, site);
  assert.deepEqual(o.files, ['board.json', 'ctx/workflow.json', 'docs/401.json', 'docs/402.json', 'docs/404.json']);
  for (const f of o.files) assert.ok(fs.existsSync(path.join(o.root, f)), f);
  assert.ok(path.isAbsolute(o.page) && path.isAbsolute(o.root));

  const plain = run(repo, '--site', tmp('lc-plain-'));
  assert.equal(plain.stdout.trim().split('\n').length, 2);
  assert.ok(!plain.stdout.includes('{'));
});

test('--site reused: a docs file of a track that is no longer published does not survive', () => {
  const repo = fixture();
  const site = tmp('lc-reuse-');
  assert.equal(run(repo, '--site', site).status, 0);
  assert.ok(fs.existsSync(path.join(site, 'docs/402.json')));
  writeFile(repo, `conductor/tracks/${FOLDER[402]}/index.md`, INDEX(402, 'Built one', { lane: 'done', status: 'success' }));
  assert.equal(run(repo, '--site', site).status, 0);
  assert.ok(!fs.existsSync(path.join(site, 'docs/402.json')));
  assert.deepEqual(fs.readdirSync(path.join(site, 'docs')).sort(), ['401.json', '404.json']);
});

test('buildDoc: pure; a missing conversation file adds no key even when the flag is on', () => {
  const { doc, withheld } = buildDoc({ number: 7, folder: 'AM-7-x', texts: { index: 'i', plan: null, spec: 's', test: '', conversation: null }, includeConversation: true });
  assert.deepEqual(doc, { n: 7, folder: 'AM-7-x', index: 'i', plan: '', spec: 's', test: '' });
  assert.deepEqual(withheld, []);
});
