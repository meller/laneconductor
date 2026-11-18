// Track AM-10133 Phase 4: setup ends with a "what else fits this project" step, generated from the one catalog
// (connector/plugin-extras/recommended-plugins.json). It only shows the install commands, each alone in its own bash fence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, RELS, RECOMMENDED, ADDONS, NAMES, buildPlugin, installCommands, installsNote, RECOMMEND_MARKER, setupRecommendBlock, RELOAD_COMMAND } from '../../scripts/build-plugin.mjs';
import { STARTER, offerOrder } from '../../scripts/plugin-texts.mjs';

const BASE = path.join(REPO, RELS.base, 'skills/laneconductor');
const read = (rel) => fs.readFileSync(path.join(BASE, rel), 'utf8');
import { ADDONS_INSTALL } from '../../scripts/plugin-texts.mjs';
const bashFences = (text) => [...text.matchAll(/```bash\n([\s\S]*?)\n```/g)].map((m) => m[1]);

test('TC-15 every starter-set candidate has a one-line setup_fit of 10 to 200 characters', () => {
  assert.ok(STARTER.length >= 4 && STARTER.length < RECOMMENDED.length, 'the starter candidates are the entries that say when they fit, not the whole catalog');
  assert.deepEqual(STARTER, RECOMMENDED.filter((e) => e.setup_fit));
  for (const e of STARTER) assert.ok(typeof e.setup_fit === 'string' && !e.setup_fit.includes('\n') && e.setup_fit.length >= 10 && e.setup_fit.length <= 200, `${e.name}: setup_fit`);
});

test('TC-16 the generated block in setup.md and new-project.md names exactly the starter candidates, one line each with its commands in inline code (Claude shows each alone in its own bash block), and the one-line add-ons install in its own fence', () => {
  const expected = [ADDONS_INSTALL]; // the one-line install of both add-ons is the one fence (AM-10128)
  for (const rel of ['setup/setup.md', 'ops/new-project.md']) {
    const text = read(rel);
    assert.ok(!text.includes(RECOMMEND_MARKER), `${rel}: the marker is replaced`);
    assert.deepEqual(bashFences(text), expected, `${rel}: one fence, the add-ons line`);
    assert.ok(text.includes(setupRecommendBlock()), `${rel}: holds the generated block`);
    assert.ok(text.includes(`then the reload step`) && text.includes(`\`${RELOAD_COMMAND}\``), `${rel}: the reload step`);
    const order = offerOrder(STARTER).map((e) => e.name);
    const lines = text.split('\n').filter((l) => /^- `[a-z0-9-]+`/.test(l));
    assert.deepEqual(lines.map((l) => l.match(/^- `([a-z0-9-]+)`/)[1]), order, `${rel}: one line per starter candidate, in offer order`);
    for (const e of STARTER) assert.ok(lines.find((l) => l.startsWith(`- \`${e.name}\``)).includes(installCommands(e).map((c) => `\`${c}\``).join(', ')), `${rel}: ${e.name} carries its commands`);
  }
  const market = JSON.parse(fs.readFileSync(path.join(REPO, '.claude-plugin/marketplace.json'), 'utf8'));
  const own = new Set(ADDONS.map((e) => e.name));
  for (const e of STARTER) {
    const c = `claude plugin install ${e.source.plugin}@${e.source.marketplace}`;
    assert.ok(read('setup/setup.md').includes(`\`${c}\``), `${c} is shown`);
    if (own.has(e.name)) assert.ok(c.endsWith(`@${market.name}`), c);
  }
});

test('TC-17 the block shows only: it says never run, no install without a yes, skip what is installed, and say nothing when nothing fits', () => {
  const text = setupRecommendBlock();
  assert.match(text, /never run\s+an install command yourself/);
  assert.match(text, /install nothing unless the person says yes/);
  assert.match(text, /counts as installed when/);
  assert.match(text, /If nothing fits, say nothing and go on/);
  assert.match(text, /Mention each plugin once in this session/);
  assert.ok(!/\b(now|then|please)\s+run\s+`?claude plugin/i.test(text));
  for (const e of ADDONS) assert.ok(text.includes(`Installs ${e.installs}.`) && text.includes(e.detect), `${e.name}: what it installs, and detection`);
  for (const e of STARTER.filter((x) => !x.installs_code)) assert.ok(text.split('\n').find((l) => l.startsWith(`- \`${e.name}\``)).includes('Markdown only.'), `${e.name}: says it is Markdown only`);
});

test('TC-11 TC-12 the starter set: at most four, none installed, once; derived from the stack and Type; "later" defers to the moment of intent', () => {
  for (const rel of ['setup/setup.md', 'ops/new-project.md']) {
    const text = read(rel);
    assert.match(text, /offer a STARTER SET/, rel);
    assert.match(text, /three or four at most, once/, `${rel}: three or four, once`);
    assert.match(text, /Never more than four/, rel);
    assert.match(text, /If one is already installed, say\s+nothing about it/, `${rel}: none already installed`);
    assert.match(text, /the stack from `package\.json`, the marker files and `conductor\/tech-stack\.md`/, `${rel}: derived from the stack`);
    assert.match(text, /Install them now, or I will offer each one when it comes up/, `${rel}: now or later`);
    assert.match(text, /If the person says later, record nothing: each item is offered again at its own moment/, `${rel}: later defers`);
    assert.match(text, /the core process skills first, a design skill when the project has a UI, the stack's pack/, `${rel}: the order`);
    assert.ok(!text.includes('reserved for the skill advisor'), `${rel}: the reserved hook is gone`);
  }
});

test('TC-19/20 no other base text recommends an add-on unconditionally or names a plugin that is not a catalog entry', () => {
  const known = new Set([...RECOMMENDED.map((e) => e.name), NAMES.base]);
  const marketplaces = new Set(['laneconductor', ...RECOMMENDED.map((e) => e.source.marketplace)]);
  const built = buildPlugin(REPO, 'base');
  for (const [rel, f] of built.files ?? built) {
    if (!/\.md$/.test(rel)) continue;
    const text = String(Buffer.isBuffer(f.content ?? f) ? (f.content ?? f).toString('utf8') : (f.content ?? f));
    for (const m of text.matchAll(/claude plugin install ([a-z-]+)@([a-z-]+)/g)) { assert.ok(known.has(m[1]), `${rel}: ${m[0]}`); assert.ok(marketplaces.has(m[2]), `${rel}: ${m[0]}`); const e = RECOMMENDED.find((x) => x.name === m[1]); assert.equal(m[2], e ? e.source.marketplace : 'laneconductor', `${rel}: ${m[0]}`); }
  }
});

test('TC-21 the block is built from the catalog: a fake skillpack entry gets its own paragraph and fences', () => {
  const fake = { name: 'fake-skillpack', kind: 'skillpack', display: 'Fake', source: { marketplace: 'fakemarket', add: 'someone/fake', plugin: 'fake-skillpack' }, installs_code: false, lanes: ['plan'], types: ['dev'], stack: [], level: 'helps', skills: [], licence: 'MIT', why: 'a pack of fake skills for tests of the block', adds: ['x'], setup_fit: 'the project has fake needs of some kind', detect: 'a skill named fake exists', triggers: ['the person asks for fake things'] };
  const text = setupRecommendBlock([...STARTER, fake]);
  assert.ok(text.includes('- `fake-skillpack`') && text.includes('It fits when the project has fake needs of some kind.'));
  assert.ok(text.includes('`claude plugin marketplace add someone/fake`, `claude plugin install fake-skillpack@fakemarket`'));
  assert.deepEqual(bashFences(text), [ADDONS_INSTALL]);
});

test('ADD-ONS.md prints each entry\'s setup_fit, and the setup command points at the step', () => {
  const addons = read('ADD-ONS.md');
  for (const e of ADDONS) assert.ok(addons.includes(`**Offered at setup when**: ${e.setup_fit}.`), e.name);
  assert.match(fs.readFileSync(path.join(REPO, RELS.base, 'commands/setup.md'), 'utf8'), /say which optional plugins would help this project/);
});
