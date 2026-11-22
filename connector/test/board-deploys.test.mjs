// Track AM-10156 (task 9, REQ-6): the Deployment tab of the Project drawer shows what the deploy records say. Generation side: the
// records under conductor/deploys/ are read when the board is built, scanned one by one, and put into ctx/deployment.json. The page side is
// at the end of board-page.test.mjs. A board built for a project with no records is unchanged.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeRepo, writeFile, commitAll, rm, INDEX } from './helpers/repo.mjs';
import { recordFileName } from '../src/deploys.mjs';
import { buildProjectDocs } from '../src/board-docs.mjs';

const BIN = new URL('../bin/lc-board.mjs', import.meta.url).pathname;
const NOW = '2026-11-22T12:00:00.000Z';
const cleanup = [];
after(() => rm(...cleanup));
const real = fs.realpathSync(os.tmpdir());
const tmp = (p) => { const d = fs.mkdtempSync(path.join(real, p)); cleanup.push(d); return d; };
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const walkFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walkFiles(path.join(dir, d.name)) : [path.join(dir, d.name)]));

function record(o) {
  return `# Deploy ${o.env} ${o.time}\n\nenvironment: ${o.env}\ntime: ${o.time}\ncommit: ${o.commit}\nbuild version: ${o.version}\ncommand: ${o.command ?? 'firebase deploy --only hosting --project demo-site'}\nresult: ${o.result ?? 'success'}\nlog: conductor/logs/deploy-${o.env}.log\napproved by: ${o.by ?? 'ana'}\nprevious good record: none\n${o.kind ? `kind: ${o.kind}\n` : ''}${o.production ? 'production: yes\n' : ''}`;
}
const REC = [
  { env: 'prod', time: '2026-11-20T10:00:00Z', commit: 'aaaaaaa', version: '1.0.0', production: true },
  { env: 'prod', time: '2026-11-21T10:00:00Z', commit: 'bbbbbbb', version: '1.1.0', production: true },
  { env: 'prod', time: '2026-11-22T09:00:00Z', commit: 'ccccccc', version: '1.2.0', result: 'failed', by: 'ben', production: true },
  { env: 'staging', time: '2026-11-21T08:00:00Z', commit: 'bbbbbbb', version: '1.1.0' },
];
function repoWith({ records = REC, stack = '# Deployment\n\nShips from main.\n', settings = { project: { name: 'Deploy Fixture' } }, extra = {} } = {}) {
  const dir = makeRepo({ workflow: true });
  cleanup.push(dir);
  if (settings) writeFile(dir, '.laneconductor.json', JSON.stringify(settings));
  writeFile(dir, 'conductor/tracks/AM-901-one/index.md', INDEX(901, 'One', { lane: 'plan', status: 'queue' }));
  if (stack !== null) writeFile(dir, 'conductor/deployment-stack.md', stack);
  for (const r of records) writeFile(dir, `conductor/deploys/${recordFileName(r.env, r.time)}`, record(r));
  for (const [rel, text] of Object.entries(extra)) writeFile(dir, rel, text);
  commitAll(dir);
  return dir;
}
function site(repo) {
  const dir = tmp('lc-deploys-site-');
  const r = spawnSync('node', [BIN, '--repo', repo, '--now', NOW, '--site', dir, '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return { dir, r, board: readJson(path.join(dir, 'board.json')), files: JSON.parse(r.stdout).files };
}
const ctx = (s, key = 'deployment') => readJson(path.join(s.dir, 'ctx', `${key}.json`));

test('records: the Deployment tab shows each environment\'s live version, time and result and the history, newest first, with the stack text after it', () => {
  const s = site(repoWith());
  const tab = s.board.project_docs.find((x) => x.k === 'deployment');
  assert.deepEqual(tab, { k: 'deployment', t: 'Deployment', f: 'ctx/deployment.json' });
  const d = ctx(s);
  assert.deepEqual(d.deploys, ['prod', 'staging'], 'the environments, for the Copy buttons');
  const md = d.md;
  const prod = md.slice(md.indexOf('## prod'), md.indexOf('## staging'));
  assert.match(prod, /## prod \(production\)/);
  assert.match(prod, /Live: version 1\.1\.0, deployed 2026-11-21T10:00:00Z, success, commit bbbbbbb, approved by ana\./);
  const rows = prod.split('\n').filter((l) => /^\| 2026/.test(l));
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((l) => l.split('|')[2].trim()), ['1.2.0', '1.1.0', '1.0.0'], 'newest first, the failed run included');
  assert.match(rows[0], /\| failed \|/);
  assert.match(rows[1], /\| live \|\s*$/);
  assert.match(md, /## staging\n\nLive: version 1\.1\.0/);
  assert.ok(md.includes('Ships from main.'), 'the stack text is still there');
  assert.ok(md.indexOf('## prod') < md.indexOf('Ships from main.'), 'what is live comes first');
  assert.ok(!('withheld' in d));
});

test('records: a rollback is an entry in the history and the restored version is the live one', () => {
  const recs = [...REC, { env: 'prod', time: '2026-11-22T11:00:00Z', commit: 'aaaaaaa', version: '1.0.0', kind: 'rollback', production: true }];
  const md = ctx(site(repoWith({ records: recs }))).md;
  assert.match(md, /Live: version 1\.0\.0, deployed 2026-11-22T11:00:00Z, success \(rollback\)/);
  assert.match(md, /\| 2026-11-22T11:00:00Z \| 1\.0\.0 \| aaaaaaa \| success \(rollback\) \| ana \| live \|/);
});

test('records and no deployment-stack.md: the tab exists with the records alone', () => {
  const s = site(repoWith({ stack: null }));
  assert.ok(s.board.project_docs.some((x) => x.k === 'deployment'));
  const d = ctx(s);
  assert.match(d.md, /^# Deploys/);
  assert.deepEqual(d.deploys, ['prod', 'staging']);
});

test('TC-6 secret scan: a record with a token-shaped value is withheld with the standard placeholder and contributes nothing else', () => {
  const TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
  const recs = [...REC, { env: 'prod', time: '2026-11-22T11:30:00Z', commit: 'ddddddd', version: TOKEN, production: true }];
  const dir = repoWith({ records: recs });
  const s = site(dir);
  const out = fs.readFileSync(path.join(s.dir, 'ctx', 'deployment.json'), 'utf8');
  assert.ok(!out.includes(TOKEN), 'the token is not in the tab');
  for (const f of walkFiles(s.dir)) assert.ok(!fs.readFileSync(f, 'utf8').includes(TOKEN), `${path.relative(s.dir, f)} has no token`);
  assert.ok(!out.includes('ddddddd'), 'no other field of the withheld record is shown either');
  const md = JSON.parse(out).md;
  assert.match(md, /\| 2026-11-22T11:30:00Z \| withheld: possible secret or personal data \(1 match\) \|/);
  assert.match(md, /Live: not known from this board: a newer record was withheld.*the last published good record is version 1\.1\.0 at 2026-11-21T10:00:00Z/, 'a newer withheld record means the live version is not known here');
  assert.ok(!/\| live \|/.test(md.slice(md.indexOf('## prod'), md.indexOf('## staging'))), 'no row is marked live in that environment');
  assert.match(md.slice(md.indexOf('## staging')), /Live: version 1\.1\.0, deployed 2026-11-21T08:00:00Z/, 'another environment is unaffected');
  assert.match(s.r.stderr, /board: withheld deploy record prod-20261122T113000Z\.md: 1 possible secret or personal data match/);
  assert.ok(!s.r.stderr.includes(TOKEN));
  // a secret in the command is withheld the same way
  const cmdRec = [{ env: 'prod', time: '2026-11-22T11:30:00Z', commit: 'eeeeeee', version: '2.0.0', command: 'FIREBASE_TOKEN=1//0gAbCdEfGhIjKlMnOpQr firebase deploy' }];
  const s2 = site(repoWith({ records: cmdRec }));
  assert.ok(!fs.readFileSync(path.join(s2.dir, 'ctx/deployment.json'), 'utf8').includes('1//0gAbCd'));
});

test('no records: the Deployment tab is byte-identical to a board with no deploys folder, and non-record files in it are ignored', () => {
  const plain = ctx(site(repoWith({ records: [] })));
  assert.ok(!('deploys' in plain));
  assert.equal(plain.md, '# Deployment\n\nShips from main.\n');
  const withJunk = site(repoWith({ records: [], extra: { 'conductor/deploys/README.md': '# notes\n', 'conductor/deploys/prod.md': 'environment: prod\n' } }));
  assert.equal(fs.readFileSync(path.join(withJunk.dir, 'ctx/deployment.json'), 'utf8'), `${JSON.stringify(plain)}\n`);
  // no stack, no records: no tab at all
  const none = site(repoWith({ records: [], stack: null }));
  assert.ok(!none.board.project_docs?.some((x) => x.k === 'deployment'));
  assert.ok(!none.files.includes('ctx/deployment.json'));
});

test('include_docs false: the records are not published', () => {
  const s = site(repoWith({ settings: { project: { name: 'X' }, board: { include_docs: false } } }));
  assert.ok(!s.board.project_docs?.some((x) => x.k === 'deployment'));
  assert.ok(!fs.existsSync(path.join(s.dir, 'ctx')) || !fs.readdirSync(path.join(s.dir, 'ctx')).includes('deployment.json'));
});

test('an environment name that is not safe for a copied prompt is left out of the Copy list and the tab', () => {
  const recs = [REC[1], { env: 'Bad Name', time: '2026-11-21T10:00:00Z', commit: 'fffffff', version: '9.9.9' }];
  const dir = makeRepo({ workflow: true });
  cleanup.push(dir);
  writeFile(dir, 'conductor/tracks/AM-901-one/index.md', INDEX(901, 'One', { lane: 'plan', status: 'queue' }));
  writeFile(dir, `conductor/deploys/${recordFileName('prod', recs[0].time)}`, record(recs[0]));
  writeFile(dir, 'conductor/deploys/Bad Name-20261121T100000Z.md', record(recs[1]));
  commitAll(dir);
  const d = ctx(site(dir));
  assert.deepEqual(d.deploys, ['prod']);
  assert.ok(!d.md.includes('9.9.9'));
});

test('buildProjectDocs: the deploys argument makes the tab; a withheld stack file does not hide the records', () => {
  const deploys = { md: '# Deploys\n\n## prod\n\nLive: version 1.0.0.\n', envs: ['prod'] };
  const a = buildProjectDocs({ texts: { 'deployment-stack.md': '# Stack\n\npassword: hunter2hunter2\n' }, deploys });
  assert.equal(a.ctx[0].doc.withheld, undefined);
  assert.match(a.ctx[0].doc.md, /^# Deploys/);
  assert.match(a.ctx[0].doc.md, /withheld: possible secret or personal data/);
  assert.deepEqual(a.ctx[0].doc.deploys, ['prod']);
  assert.equal(a.withheld.length, 1);
  const b = buildProjectDocs({ texts: {} });
  assert.deepEqual(b.tabs, []);
});
