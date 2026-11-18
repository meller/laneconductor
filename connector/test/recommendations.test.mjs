// connector/plugin-extras/recommended-plugins.json (track AM-10128, the owner's design note): the ONE source of every recommendation. The
// add-on funnel, ADD-ONS.md, the board commands' fallback text, the worktree pointer and the READMEs are generated from it, so the skill
// advisor (track AM-10124) can add skill packs and third-party skills as entries, not text. These tests check that every plugin named in the
// generated text is an entry, that the install commands match the marketplace file, and that an entry which installs code says so plainly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, RELS, NAMES, PROFILES, MARKETPLACE_REL, PLUGIN_REL, pluginFacts, buildPlugin, installCommands, sessionInstallCommands, installBlock, installsNote, RECOMMENDED, ADDONS, CATALOG_REL } from '../../scripts/build-plugin.mjs';

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const catalog = readJson(path.join(REPO, CATALOG_REL));
const market = readJson(path.join(REPO, MARKETPLACE_REL));
const BASE = path.join(REPO, PLUGIN_REL);
const walk = (root, rel = '') => fs.readdirSync(path.join(root, rel), { withFileTypes: true }).flatMap((e) => {
  const r = rel ? `${rel}/${e.name}` : e.name;
  return e.isDirectory() ? walk(root, r) : [r];
});
/** Every generated Markdown text of the three plugins, by repo-relative path. */
const generated = () => PROFILES.flatMap((p) => walk(path.join(REPO, RELS[p])).filter((r) => /\.md$/.test(r)).map((r) => [`${RELS[p]}/${r}`, fs.readFileSync(path.join(REPO, RELS[p], r), 'utf8')]));
const facts = Object.fromEntries(PROFILES.map((p) => [p, pluginFacts(p, buildPlugin(REPO, p))]));

test('the catalog: one entry per recommended plugin with every field, unique names, a known kind', () => {
  assert.deepEqual(RECOMMENDED, catalog.entries);
  assert.deepEqual(RECOMMENDED.map((e) => e.name), ['laneconductor-parallel', 'laneconductor-board']);
  assert.equal(new Set(RECOMMENDED.map((e) => e.name)).size, RECOMMENDED.length);
  for (const e of RECOMMENDED) {
    assert.ok(['addon', 'skillpack', 'thirdparty'].includes(e.kind), `${e.name}: kind`);
    for (const k of ['name', 'display', 'why', 'detect']) assert.ok(typeof e[k] === 'string' && e[k].length > 10, `${e.name}.${k}`);
    assert.ok(typeof e.source.marketplace === 'string' && typeof e.source.add === 'string' && typeof e.source.plugin === 'string', `${e.name}: source`);
    assert.equal(typeof e.installs_code, 'boolean', `${e.name}: installs_code`);
    if (e.installs_code) assert.ok(e.installs.length > 10, `${e.name}: says what it installs`);
    assert.ok(Array.isArray(e.triggers) && e.triggers.length > 0 && e.triggers.every((t) => t.length > 10), `${e.name}: triggers`);
    assert.ok(Array.isArray(e.adds) && e.adds.length > 0, `${e.name}: adds`);
    assert.ok(!e.why.includes('\n') && e.why.length < 200, `${e.name}: why is one line`);
  }
  assert.deepEqual(ADDONS.map((e) => e.name), ['laneconductor-parallel', 'laneconductor-board']);
});

test('every plugin named anywhere in the generated text is a catalog entry (or the base itself)', () => {
  const known = new Set([...RECOMMENDED.map((e) => e.name), NAMES.base]);
  const unknown = [];
  for (const [rel, text] of generated()) {
    for (const m of text.matchAll(/\blaneconductor-([a-z][a-z-]*)\b/g)) {
      const name = m[0].replace(/-$/, '');
      if (!known.has(name)) unknown.push(`${rel}: ${name}`);
    }
    for (const m of text.matchAll(/claude plugin (?:install|uninstall|update) ([a-z-]+)(?:@([a-z-]+))?/g)) {
      if (!known.has(m[1])) unknown.push(`${rel}: ${m[0]}`);
      if (m[2] && m[2] !== market.name) unknown.push(`${rel}: marketplace ${m[2]}`);
    }
  }
  assert.deepEqual(unknown, [], 'a plugin is named that has no entry in recommended-plugins.json');
  // And the other way: every entry is mentioned where it should be (the funnel, the notes, the base README).
  for (const e of RECOMMENDED) {
    const skill = fs.readFileSync(path.join(BASE, 'skills/laneconductor/SKILL.md'), 'utf8');
    assert.ok(skill.includes(`\`${e.name}\``) && skill.includes(e.detect), `${e.name}: SKILL.md funnel`);
    for (const t of e.triggers) assert.ok(skill.includes(t), `${e.name}: trigger "${t}" in the funnel paragraph`);
    const notes = fs.readFileSync(path.join(BASE, 'skills/laneconductor/ADD-ONS.md'), 'utf8');
    assert.ok(notes.includes(`## ${e.name}`) && notes.includes(e.why[0].toUpperCase() + e.why.slice(1)) && notes.includes(installBlock(e.name)), `${e.name}: ADD-ONS.md section`);
    for (const a of e.adds) assert.ok(notes.includes(a), `${e.name}: ADD-ONS.md lists "${a.slice(0, 40)}"`);
    assert.ok(fs.readFileSync(path.join(BASE, 'README.md'), 'utf8').includes(installBlock(e.name)), `${e.name}: base README`);
    assert.ok(fs.readFileSync(path.join(REPO, RELS[e.name === NAMES.parallel ? 'parallel' : 'board'], 'README.md'), 'utf8').includes(installBlock(e.name)), `${e.name}: its own README`);
  }
});

test('the entries\' install commands match the marketplace file', () => {
  assert.equal(market.name, 'laneconductor');
  for (const e of RECOMMENDED.filter((x) => x.source.marketplace === market.name)) {
    const m = market.plugins.find((p) => p.name === e.source.plugin);
    assert.ok(m, `${e.name} is not in ${MARKETPLACE_REL}`);
    assert.equal(m.source, `./plugins/${e.source.plugin}`);
    assert.equal(readJson(path.join(REPO, m.source, '.claude-plugin/plugin.json')).name, e.source.plugin, 'the manifest the marketplace entry points at has the same name');
    assert.equal(e.source.add, 'meller/laneconductor');
    assert.deepEqual(installCommands(e.name), ['claude plugin marketplace add meller/laneconductor', `claude plugin install ${e.source.plugin}@${market.name}`]);
    assert.deepEqual(sessionInstallCommands(e.name), ['/plugin marketplace add meller/laneconductor', `/plugin install ${e.source.plugin}@${market.name}`]);
  }
  assert.equal(market.plugins[0].name, NAMES.base, 'the base comes first, then the add-ons in catalog order');
  assert.deepEqual(market.plugins.slice(1).map((p) => p.name), ADDONS.map((e) => e.name));
});

test('an entry that installs code says so plainly, everywhere the install commands are shown; installs_code matches what the folder really ships', () => {
  for (const e of RECOMMENDED) {
    const profile = PROFILES.find((p) => NAMES[p] === e.name);
    assert.equal(facts[profile].program, e.installs_code, `${e.name}: installs_code is ${e.installs_code} but the folder ${facts[profile].program ? 'ships' : 'does not ship'} a program`);
    const note = installsNote(e.name);
    if (e.installs_code) {
      assert.match(note, /^It installs .* on your computer, from the owner's marketplace \(`meller\/laneconductor`\), not from Anthropic's directory\.$/);
      assert.ok(note.includes(e.installs));
    } else assert.match(note, /Markdown only: it installs no program/);
    // Every file that shows this entry's install block also carries the note, right before it.
    for (const [rel, text] of generated()) {
      if (!text.includes(installBlock(e.name))) continue;
      assert.ok(text.includes(note), `${rel} shows the install commands of ${e.name} without saying it ${e.installs_code ? 'installs a local program' : 'is Markdown only'}`);
    }
  }
  // The board commands' fallback and ops/board.md name the board entry's note.
  const boardNote = installsNote(NAMES.board);
  for (const rel of ['commands/board.md', 'commands/refresh-board.md', 'skills/laneconductor/ops/board.md']) assert.ok(fs.readFileSync(path.join(BASE, rel), 'utf8').includes(boardNote), rel);
  assert.ok(fs.readFileSync(path.join(BASE, 'commands/run.md'), 'utf8').includes(installsNote(NAMES.parallel)), 'run, when it mentions the parallel add-on, says it installs a local program');
  assert.ok(fs.readFileSync(path.join(BASE, 'README.md'), 'utf8').includes('It is Markdown only'), 'the base says it installs no program');
  assert.match(fs.readFileSync(path.join(BASE, '.claude-plugin/plugin.json'), 'utf8'), /Markdown only/);
});

test('the generated text never tells Claude to run an install; the funnel is once per session, only when relevant', () => {
  for (const [rel, text] of generated()) {
    assert.ok(!/\b(now|then|please|you should|go ahead and)\s+run\s+`?claude plugin/i.test(text), `${rel} tells Claude to run an install`);
    assert.ok(!/(?<!never )(?<!NEVER )\brun (an |the )?install command\b(?! yourself)/i.test(text.replace(/never run an install command yourself/gi, '')), `${rel}: "run an install command" outside the never rule`);
  }
  const skill = fs.readFileSync(path.join(BASE, 'skills/laneconductor/SKILL.md'), 'utf8');
  for (const must of ['Once per session', 'never nagging', 'NEVER run an install command yourself', 'recommend nothing', 'mention it only when its trigger applies']) assert.ok(skill.includes(must), must);
});
