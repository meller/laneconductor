// Track AM-10115, the Project drawer: the project definition files published as tabs (board.json `project_docs`, `wf`, and one
// `ctx/<key>.json` per tab). Generation side: which files make a tab, the placeholder rule, the privacy scan, include_docs,
// the 200-file accounting, the workflow flow for current, legacy and unreadable workflow.json files. The page side is in board-page.test.mjs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeRepo, writeFile, commitAll, rm, INDEX } from './helpers/repo.mjs';
import { FAKES } from './helpers/fakes.mjs';
import { buildProjectDocs, isPlaceholderOnly, PROJECT_TABS, MAX_DOCS } from '../src/board-docs.mjs';
import { workflowFlow } from '../src/board.mjs';
import { renderScaffold } from '../src/newproject/scaffold.mjs';

const BIN = new URL('../bin/lc-board.mjs', import.meta.url).pathname;
const FIX = new URL('./fixtures/workflow/', import.meta.url).pathname;
const NOW = '2026-11-18T10:00:00.000Z';
const cleanup = [];
after(() => rm(...cleanup));
const real = fs.realpathSync(os.tmpdir());
const tmp = (p) => { const d = fs.mkdtempSync(path.join(real, p)); cleanup.push(d); return d; };
const run = (repo, ...args) => spawnSync('node', [BIN, '--repo', repo, '--now', NOW, ...args], { encoding: 'utf8' });
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const walkFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walkFiles(path.join(dir, d.name)) : [path.join(dir, d.name)]));
const read = (name) => fs.readFileSync(path.join(FIX, name), 'utf8');

const DOCS = {
  'product.md': '# Product: Demo\n\n## What it is\nA demo product.\n',
  'tech-stack.md': '# Tech stack\n\n- Language: JavaScript\n',
  'workflow.md': '# Workflow\n\nCommit often.\n',
  'quality-gate.md': '# Quality Gate\n\n- [ ] Tests: `npm test` (Expected: all pass)\n',
  'kpis.md': '# KPIs\n\n| Metric | Target | Time Horizon | Status | Notes |\n|---|---|---|---|---|\n| Stars | 100 | Q1 | tracking | |\n',
  'product-guidelines.md': '# Product guidelines\n\nBe kind.\n',
  'design-language.md': '# Design language\n\nUse green.\n',
  'code_styleguides/javascript.md': '# JavaScript\n\nUse const.\n',
  'user-stories.md': '# User stories\n\nAs a user I log in.\n',
  'deployment-stack.md': '# Deployment\n\nShips from main.\n',
};

/** A repo with one track and the given conductor files (path relative to conductor/). */
function repoWith(files, { settings = { project: { name: 'Proj Fixture' } }, workflow = true, extraTracks = 0 } = {}) {
  const dir = makeRepo({ workflow });
  cleanup.push(dir);
  if (settings) writeFile(dir, '.laneconductor.json', JSON.stringify(settings));
  writeFile(dir, 'conductor/tracks/AM-601-one/index.md', INDEX(601, 'One', { lane: 'plan', status: 'queue' }));
  for (let n = 0; n < extraTracks; n++) writeFile(dir, `conductor/tracks/AM-${700 + n}-t/index.md`, INDEX(700 + n, `Track ${n}`, { lane: 'plan', status: 'queue' }));
  for (const [rel, text] of Object.entries(files)) writeFile(dir, `conductor/${rel}`, text);
  commitAll(dir);
  return dir;
}
const site = (repo, ...args) => {
  const dir = tmp('lc-proj-site-');
  const r = run(repo, '--site', dir, '--json', ...args);
  assert.equal(r.status, 0, r.stderr);
  return { dir, r, files: JSON.parse(r.stdout).files, board: readJson(path.join(dir, 'board.json')) };
};
const ctx = (s, key) => readJson(path.join(s.dir, 'ctx', `${key}.json`));

test('every definition file present: one tab each, in order, each its own ctx file with the text as written', () => {
  const s = site(repoWith(DOCS));
  assert.deepEqual(s.board.project_docs.map((x) => x.k), ['overview', 'tech-stack', 'workflow', 'quality-gate', 'kpis', 'guidelines', 'stories', 'deployment']);
  assert.deepEqual(s.board.project_docs.map((x) => x.t), ['Overview', 'Tech stack', 'Workflow', 'Quality gate', 'KPIs', 'Guidelines', 'Stories', 'Deployment']);
  assert.deepEqual(s.board.project_docs.map((x) => x.f), s.board.project_docs.map((x) => `ctx/${x.k}.json`));
  assert.deepEqual(Object.keys(s.board.project_docs[0]), ['k', 't', 'f']);
  for (const k of s.board.project_docs) assert.ok(s.files.includes(k.f) && fs.existsSync(path.join(s.dir, k.f)), `${k.f} is published`);
  assert.deepEqual(ctx(s, 'overview'), { k: 'overview', t: 'Overview', md: DOCS['product.md'] });
  assert.equal(ctx(s, 'kpis').md, DOCS['kpis.md']);
  assert.equal(ctx(s, 'workflow').md, DOCS['workflow.md'], 'workflow.md is the text of the Workflow tab (the lanes come from board.json wf)');
  // Guidelines is one tab with a section per file: product guidelines, design language, then the code styleguides.
  const g = ctx(s, 'guidelines').md;
  assert.ok(g.indexOf('## product-guidelines.md') < g.indexOf('## design-language.md') && g.indexOf('## design-language.md') < g.indexOf('## javascript.md'));
  assert.ok(g.includes('Be kind.') && g.includes('Use green.') && g.includes('Use const.'));
  assert.equal(s.r.stderr, '', 'nothing withheld');
});

test('a partial definition: only the files that exist get a tab; no workflow.json means no drawing', () => {
  const s = site(repoWith({ 'product.md': DOCS['product.md'], 'kpis.md': DOCS['kpis.md'] }, { workflow: false }));
  assert.deepEqual(s.board.project_docs.map((x) => x.k), ['overview', 'kpis']);
  assert.ok(!('wf' in s.board));
  assert.deepEqual(fs.readdirSync(path.join(s.dir, 'ctx')).sort(), ['kpis.json', 'overview.json']);
  assert.deepEqual(s.files.filter((f) => f.startsWith('ctx/')), ['ctx/overview.json', 'ctx/kpis.json']);
});

test('nothing to read: no project_docs, no wf, no ctx folder (the page then hides the Project button)', () => {
  const s = site(repoWith({}, { workflow: false }));
  assert.ok(!('project_docs' in s.board) && !('wf' in s.board));
  assert.ok(!fs.existsSync(path.join(s.dir, 'ctx')));
  assert.ok(s.files.every((f) => f === 'board.json' || f.startsWith('docs/')));
});

test('only a workflow.json (no .md files): the Workflow tab exists for the drawing, with an empty text', () => {
  const s = site(repoWith({}));
  assert.deepEqual(s.board.project_docs.map((x) => x.k), ['workflow']);
  assert.deepEqual(ctx(s, 'workflow'), { k: 'workflow', t: 'Workflow', md: '' });
  assert.equal(s.board.wf.lanes.length, 5);
});

test('the untouched scaffold text is not a tab; the same files with real content are', () => {
  const files = Object.fromEntries([...renderScaffold({ name: 'Fresh', summary: 'A fresh project.' })].filter(([p]) => p.endsWith('.md') && p.startsWith('conductor/')).map(([p, c]) => [p.replace(/^conductor\//, ''), c]));
  const s = site(repoWith(files, { workflow: false }));
  // product.md has the summary the person gave; workflow.md is real process text; everything else is placeholders only.
  assert.deepEqual(s.board.project_docs.map((x) => x.k), ['overview', 'workflow']);
  for (const k of ['tech-stack', 'quality-gate', 'kpis', 'guidelines', 'stories']) assert.ok(!fs.existsSync(path.join(s.dir, 'ctx', `${k}.json`)), `${k} has no tab`);
  // Filled in, they appear.
  const filled = renderScaffold({ name: 'Fresh', summary: 'A fresh project.', stack: { language: 'Go' }, commands: { test: 'go test ./...' }, kpis: [{ metric: 'Users', target: '10', horizon: 'Q1' }], journeys: [{ persona: 'Dev', name: 'Sign in', flow: ['open', 'type'] }] });
  const f2 = Object.fromEntries([...filled].filter(([p]) => p.endsWith('.md')).map(([p, c]) => [p.replace(/^conductor\//, ''), c]));
  const s2 = site(repoWith(f2, { workflow: false }));
  assert.deepEqual(s2.board.project_docs.map((x) => x.k), ['overview', 'tech-stack', 'workflow', 'quality-gate', 'kpis', 'stories']);
});

test('isPlaceholderOnly: empty, headings only, scaffold placeholders; not real text next to a placeholder', () => {
  assert.equal(isPlaceholderOnly(''), true);
  assert.equal(isPlaceholderOnly(null), true);
  assert.equal(isPlaceholderOnly('# Title\n\n## Sub\n'), true);
  assert.equal(isPlaceholderOnly('# Product guidelines\n\n## Brand and tone\n(placeholder: not discussed yet)\n'), true);
  assert.equal(isPlaceholderOnly('# User Stories\n\nTODO: no user journey was discussed yet. Add the first one.\n'), true);
  assert.equal(isPlaceholderOnly('# Tech stack\n\n- Language: (not decided yet)\n- Data: (not decided yet)\n'), true);
  assert.equal(isPlaceholderOnly('# Tech stack\n\n- Language: Go\n- Data: (not decided yet)\n'), false);
  assert.equal(isPlaceholderOnly('# G\n\n(placeholder)\n\nReal sentence.\n'), false);
});

test('privacy: a fake secret in kpis.md withholds that tab with a reason; the text is in no published file, stdout or stderr', () => {
  const secret = FAKES['Google API key'];
  const s = site(repoWith({ ...DOCS, 'kpis.md': `# KPIs\n\nmetrics key ${secret}\nagain ${secret}\n` }));
  assert.deepEqual(ctx(s, 'kpis'), { k: 'kpis', t: 'KPIs', withheld: 'possible secret or personal data (2 matches)' });
  assert.ok(s.board.project_docs.some((x) => x.k === 'kpis'), 'the tab stays so the reason can be shown');
  assert.match(s.r.stderr, /withheld project file kpis\.md: 2 possible secret or personal data matches \(lines 3, 4\)/);
  for (const f of walkFiles(s.dir)) assert.ok(!fs.readFileSync(f, 'utf8').includes(secret), `${f} does not hold the secret`);
  assert.ok(!s.r.stdout.includes(secret) && !s.r.stderr.includes(secret));
  assert.equal(ctx(s, 'overview').md, DOCS['product.md'], 'the other tabs are untouched');
});

test('privacy: one withheld file of the Guidelines tab leaves the others readable; an email and a phone number are caught too', () => {
  const email = FAKES['email address'];
  const s = site(repoWith({ ...DOCS, 'product-guidelines.md': `# G\n\nask ${email}\n`, 'user-stories.md': `# S\n\ncall ${FAKES['phone number']}\n` }));
  const g = ctx(s, 'guidelines');
  assert.ok(!('withheld' in g) && g.md.includes('Use green.') && g.md.includes('Use const.'));
  assert.match(g.md, /## product-guidelines\.md\n\n\*withheld: possible secret or personal data \(1 match\); read it in the repository\.\*/);
  assert.match(ctx(s, 'stories').withheld, /^possible secret or personal data \(1 match\)$/);
  for (const f of walkFiles(s.dir)) { const t = fs.readFileSync(f, 'utf8'); assert.ok(!t.includes(email.split('@')[0]) && !t.includes(FAKES['phone number']), f); }
  assert.ok(!s.r.stderr.includes(email.split('@')[0]));
});

test('a Guidelines tab with every file withheld says so once', () => {
  const secret = FAKES['Anthropic or OpenAI key'];
  const s = site(repoWith({ 'product-guidelines.md': `# G\n\n${secret}\n`, 'code_styleguides/a.md': `# A\n\n${secret}\n` }, { workflow: false }));
  assert.deepEqual(ctx(s, 'guidelines'), { k: 'guidelines', t: 'Guidelines', withheld: 'possible secret or personal data (2 matches in 2 files)' });
  for (const f of walkFiles(s.dir)) assert.ok(!fs.readFileSync(f, 'utf8').includes(secret));
});

test('board.include_docs: false turns the project definition off too: no project_docs, no wf, no ctx files', () => {
  const s = site(repoWith(DOCS, { settings: { project: { name: 'Off' }, board: { include_docs: false } } }));
  assert.ok(!('project_docs' in s.board) && !('wf' in s.board));
  assert.ok(!fs.existsSync(path.join(s.dir, 'ctx')));
  assert.deepEqual(s.files, ['board.json']);
  for (const f of walkFiles(s.dir)) assert.ok(!fs.readFileSync(f, 'utf8').includes('A demo product'), f);
});

test('the file cap: ctx files count toward the 200; track documents get what is left and the message stays right', () => {
  const s = site(repoWith(DOCS, { extraTracks: 205 })); // 206 non-done tracks, 8 ctx files
  const ctxFiles = s.files.filter((f) => f.startsWith('ctx/'));
  const docFiles = s.files.filter((f) => f.startsWith('docs/'));
  assert.equal(ctxFiles.length, 8);
  assert.equal(ctxFiles.length + docFiles.length, MAX_DOCS, 'ctx and docs together never pass 200');
  assert.equal(docFiles.length, 192);
  assert.equal(s.files.length, MAX_DOCS + 1, 'plus board.json: well under the 255-file publish limit');
  assert.equal(s.board.docs_dropped, 206 - 192);
  assert.equal(s.board.tracks.filter((t) => t.d).length, 192);
  assert.match(s.r.stderr, /14 track\(s\) have no docs file \(limit 200 per site/);
  assert.ok(PROJECT_TABS.length <= 12, 'at most about 12 ctx files');
});

test('a site folder that is reused loses the ctx files of a tab that is gone', () => {
  const repo = repoWith(DOCS);
  const dir = tmp('lc-proj-reuse-');
  assert.equal(run(repo, '--site', dir).status, 0);
  assert.ok(fs.existsSync(path.join(dir, 'ctx/kpis.json')));
  fs.rmSync(path.join(repo, 'conductor/kpis.md'));
  assert.equal(run(repo, '--site', dir).status, 0);
  assert.ok(!fs.existsSync(path.join(dir, 'ctx/kpis.json')) && fs.existsSync(path.join(dir, 'ctx/overview.json')));
  assert.ok(!readJson(path.join(dir, 'board.json')).project_docs.some((x) => x.k === 'kpis'));
});

test('.laneconductor.json is never published: not in the file list, not on disk, and its values are in no file', () => {
  const token = `${'tok'}en-${'ZXCV-1234-ASDF-5678'}`;
  const settings = { project: { name: 'Settings Fixture' }, board: { artifact_url: `https://example.org/a/${token}`, api_token: token } };
  const s = site(repoWith(DOCS, { settings }));
  for (const f of s.files) assert.ok(f === 'board.json' || /^(?:ctx|docs)\/[A-Za-z0-9-]+\.json$/.test(f), `${f} is a board file`);
  assert.ok(!s.files.some((f) => f.includes('laneconductor')));
  assert.ok(!walkFiles(s.dir).some((f) => /laneconductor/.test(path.basename(f))));
  for (const f of walkFiles(s.dir)) assert.ok(!fs.readFileSync(f, 'utf8').includes(token), `${f} does not hold the setting`);
  assert.ok(!PROJECT_TABS.some((t) => t.files.some((f) => /laneconductor/.test(f))));
  // Even a conductor-folder file that is named like the settings file is not a source.
  const built = buildProjectDocs({ texts: { '.laneconductor.json': `{"t":"${token}"}` } });
  assert.deepEqual(built.tabs, []);
});

// ---- the Workflow tab data -----------------------------------------------------------------------

const lane = (flow, name) => flow.lanes.find((l) => l.name === name);

test('wf for the current format: where each lane sends success and failure (the shared resolver)', () => {
  const s = site(repoWith(DOCS, { workflow: false, settings: null }));
  assert.ok(!('wf' in s.board), 'no workflow.json: no drawing');
  const repo = repoWith({ ...DOCS, 'workflow.json': read('b-current-default.json') }, { workflow: false });
  const t = site(repo);
  const flow = t.board.wf;
  assert.deepEqual(Object.keys(flow), ['lanes']);
  assert.deepEqual(Object.keys(flow.lanes[0]), ['name', 'success', 'failure', 'note']);
  assert.deepEqual(flow, workflowFlow(JSON.parse(read('b-current-default.json'))));
  for (const l of flow.lanes) assert.ok(l.success === null || /^[^:]+:[^:]+$/.test(l.success), `${l.name} success is lane:status`);
  assert.equal(lane(flow, 'implement').success, 'review:queue');
  assert.ok(!JSON.stringify(flow).includes('model'), 'no model names or other settings leave the file');
});

test('wf for a legacy workflow.json (otralingo style, bare targets and old lane names)', () => {
  const flow = workflowFlow(JSON.parse(read('a-otralingo-legacy.json')));
  assert.deepEqual(flow.lanes.map((l) => l.name), Object.keys(JSON.parse(read('a-otralingo-legacy.json')).lanes));
  assert.equal(lane(flow, 'planning').success, 'backlog:queue', 'a bare target on another lane means queue');
  assert.equal(lane(flow, 'in-progress').success, 'review:queue');
  assert.equal(lane(flow, 'in-progress').failure, 'in-progress:failure', 'a bare target on the same lane means the outcome');
  assert.equal(lane(flow, 'review').failure, 'in-progress:queue');
  assert.equal(lane(flow, 'backlog').success, null);
  assert.match(lane(flow, 'backlog').note, /no automatic move/);
});

test('wf never crashes on an unknown or broken format: it lists what it can', () => {
  assert.equal(workflowFlow(null), null);
  assert.equal(workflowFlow({}), null);
  assert.equal(workflowFlow({ lanes: [] }), null);
  assert.equal(workflowFlow({ lanes: 'plan,implement' }), null);
  const odd = workflowFlow({ lanes: { plan: 'implement', build: { on_success: 7, on_failure: ['x'] }, ship: { on_success: 'stay', on_failure: 'stop' }, weird: null, ok: { on_success: 'plan:success' } } });
  assert.deepEqual(odd.lanes.map((l) => l.name), ['plan', 'build', 'ship', 'weird', 'ok']);
  assert.equal(lane(odd, 'ok').success, 'plan:success');
  assert.equal(lane(odd, 'ship').success, null);
  assert.ok(odd.lanes.every((l) => typeof l.note === 'string' && (l.success === null || typeof l.success === 'string')));
  // A very long lane list and long names are cut.
  const many = workflowFlow({ lanes: Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`${'x'.repeat(100)}${i}`, {}])) });
  assert.equal(many.lanes.length, 30);
  assert.ok(many.lanes.every((l) => l.name.length <= 40));
  // The generator, end to end, with a hostile workflow.json: still a board.
  const s = site(repoWith({ 'workflow.json': '{ not json', 'workflow.md': DOCS['workflow.md'] }, { workflow: false }));
  assert.deepEqual(s.board.project_docs.map((x) => x.k), ['workflow']);
  assert.ok(!('wf' in s.board));
});

test('a missing workflow.json with a workflow.md: the tab shows the text, with no drawing', () => {
  const s = site(repoWith({ 'workflow.md': DOCS['workflow.md'] }, { workflow: false }));
  assert.deepEqual(s.board.project_docs.map((x) => x.k), ['workflow']);
  assert.equal(ctx(s, 'workflow').md, DOCS['workflow.md']);
  assert.ok(!('wf' in s.board));
});

test('a secret in a lane name withholds the drawing, not the board', () => {
  const secret = FAKES['Anthropic or OpenAI key'];
  const repo = repoWith({ 'workflow.json': JSON.stringify({ lanes: { [`plan ${secret}`]: { on_success: 'done' } } }) }, { workflow: false });
  const t = site(repo);
  assert.ok(!('wf' in t.board) && !('project_docs' in t.board));
  assert.match(t.r.stderr, /withheld the workflow drawing/);
  // (board.json's own `lanes` list predates the Project drawer and is not part of this change.)
  assert.ok(!fs.existsSync(path.join(t.dir, 'ctx')), 'no ctx file was written');
  assert.ok(!t.r.stderr.includes(secret));
});

test('buildProjectDocs: pure; more than the usual styleguides are cut at six', () => {
  const texts = { 'product.md': '# P\n\nreal\n' };
  for (let i = 0; i < 9; i++) texts[`code_styleguides/s${i}.md`] = `# S${i}\n\ntext ${i}\n`;
  texts['code_styleguides/notes.txt'] = 'not markdown';
  const { tabs, ctx: files } = buildProjectDocs({ texts });
  assert.deepEqual(tabs.map((t) => t.k), ['overview', 'guidelines']);
  const g = files.find((f) => f.name === 'ctx/guidelines.json').doc.md;
  assert.equal((g.match(/^## /gm) ?? []).length, 6);
  assert.ok(!g.includes('not markdown'));
});
