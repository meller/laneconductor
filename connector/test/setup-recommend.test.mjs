// Track AM-10133 Phase 4: setup ends with a "what else fits this project" step, generated from the one catalog
// (connector/plugin-extras/recommended-plugins.json). It only shows the install commands, each alone in its own bash fence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, RELS, RECOMMENDED, ADDONS, NAMES, buildPlugin, installCommands, installsNote, RECOMMEND_MARKER, setupRecommendBlock, RELOAD_COMMAND } from '../../scripts/build-plugin.mjs';

const BASE = path.join(REPO, RELS.base, 'skills/laneconductor');
const read = (rel) => fs.readFileSync(path.join(BASE, rel), 'utf8');
const HOOK = '<!-- Starter set: reserved for the skill advisor -->';
import { ADDONS_INSTALL } from '../../scripts/plugin-texts.mjs';
const bashFences = (text) => [...text.matchAll(/```bash\n([\s\S]*?)\n```/g)].map((m) => m[1]);

test('TC-15 every catalog entry has a one-line setup_fit of 10 to 200 characters', () => {
  for (const e of RECOMMENDED) assert.ok(typeof e.setup_fit === 'string' && !e.setup_fit.includes('\n') && e.setup_fit.length >= 10 && e.setup_fit.length <= 200, `${e.name}: setup_fit`);
});

test('TC-16 the generated block in setup.md and new-project.md names exactly the catalog add-ons, each command alone in its own bash fence, then the reload step', () => {
  const expected = [...RECOMMENDED.flatMap((e) => installCommands(e.name)), ADDONS_INSTALL]; // the one-line install of both add-ons comes last (AM-10128)
  for (const rel of ['setup/setup.md', 'ops/new-project.md']) {
    const text = read(rel);
    assert.ok(!text.includes(RECOMMEND_MARKER), `${rel}: the marker is replaced`);
    assert.deepEqual(bashFences(text), expected, `${rel}: fences equal the catalog's commands, in order`);
    assert.ok(text.includes(setupRecommendBlock()), `${rel}: holds the generated block`);
    assert.equal(text.split(`\`${RELOAD_COMMAND}\``).length - 1 >= RECOMMENDED.length, true, `${rel}: the reload step follows`);
    for (const e of RECOMMENDED) assert.ok(text.includes(`**\`${e.name}\`**`), `${rel}: names ${e.name}`);
  }
  const market = JSON.parse(fs.readFileSync(path.join(REPO, '.claude-plugin/marketplace.json'), 'utf8'));
  for (const c of bashFences(read('setup/setup.md'))) if (c.startsWith('claude plugin install')) assert.ok(c.endsWith(`@${market.name}`), c);
});

test('TC-17 the block shows only: it says never run, no install without a yes, skip what is installed, and say nothing when nothing fits', () => {
  const text = setupRecommendBlock();
  assert.match(text, /never run\s+an install command yourself/);
  assert.match(text, /install nothing unless the person says yes/);
  assert.match(text, /counts as installed when/);
  assert.match(text, /If nothing fits, say nothing and go on/);
  assert.match(text, /Mention each plugin once in this session/);
  assert.ok(!/\b(now|then|please)\s+run\s+`?claude plugin/i.test(text));
  for (const e of ADDONS) assert.ok(text.includes(installsNote(e.name)) && text.includes(e.detect), `${e.name}: note and detection`);
});

test('TC-18 the skill advisor hook comment is in both procedures, after the generated block', () => {
  for (const rel of ['setup/setup.md', 'ops/new-project.md']) {
    const text = read(rel);
    assert.ok(text.includes(HOOK), rel);
    assert.ok(text.indexOf(HOOK) > text.lastIndexOf(bashFences(text).at(-1)), `${rel}: hook after the block`);
  }
});

test('TC-19/20 no other base text recommends an add-on unconditionally or names a plugin that is not a catalog entry', () => {
  const known = new Set([...RECOMMENDED.map((e) => e.name), NAMES.base]);
  const built = buildPlugin(REPO, 'base');
  for (const [rel, f] of built.files ?? built) {
    if (!/\.md$/.test(rel)) continue;
    const text = String(Buffer.isBuffer(f.content ?? f) ? (f.content ?? f).toString('utf8') : (f.content ?? f));
    for (const m of text.matchAll(/claude plugin install ([a-z-]+)@([a-z-]+)/g)) { assert.ok(known.has(m[1]), `${rel}: ${m[0]}`); assert.equal(m[2], 'laneconductor'); }
  }
});

test('TC-21 the block is built from the catalog: a fake skillpack entry gets its own paragraph and fences', () => {
  const fake = { name: 'fake-skillpack', kind: 'skillpack', display: 'Fake', source: { marketplace: 'fakemarket', add: 'someone/fake', plugin: 'fake-skillpack' }, installs_code: false, why: 'a pack of fake skills for tests of the block', adds: ['x'], setup_fit: 'the project has fake needs of some kind', detect: 'a skill named fake exists', triggers: ['the person asks for fake things'] };
  const text = setupRecommendBlock([...RECOMMENDED, fake]);
  assert.ok(text.includes('**`fake-skillpack`**') && text.includes('It fits when the project has fake needs of some kind.'));
  assert.deepEqual(bashFences(text), [...[...RECOMMENDED, fake].flatMap((e) => [`claude plugin marketplace add ${e.source.add}`, `claude plugin install ${e.source.plugin}@${e.source.marketplace}`]), ADDONS_INSTALL]);
});

test('ADD-ONS.md prints each entry\'s setup_fit, and the setup command points at the step', () => {
  const addons = read('ADD-ONS.md');
  for (const e of RECOMMENDED) assert.ok(addons.includes(`**Offered at setup when**: ${e.setup_fit}.`), e.name);
  assert.match(fs.readFileSync(path.join(REPO, RELS.base, 'commands/setup.md'), 'utf8'), /say which optional plugins would help this project/);
});
