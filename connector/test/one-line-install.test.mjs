// Track AM-10128 (owner decision 2026-11-18): the full version (base + board + parallel) is offered in ONE copy-pasteable line. The two lines are
// derived by scripts/plugin-texts.mjs from the catalog (connector/plugin-extras/recommended-plugins.json): `full_install` for use OUTSIDE Claude
// (the READMEs, the website) and `addons_install` for use INSIDE a session where the base is already installed (the shared setup/next block).
// The per-add-on commands stay for a person who wants one add-on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, RELS, NAMES, PROFILES, RECOMMENDED, ADDONS, CATALOG_REL, buildPlugin, setupRecommendBlock, frontDoorBlock } from '../../scripts/build-plugin.mjs';
import { STARTER, FULL_INSTALL, FULL_UPDATE, ADDONS_INSTALL, oneLineInstall, fullInstallBlock, BUNDLES, MARKETPLACE, MARKETPLACE_SOURCE } from '../../scripts/plugin-texts.mjs';

const catalog = JSON.parse(fs.readFileSync(path.join(REPO, CATALOG_REL), 'utf8'));
const market = JSON.parse(fs.readFileSync(path.join(REPO, '.claude-plugin/marketplace.json'), 'utf8'));
const bashFences = (text) => [...text.matchAll(/```bash\n([\s\S]*?)\n```/g)].map((m) => m[1]);
const generated = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const known = new Set([NAMES.base, ...RECOMMENDED.map((e) => e.name)]);

test('the catalog names the plugins of each line, and addons_install is exactly the add-on entries', () => {
  assert.deepEqual(BUNDLES, catalog.bundles);
  assert.deepEqual(BUNDLES.full_install, [NAMES.base, NAMES.board, NAMES.parallel]);
  assert.deepEqual([...BUNDLES.addons_install].sort(), ADDONS.map((e) => e.name).sort(), 'every add-on entry, and nothing else');
  assert.deepEqual(BUNDLES.full_install, [NAMES.base, ...BUNDLES.addons_install], 'the full line is the base then the add-ons');
  for (const n of [...BUNDLES.full_install, ...BUNDLES.addons_install]) assert.ok(known.has(n), `${n} is the base or a catalog entry`);
});

test('the two lines are built only from catalog names and the marketplace, as exactly the expected `claude plugin ...` segments joined by &&', () => {
  assert.equal(market.name, MARKETPLACE);
  const marketplaceAdd = `claude plugin marketplace add ${MARKETPLACE_SOURCE}`;
  const install = (n) => `claude plugin install ${n}@${market.name}`;
  assert.equal(FULL_INSTALL, [marketplaceAdd, install('laneconductor'), install('laneconductor-board'), install('laneconductor-parallel')].join(' && '));
  assert.equal(ADDONS_INSTALL, [marketplaceAdd, install('laneconductor-board'), install('laneconductor-parallel')].join(' && '));
  // the literal text of the owner decision
  assert.equal(FULL_INSTALL, 'claude plugin marketplace add meller/laneconductor && claude plugin install laneconductor@laneconductor && claude plugin install laneconductor-board@laneconductor && claude plugin install laneconductor-parallel@laneconductor');
  assert.equal(ADDONS_INSTALL, 'claude plugin marketplace add meller/laneconductor && claude plugin install laneconductor-board@laneconductor && claude plugin install laneconductor-parallel@laneconductor');
  for (const line of [FULL_INSTALL, ADDONS_INSTALL]) {
    const segments = line.split(' && ');
    assert.equal(segments.filter((s) => s.startsWith('claude plugin marketplace add ')).length, 1, 'one marketplace add');
    for (const s of segments.slice(1)) {
      const m = /^claude plugin install ([a-z-]+)@([a-z-]+)$/.exec(s);
      assert.ok(m && known.has(m[1]) && m[2] === market.name, s);
      assert.ok(market.plugins.some((p) => p.name === m[1]), `${m[1]} is in the marketplace file`);
    }
  }
  // derived, not typed: the line follows the names it is given
  assert.equal(oneLineInstall(['laneconductor-board']), 'claude plugin marketplace add meller/laneconductor && claude plugin install laneconductor-board@laneconductor');
});

test('the shared setup/next block carries addons_install alone in its own bash fence, introduced by one sentence, and never as a command to run', () => {
  const block = setupRecommendBlock();
  const fences = bashFences(block);
  assert.equal(fences.filter((f) => f === ADDONS_INSTALL).length, 1);
  assert.equal(fences.at(-1), ADDONS_INSTALL, 'it comes after the per-add-on offers');
  assert.ok(block.includes(`Both add-ons in one line:\n\n\`\`\`bash\n${ADDONS_INSTALL}\n\`\`\``), 'the sentence right before the fence');
  assert.ok(!block.includes(FULL_INSTALL), 'the full line is for outside Claude, not for the session block');
  assert.match(block, /never run an install command yourself/);
  assert.match(block, /install nothing unless the person says yes/);
  assert.ok(!/\b(now|then|please)\s+run\s+`?claude plugin/i.test(block));
  for (const e of STARTER) assert.ok(block.includes(`claude plugin install ${e.source.plugin}@${e.source.marketplace}`), `the per-entry commands stay (${e.name})`);
});

test('the block is for the case where BOTH add-ons are missing; with one add-on the offer is the single one and adds nothing', () => {
  const block = setupRecommendBlock();
  assert.match(block, /When BOTH add-ons \(`laneconductor-parallel` and `laneconductor-board`\) are missing/);
  assert.match(block, /When only one of them is missing, keep its offer above and add nothing/);
  assert.match(block, /counts as installed when/, 'the detection wording is the existing one');
  // a catalog with a single add-on offers no combined line
  const one = setupRecommendBlock(RECOMMENDED.slice(0, 1));
  assert.ok(!one.includes('Both add-ons in one line') && !bashFences(one).includes(ADDONS_INSTALL));
  assert.equal(bashFences(one).length, 0, 'the per-add-on commands are inline code, there is no combined fence');
  // a catalog where the second entry is a skill pack, not an add-on, offers none either
  const withPack = setupRecommendBlock([RECOMMENDED[0], { ...RECOMMENDED[1], kind: 'skillpack' }]);
  assert.ok(!withPack.includes('Both add-ons in one line'));
});

test('the generated texts carry the block: new-project (the starter set), and next (the front door points at the one line of its first-track card, written once)', () => {
  // Release 1.9.5: setup offers no starter set, so only new-project carries the full block; next keeps the add-ons offer of the front door and
  // shows the one line once, in its first-track card (the front door says "show the one line of the first-track card").
  for (const f of ['skills/laneconductor/ops/new-project.md', 'commands/new-project.md']) {
    const text = generated(`${RELS.base}/${f}`);
    const shared = setupRecommendBlock();
    const both = shared.slice(shared.indexOf('When BOTH add-ons')); // the commands inline the block with their own link wording, so compare the added part
    assert.ok(text.includes(both), `${f} carries the one-line part of the shared block`);
    if (f.startsWith('skills/')) assert.ok(text.includes(shared), `${f} carries the shared block`);
    assert.ok(text.includes(`Both add-ons in one line:\n\n\`\`\`bash\n${ADDONS_INSTALL}\n\`\`\``), f);
  }
  for (const f of ['skills/laneconductor/ops/next.md', 'commands/next.md']) {
    const text = generated(`${RELS.base}/${f}`);
    const door = frontDoorBlock(ADDONS);
    assert.ok(door.includes('show the "one line" of the first-track card above instead of two blocks'), 'the front door block points at the card');
    assert.ok(text.includes(door.slice(door.indexOf('When BOTH add-ons'))), `${f} carries the pointer`);
    assert.equal(text.split(`\`\`\`bash\n${ADDONS_INSTALL}\n\`\`\``).length - 1, 1, `${f}: the one line is shown once`);
  }
  for (const f of ['commands/setup.md', 'skills/laneconductor/setup/setup.md']) assert.ok(!generated(`${RELS.base}/${f}`).includes('Both add-ons in one line'), `${f}: no starter set`);
  const source = fs.readFileSync(path.join(REPO, '.claude/skills/laneconductor/ops/next.md'), 'utf8');
  assert.ok(!/claude plugin (install|marketplace)/.test(source) && !source.includes('Both add-ons in one line'), 'the source ops/next.md has the block only through the marker');
  const added = setupRecommendBlock().split('When BOTH add-ons')[1];
  assert.ok(!/\bAM-\d+|\btrack \d{3,}/i.test(added), 'no track number in the added text');
});

test('the READMEs of the three plugins, the connector README and the root README carry full_install as "The full version in one line"', () => {
  const fenced = `The full version in one line:\n\n\`\`\`bash\n${FULL_INSTALL}\n\`\`\``;
  assert.equal(fullInstallBlock(), fenced);
  for (const p of PROFILES) {
    const text = generated(`${RELS[p]}/README.md`);
    assert.ok(text.includes(fenced), `${RELS[p]}/README.md`);
    assert.ok(!text.includes('{{'), 'no placeholder left');
  }
  for (const rel of ['README.md', 'connector/README.md']) assert.ok(generated(rel).includes(fenced), rel);
  // the root README keeps its per-plugin lines after it
  const root = generated('README.md');
  const after = root.slice(root.indexOf(fenced));
  for (const e of ADDONS) assert.ok(after.includes(`claude plugin install ${e.name}@${MARKETPLACE}`), `root README still shows ${e.name}`);
  assert.ok(root.includes('claude plugin install laneconductor@laneconductor'));
});

test('the base stays Markdown-only and free of daemon-era words, with the new text in it', () => {
  const BAD = /make install|laneconductorrc|\bworkers?\b|collection|daemon/i;
  for (const [rel, f] of buildPlugin(REPO, 'base')) {
    assert.ok(/\.(md|json|png)$|^LICENSE$/.test(rel), `${rel} is Markdown, JSON, the licence or the icon`);
    if (/\.md$/.test(rel)) assert.ok(!BAD.test(String(f.content)), `${rel} has a daemon-era word`);
  }
});

test('the update one-liner is built from the same bundle, updates every plugin of the full version, and is in the root README', () => {
  assert.equal(FULL_UPDATE, 'claude plugin marketplace update laneconductor && claude plugin update laneconductor@laneconductor && claude plugin update laneconductor-board@laneconductor && claude plugin update laneconductor-parallel@laneconductor');
  assert.ok(!FULL_UPDATE.includes('install'), 'an update line never installs');
  const readme = fs.readFileSync(path.join(REPO, 'README.md'), 'utf8');
  assert.ok(readme.includes('```bash\n' + FULL_UPDATE + '\n```'), 'the root README carries the update line alone in its bash fence');
});
