// Track AM-10124 (skill advisor), Phase 2: the catalog (connector/plugin-extras/recommended-plugins.json) and its checker
// (scripts/check-catalog.mjs). TC-1: the entry fields, and a checker that fails on a missing field, an unknown lane or Type, an
// unresolvable source or a private-looking name. TC-2: our own entries first, a finder only as the third-party fallback. TC-3: the lane
// guides and the catalog agree. TC-14: every lane and Type is covered. The online check runs against a fixture (no network in the tests);
// `node scripts/check-catalog.mjs --online` is the real one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { REPO } from '../../scripts/build-plugin.mjs';
import { RECOMMENDED, FALLBACK, offerOrder, entriesForLanes } from '../../scripts/plugin-texts.mjs';
import { checkCatalog, checkEntry, checkCatalogOnline, coverageProblems, derivedInstall, pluginLocation, LANES, TYPES, KINDS, LEVELS, REQUIRED } from '../../scripts/check-catalog.mjs';

const CATALOG_PATH = path.join(REPO, 'connector/plugin-extras/recommended-plugins.json');
const live = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));

// A small valid catalog that covers every lane and Type, built by hand so a test can break one thing at a time.
const entry = (over = {}) => {
  const e = {
    name: 'demo-pack', kind: 'thirdparty', display: 'Demo Pack', source: { marketplace: 'demomarket', add: 'someone/demo-market', plugin: 'demo-pack' },
    licence: 'MIT', installs_code: false, why: 'a pack of demo skills for the tests of the checker', lanes: [...LANES], types: [...TYPES], stack: [],
    level: 'helps', install: ['claude plugin marketplace add someone/demo-market', 'claude plugin install demo-pack@demomarket'],
    skills: [], detect: 'a skill named `demo-skill` is in the skills list', verified: '2026-11-18: fixture',
  };
  return Object.assign(e, over);
};
const catalog = (entries = [entry()], over = {}) => ({ checked: '2026-11-18', stack_tags: { ui: 'a front-end stack' }, entries, ...over });

test('TC-1 the live catalog passes the checker offline: every field, dated, every lane and Type covered', () => {
  assert.deepEqual(checkCatalog(live), []);
  assert.match(live.checked, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(live.entries.length >= 10);
  for (const e of live.entries) {
    for (const f of REQUIRED) assert.ok(f in e, `${e.name}: ${f}`);
    assert.ok(KINDS.includes(e.kind) && LEVELS.includes(e.level));
    assert.deepEqual(e.install, derivedInstall(e), `${e.name}: install commands follow the source`);
    assert.match(e.verified, /^\d{4}-\d{2}-\d{2}: /, `${e.name}: says when and how it was checked`);
    assert.match(e.source.add, /^[\w.-]+\/[\w.-]+$/, `${e.name}: a public GitHub owner/repo`);
    for (const c of e.install) assert.ok(c.startsWith('claude plugin ') && !c.startsWith('$'), c);
  }
  assert.ok(live.stack_tags && Object.keys(live.stack_tags).length >= 3);
});

test('TC-1 the checker accepts a valid fixture and names the field when one is missing', () => {
  assert.deepEqual(checkCatalog(catalog()), []);
  for (const f of REQUIRED) {
    const e = entry();
    delete e[f];
    const problems = checkEntry(e, { lanes: LANES, types: TYPES, stack: ['ui'] });
    assert.ok(problems.some((p) => p.includes(`missing field \`${f}\``)), `${f}: ${problems.join(' | ')}`);
  }
  const noDate = catalog();
  delete noDate.checked;
  assert.ok(checkCatalog(noDate).some((p) => p.includes('`checked` date')));
  assert.ok(checkCatalog(catalog([entry({ installs_code: true })])).some((p) => p.includes('`installs` must say what it installs')));
  assert.ok(checkCatalog(catalog([entry(), entry()])).some((p) => p.includes('listed twice')));
});

test('TC-1 the checker fails on an unknown lane, Type, kind, level or stack tag', () => {
  const bad = (over) => checkCatalog(catalog([entry(over)]), { coverage: false });
  assert.ok(bad({ lanes: ['plan', 'qualityGate'] }).some((p) => p.includes('unknown lane `qualityGate`')));
  assert.ok(bad({ types: ['dev', 'ops'] }).some((p) => p.includes('unknown track Type `ops`')));
  assert.ok(bad({ kind: 'plugin' }).some((p) => p.includes('unknown kind')));
  assert.ok(bad({ level: 'nice' }).some((p) => p.includes('unknown level')));
  assert.ok(bad({ stack: ['cobol'] }).some((p) => p.includes('unknown stack tag `cobol`')));
  assert.ok(bad({ skills: [{ name: 'x', lanes: ['nowhere'] }] }).some((p) => p.includes('unknown lane `nowhere`')));
  assert.ok(bad({ lanes: ['plan'], skills: [{ name: 'x', lanes: ['merge'] }] }).some((p) => p.includes('not among the entry\'s lanes')));
});

test('TC-1 the checker fails on a source that cannot resolve (not a public GitHub repository) and on install commands that differ from it', () => {
  const bad = (src, extra = {}) => checkCatalog(catalog([entry({ source: { marketplace: 'demomarket', add: 'someone/demo-market', plugin: 'demo-pack', ...src }, ...extra })]), { coverage: false });
  assert.ok(bad({ add: '/home/someone/market' }).some((p) => p.includes('not a public GitHub `owner/repo`')));
  assert.ok(bad({ add: 'https://example.com/m.json' }).some((p) => p.includes('not a public GitHub `owner/repo`')));
  assert.ok(bad({ add: 'git@github.com:a/b' }).length > 0);
  assert.ok(bad({ plugin: undefined }).some((p) => p.includes('source is missing `plugin`')));
  assert.ok(bad({ add: 'someone/other' }).some((p) => p.includes('differs from the commands derived from the source')));
  assert.ok(bad({}, { install: ['claude plugin install demo-pack@demomarket'] }).some((p) => p.includes('differs from the commands')));
  assert.ok(bad({}, { install: ['$ claude plugin marketplace add someone/demo-market', 'claude plugin install demo-pack@demomarket'] }).length > 0);
  assert.ok(bad({ add: 'anthropics/claude-plugins-official', marketplace: 'other-name' }).some((p) => p.includes('registers as')));
});

test('TC-1 the checker fails on a private-looking name, path, address or marketplace; prose may say "private"', () => {
  const problems = (over) => checkCatalog(catalog([entry(over)]), { coverage: false }).filter((p) => p.includes('looks private'));
  assert.ok(problems({ name: 'acme-internal-tools', source: { marketplace: 'demomarket', add: 'someone/demo-market', plugin: 'acme-internal-tools' }, install: ['claude plugin marketplace add someone/demo-market', 'claude plugin install acme-internal-tools@demomarket'] }).length > 0);
  assert.ok(problems({ display: 'Corp Private Tools' }).length > 0);
  assert.ok(problems({ source: { marketplace: 'acme-private', add: 'someone/demo-market', plugin: 'demo-pack' }, install: ['claude plugin marketplace add someone/demo-market', 'claude plugin install demo-pack@acme-private'] }).length > 0);
  assert.ok(problems({ source: { marketplace: 'laneconductor-try', add: 'someone/demo-market', plugin: 'demo-pack' }, install: ['claude plugin marketplace add someone/demo-market', 'claude plugin install demo-pack@laneconductor-try'] }).length > 0);
  assert.ok(problems({ why: 'reads /home/someone/notes for the tests of the checker' }).length > 0);
  assert.ok(problems({ detect: 'the folder ~/work/secret exists' }).length > 0);
  assert.ok(problems({ why: 'mail somebody@example.com about the tests of the checker' }).length > 0);
  assert.deepEqual(problems({ why: 'one private page of every track by lane, for the tests of the checker' }), [], 'a private board page in the prose is fine');
});

test('TC-14 the coverage check fails when a lane or a Type has no entry, and the live catalog covers every lane', () => {
  assert.deepEqual(coverageProblems(catalog()), []);
  const noMerge = catalog([entry({ lanes: LANES.filter((l) => l !== 'merge') })]);
  assert.ok(coverageProblems(noMerge).some((p) => p.includes('no entry for the lane `merge`')));
  const noSupport = catalog([entry({ types: ['dev', 'marketing', 'sales'] })]);
  assert.ok(coverageProblems(noSupport).some((p) => p.includes('no entry for the track Type `support`')));
  assert.deepEqual(coverageProblems(live), []);
  for (const lane of LANES) assert.ok(entriesForLanes([lane]).length > 0, `an entry for ${lane}`);
  for (const type of ['marketing', 'sales', 'support']) for (const lane of ['plan', 'implement']) assert.ok(entriesForLanes([lane], { types: [type] }).length > 0, `${type} at ${lane}`);
});

// ---- the online check, against a fixture instead of the network ----
const market = (plugins, name = 'demomarket') => JSON.stringify({ name, plugins });
const files = (map) => async (url) => {
  const key = url.replace('https://raw.githubusercontent.com/', '');
  return key in map ? map[key] : null;
};
const OK = {
  'someone/demo-market/HEAD/.claude-plugin/marketplace.json': market([{ name: 'demo-pack', source: './packs/demo' }]),
  'someone/demo-market/HEAD/packs/demo/skills/demo-skill/SKILL.md': '---\nname: demo-skill\n---\n',
};

test('TC-1 online: a source that resolves and holds the named skill passes; each way of not resolving is reported', async () => {
  const c = catalog([entry({ skills: [{ name: 'demo-skill' }] })]);
  assert.deepEqual(await checkCatalogOnline(c, { fetchText: files(OK) }), []);
  const noMarket = await checkCatalogOnline(c, { fetchText: files({}) });
  assert.ok(noMarket.some((p) => p.includes('has no public .claude-plugin/marketplace.json')), noMarket.join('|'));
  const wrongName = await checkCatalogOnline(c, { fetchText: files({ ...OK, 'someone/demo-market/HEAD/.claude-plugin/marketplace.json': market([{ name: 'demo-pack', source: './packs/demo' }], 'another') }) });
  assert.ok(wrongName.some((p) => p.includes('registers as marketplace `another`')));
  const notListed = await checkCatalogOnline(c, { fetchText: files({ ...OK, 'someone/demo-market/HEAD/.claude-plugin/marketplace.json': market([{ name: 'other-pack', source: './x' }]) }) });
  assert.ok(notListed.some((p) => p.includes('does not list a plugin `demo-pack`')));
  const noSkill = await checkCatalogOnline(catalog([entry({ skills: [{ name: 'demo-skill' }, { name: 'ghost-skill' }] })]), { fetchText: files(OK) });
  assert.deepEqual(noSkill.map((p) => p.replace(/\(.*?\) /, '')), ['demo-pack: plugin `demo-pack` holds no skill, command or agent named `ghost-skill`']);
  const boom = await checkCatalogOnline(c, { fetchText: async () => { throw new Error('HTTP 500'); } });
  assert.ok(boom.some((p) => p.includes('HTTP 500')));
  const badJson = await checkCatalogOnline(c, { fetchText: files({ ...OK, 'someone/demo-market/HEAD/.claude-plugin/marketplace.json': '{nope' }) });
  assert.ok(badJson.some((p) => p.includes('not valid JSON')));
});

test('TC-1 online: a plugin in another repository (url source with a commit) and a command or agent count as holding the name', async () => {
  const c = catalog([entry({ skills: [{ name: 'review-it' }, { name: 'helper' }] })]);
  const map = {
    'someone/demo-market/HEAD/.claude-plugin/marketplace.json': market([{ name: 'demo-pack', source: { source: 'url', url: 'https://github.com/owner/other.git', sha: 'abc123' } }]),
    'owner/other/abc123/commands/review-it.md': 'x',
    'owner/other/abc123/agents/helper.md': 'x',
  };
  assert.deepEqual(await checkCatalogOnline(c, { fetchText: files(map) }), []);
  assert.deepEqual(pluginLocation('a/b', { source: './' }), { repo: 'a/b', dir: '', ref: 'HEAD' });
  assert.deepEqual(pluginLocation('a/b', { source: { source: 'git-subdir', url: 'https://github.com/o/r.git', path: 'plugins/x', ref: 'main' } }), { repo: 'o/r', dir: 'plugins/x', ref: 'main' });
  assert.equal(pluginLocation('a/b', { source: { source: 'url', url: 'https://example.com/x.git' } }), null);
});

test('TC-1 the command line: exit 0 on the live catalog; exit 1 and the problems on a bad file', () => {
  const ok = spawnSync('node', ['scripts/check-catalog.mjs'], { cwd: REPO, encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /entries, checked 2026-/);
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lc-catalog-'));
  try {
    const bad = clone(live);
    delete bad.entries[2].why;
    bad.entries[3].lanes = ['nowhere'];
    fs.writeFileSync(path.join(dir, 'bad.json'), JSON.stringify(bad));
    const r = spawnSync('node', ['scripts/check-catalog.mjs', '--file', path.join(dir, 'bad.json')], { cwd: REPO, encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /missing field `why`/);
    assert.match(r.stderr, /unknown lane `nowhere`/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  // the argument check really parses (a syntax slip in the script would fail this)
  execFileSync('node', ['--check', 'scripts/check-catalog.mjs'], { cwd: REPO });
});

test('TC-2 our own entries come first, a prerequisite before a helper; the finder is the third-party fallback and no entry', () => {
  const mixed = [entry({ name: 'third-helps' }), entry({ name: 'third-prereq', level: 'prerequisite' }), entry({ name: 'own', kind: 'addon', triggers: ['t'], adds: ['a'] }), entry({ name: 'third-helps-2' })];
  assert.deepEqual(offerOrder(mixed).map((e) => e.name), ['own', 'third-prereq', 'third-helps', 'third-helps-2']);
  assert.deepEqual(offerOrder(RECOMMENDED).slice(0, 2).map((e) => e.kind), ['addon', 'addon']);
  assert.equal(FALLBACK.name, 'find-skills');
  assert.ok(!RECOMMENDED.some((e) => e.name === FALLBACK.name), 'the finder is not a catalog entry');
  assert.match(FALLBACK.note, /third-party and not vetted/);
  assert.equal(FALLBACK.licence, 'MIT');
  assert.ok(FALLBACK.verified.includes('vetting verdict'));
});

test('TC-3 every skill a lane guide names under "Skills that help here" is in the catalog for that lane (or the section marks it local)', () => {
  const guides = { plan: 'plan', brainstorm: 'brainstorm', implement: 'implement', review: 'review', 'quality-gate': 'quality-gate', merge: 'merge' };
  for (const [lane, file] of Object.entries(guides)) {
    const text = fs.readFileSync(path.join(REPO, `.claude/skills/laneconductor/lanes/${file}.md`), 'utf8');
    const section = text.slice(text.indexOf('## Skills that help here'));
    const named = [...section.matchAll(/`([a-z][a-z-]+)`/g)].map((m) => m[1]).filter((n) => !['skills'].includes(n) && !n.includes('conductor') && !n.startsWith('my-') && n !== lane);
    assert.ok(named.length > 0, lane);
    const inCatalog = new Set(RECOMMENDED.flatMap((e) => (e.skills ?? []).filter((k) => (k.lanes ?? e.lanes).includes(lane)).map((k) => k.name)));
    for (const n of named) assert.ok(inCatalog.has(n), `${lane}: the guide names \`${n}\`, the catalog has no such skill for the lane`);
  }
  // and the add-ons named in the base's text exist as entries
  const skill = fs.readFileSync(path.join(REPO, 'plugins/laneconductor/skills/laneconductor/SKILL.md'), 'utf8');
  for (const m of skill.matchAll(/`(laneconductor-(?:parallel|board))`/g)) assert.ok(RECOMMENDED.some((e) => e.name === m[1]), m[1]);
});

test('every skill of the old inline lists (marketing, sales) is found in the catalog under its current name or an alias', () => {
  const names = new Set(RECOMMENDED.flatMap((e) => (e.skills ?? []).flatMap((k) => [k.name, ...(k.aliases ?? [])])));
  for (const old of ['social-content', 'copywriting', 'content-strategy', 'launch-strategy', 'sales-enablement', 'cold-email', 'analytics-tracking', 'ab-test-setup']) assert.ok(names.has(old), old);
});
