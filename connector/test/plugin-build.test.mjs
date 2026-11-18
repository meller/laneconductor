// The generated LaneConductor plugins (track AM-10128): the Markdown-only BASE `laneconductor`, the add-ons `laneconductor-parallel`
// and `laneconductor-board`, the marketplace file and docs/plugin-map.md. One generator, three outputs. The portal's rules are emulated
// in directory-base.test.mjs, the add-ons' programs in addons.test.mjs and directory-precheck.test.mjs, how the three fit together in
// interop.test.mjs. What is NOT covered here is HUMAN (plan 5c Task 5, 5e): installing from the marketplace, `/mcp` showing the
// server connected, and Claude Code really exporting CLAUDE_PROJECT_DIR to the server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildAll, buildPlugin, diffAgainstDisk, transformSkillFile, removeFrontmatterKey, skillEdits, SKILL_EXCLUDE_DIRS, BASE_HABITS, REPO,
  PLUGIN_REL, PARALLEL_REL, BOARD_REL, PLUGIN_RELS, MARKETPLACE_REL, PLUGIN_MAP_REL, PROFILES, NAMES, RELS, installCommands, MARKETPLACE_ADD_COMMAND,
} from '../../scripts/build-plugin.mjs';
import { makeZip, readZip } from '../../scripts/make-zip.mjs';
import { SECRET_PATTERNS } from './helpers/secret-patterns.mjs';

const BASE = path.join(REPO, PLUGIN_REL);
const PARALLEL = path.join(REPO, PARALLEL_REL);
const BOARD = path.join(REPO, BOARD_REL);
const DIRS = { base: BASE, parallel: PARALLEL, board: BOARD };
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const listFiles = (root, rel = '') => fs.readdirSync(path.join(root, rel), { withFileTypes: true }).flatMap((e) => {
  const r = rel ? `${rel}/${e.name}` : e.name;
  if (e.name === 'node_modules') return [];
  return e.isDirectory() ? listFiles(root, r) : [r];
});
const proseWords = (text) => text.replace(/```[\s\S]*?```/g, ' ').split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
const norm = (t) => t.replace(/\s+/g, ' ').toLowerCase();
const version = readJson(path.join(REPO, 'connector/package.json')).version;

test('regenerating gives byte-identical output (no drift) and is deterministic', () => {
  assert.deepEqual(diffAgainstDisk(), [], 'run: node scripts/build-plugin.mjs');
  const a = buildAll();
  const b = buildAll();
  assert.deepEqual([...a.keys()], [...b.keys()]);
  for (const [k, v] of a) assert.ok(v.content.equals(b.get(k).content), k);
  const r = spawnSync(process.execPath, [path.join(REPO, 'scripts/build-plugin.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /plugins\/laneconductor, plugins\/laneconductor-parallel, plugins\/laneconductor-board, \.claude-plugin\/marketplace\.json and docs\/plugin-map\.md are up to date/);
});

test('TC-1: --check exits 1 and names the file when any of the three plugins, the marketplace file or the plugin map has drifted', () => {
  // Build a scratch "repo" holding only what the generator reads, then edit generated files.
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lc-plugin-drift-'));
  try {
    for (const rel of ['.claude/skills/laneconductor', 'connector/src', 'connector/guides', 'connector/plugin-extras']) {
      fs.cpSync(path.join(REPO, rel), path.join(tmp, rel), { recursive: true });
    }
    fs.mkdirSync(path.join(tmp, 'connector/bin'), { recursive: true });
    for (const bin of fs.readdirSync(path.join(REPO, 'connector/bin'))) fs.copyFileSync(path.join(REPO, 'connector/bin', bin), path.join(tmp, 'connector/bin', bin));
    for (const rel of ['connector/package.json', 'connector/package-lock.json', 'LICENSE']) fs.copyFileSync(path.join(REPO, rel), path.join(tmp, rel));
    // The repo files the server imports from outside connector/ (the generator finds them by their imports).
    for (const rel of listFiles(path.join(PARALLEL, 'conductor'))) {
      fs.mkdirSync(path.dirname(path.join(tmp, 'conductor', rel)), { recursive: true });
      fs.copyFileSync(path.join(REPO, 'conductor', rel), path.join(tmp, 'conductor', rel));
    }
    for (const rel of PLUGIN_RELS) fs.cpSync(path.join(REPO, rel), path.join(tmp, rel), { recursive: true });
    fs.mkdirSync(path.join(tmp, '.claude-plugin'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'docs'), { recursive: true });
    fs.copyFileSync(path.join(REPO, MARKETPLACE_REL), path.join(tmp, MARKETPLACE_REL));
    fs.copyFileSync(path.join(REPO, PLUGIN_MAP_REL), path.join(tmp, PLUGIN_MAP_REL));
    assert.deepEqual(diffAgainstDisk(tmp), [], 'the scratch copy starts clean');
    fs.appendFileSync(path.join(tmp, PLUGIN_REL, 'skills/laneconductor/SKILL.md'), '\nedited by hand\n');
    fs.writeFileSync(path.join(tmp, PLUGIN_REL, 'stray.txt'), 'x');
    fs.appendFileSync(path.join(tmp, PARALLEL_REL, 'README.md'), '\nedited by hand\n');
    fs.appendFileSync(path.join(tmp, PARALLEL_REL, 'server/src/tracks.mjs'), '\n// edited by hand\n');
    fs.rmSync(path.join(tmp, PARALLEL_REL, 'server/src/scan.mjs'), { force: true });
    fs.rmSync(path.join(tmp, BOARD_REL, 'server/src/scan.mjs'));
    fs.writeFileSync(path.join(tmp, BOARD_REL, 'stray.txt'), 'x');
    fs.mkdirSync(path.join(tmp, 'plugins/old-add-on'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'plugins/old-add-on/x.md'), 'x');
    fs.appendFileSync(path.join(tmp, MARKETPLACE_REL), '\n');
    fs.appendFileSync(path.join(tmp, PLUGIN_MAP_REL), '\nedited by hand\n');
    const problems = diffAgainstDisk(tmp);
    for (const want of [
      `differs: ${PLUGIN_REL}/skills/laneconductor/SKILL.md`, `extra file: ${PLUGIN_REL}/stray.txt`, `differs: ${PARALLEL_REL}/README.md`,
      `differs: ${PARALLEL_REL}/server/src/tracks.mjs`, `missing: ${BOARD_REL}/server/src/scan.mjs`, `extra file: ${BOARD_REL}/stray.txt`,
      'extra file: plugins/old-add-on/x.md', `differs: ${MARKETPLACE_REL}`, `differs: ${PLUGIN_MAP_REL}`,
    ]) assert.ok(problems.includes(want), `${want} not reported:\n${problems.join('\n')}`);
    fs.rmSync(path.join(tmp, PLUGIN_MAP_REL));
    assert.ok(diffAgainstDisk(tmp).includes(`missing: ${PLUGIN_MAP_REL}`));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// `claude plugin validate --strict` on the three plugins and the marketplace runs in directory-precheck.test.mjs.

test('TC-1: marketplace lists the base, then the two add-ons; each entry names its manifest; versions are 1.0.0 and follow connector/package.json', () => {
  assert.equal(version, '1.0.0');
  const market = readJson(path.join(REPO, MARKETPLACE_REL));
  assert.equal(market.name, 'laneconductor');
  assert.deepEqual(market.plugins.map((p) => p.name), ['laneconductor', 'laneconductor-parallel', 'laneconductor-board'], 'base first');
  assert.deepEqual(market.plugins.map((p) => p.source), ['./plugins/laneconductor', './plugins/laneconductor-parallel', './plugins/laneconductor-board']);
  for (const p of market.plugins) assert.ok(!p.source.includes('..'));
  assert.deepEqual(fs.readdirSync(path.join(REPO, 'plugins')).sort(), ['laneconductor', 'laneconductor-board', 'laneconductor-parallel']);
  assert.deepEqual(PROFILES, ['base', 'parallel', 'board']);
  for (const [profile, dir] of Object.entries(DIRS)) {
    const m = readJson(path.join(dir, '.claude-plugin/plugin.json'));
    assert.equal(m.name, NAMES[profile]);
    assert.equal(m.version, version, `${m.name}: the plugin version follows connector/package.json`);
    assert.equal(m.dependencies, undefined, `${m.name}: no dependency on another plugin (cross-marketplace dependencies are unverified)`);
    assert.equal(m.mcpServers, undefined, `${m.name}: .mcp.json declares the server, not the manifest`);
    assert.equal(RELS[profile], `plugins/${m.name}`);
    assert.deepEqual(m.author, { name: 'Asaf Meller', url: 'https://github.com/meller' });
    assert.equal(m.license, 'Elastic-2.0');
    assert.equal(m.privacyPolicyUrl, 'https://github.com/meller/laneconductor/blob/main/docs/privacy.md');
    for (const k of ['homepage', 'repository']) assert.match(m[k], /^https:\/\//, k);
    assert.match(m.name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(m.name.length <= 64 && m.description.length <= 1024);
  }
  assert.equal(readJson(path.join(BASE, '.claude-plugin/plugin.json')).displayName, 'LaneConductor');
});

test('the parallel add-on declares one local server, key lc, started with node on a file it ships; the base and the board declare none', () => {
  const mcp = readJson(path.join(PARALLEL, '.mcp.json'));
  assert.deepEqual(Object.keys(mcp.mcpServers), ['lc'], 'the server key is lc');
  const s = mcp.mcpServers.lc;
  assert.equal(s.command, 'node');
  assert.deepEqual(s.args, ['${CLAUDE_PLUGIN_ROOT}/server/bin/lc-connector.mjs'], 'only ${CLAUDE_PLUGIN_ROOT} is used: the repo comes from the CLAUDE_PROJECT_DIR environment variable');
  assert.equal(s.type, undefined);
  assert.equal(s.env, undefined);
  for (const f of ['agents/track-runner.md', 'server/bin/lc-connector.mjs', 'server/bin/lc-scaffold.mjs', 'server/guides', 'package.json', 'package-lock.json']) assert.ok(fs.existsSync(path.join(PARALLEL, f)), `parallel ships ${f}`);
  assert.ok(!fs.existsSync(path.join(PARALLEL, 'server/bin/lc-board.mjs')), 'the board script is the board add-on\'s');
  assert.ok(!fs.existsSync(path.join(BASE, '.mcp.json')) && !fs.existsSync(path.join(BOARD, '.mcp.json')));
  for (const f of ['server/bin/lc-board.mjs', 'server/src/board-page.html']) assert.ok(fs.existsSync(path.join(BOARD, f)), `board ships ${f}`);
  assert.ok(!fs.existsSync(path.join(BOARD, 'server/bin/lc-connector.mjs')) && !fs.existsSync(path.join(BOARD, 'package.json')), 'the board needs no connector and no packages');
  for (const dir of Object.values(DIRS)) assert.ok(!fs.existsSync(path.join(dir, 'hooks')), 'no hooks (they would be a separate opt-in extension)');
});

test('listing: each README has its words, LICENSE, the install commands (one per bash block) and the migration note; no command count; no placeholder', () => {
  for (const [profile, dir] of Object.entries(DIRS)) {
    const readme = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
    assert.ok(proseWords(readme) >= 120, `${profile}: our floor is 120 words outside code blocks, got ${proseWords(readme)}`);
    assert.ok(!readme.includes('{{'), `${profile}: a template placeholder was left in the README`);
    assert.ok(readme.includes(`Version ${version}.`));
    assert.ok(fs.readFileSync(path.join(dir, 'LICENSE')).equals(fs.readFileSync(path.join(REPO, 'LICENSE'))), 'plugin LICENSE is the repo LICENSE');
    assert.ok(readme.includes('Elastic License 2.0') && readme.includes('LICENSE'));
    // TC-9: the install commands, each alone in a ```bash fence; the add-ons' commands appear for both add-ons; the migration note.
    const fences = [...readme.matchAll(/```(\w*)\n([\s\S]*?)\n```/g)];
    for (const f of fences) assert.equal(f[1], 'bash', `${profile}: every code fence is tagged bash`);
    for (const f of fences) assert.ok(!f[2].includes('\n') && !f[2].startsWith('$'), `${profile}: one command per fence, no leading $: ${f[2]}`);
    assert.ok(readme.includes(`claude plugin install ${NAMES[profile]}@laneconductor`), `${profile}: its own install command`);
    assert.ok(readme.includes(MARKETPLACE_ADD_COMMAND));
    assert.ok(readme.includes('claude plugin uninstall laneconductor') && readme.includes('0.x') && readme.includes('1.0.0'), `${profile}: the migration note for the all-in-one 0.x`);
    assert.match(norm(readme), /restart your sessions/, `${profile}: sessions must be restarted`);
    assert.ok(readme.includes('/reload-plugins'));
    assert.ok(readme.includes('docs/plugin-map.md') || profile !== 'base');
    assert.ok(readme.includes('| `laneconductor` (base) |') && readme.includes('| `laneconductor-parallel` (add-on) |') && readme.includes('| `laneconductor-board` (add-on) |'), `${profile}: the short plugin map`);
    assert.ok(!/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|twenty-\w+)\s+(slash\s+)?commands\b/i.test(readme), `${profile}: hard-codes a command count`);
    assert.ok(!/laneconductor-(plus|extended|connector|lite)/.test(readme), `${profile}: names a plugin that does not exist`);
  }
  const base = norm(fs.readFileSync(path.join(BASE, 'README.md'), 'utf8'));
  for (const must of ['claude plugin install laneconductor-parallel@laneconductor', 'claude plugin install laneconductor-board@laneconductor', 'markdown only', 'makes no network requests', 'installs nothing', 'runs no scripts', 'plan-reviewer', '--scope local', '--scope user', 'upload plugin', 'remove it so the skill is not loaded twice']) {
    assert.ok(base.includes(must), `base README must mention ${must}`);
  }
  const parallel = norm(fs.readFileSync(path.join(PARALLEL, 'README.md'), 'utf8'));
  for (const must of ['mcp__plugin_laneconductor-parallel_lc__<tool>', 'plugin:laneconductor-parallel:lc', 'conflict-checked writes', 'auto-state', 'only program it starts is `git`', 'makes no network requests of its own', 'conductor/advice-log', 'track-runner', 'isolation: worktree', 'no slash commands', 'node.js 20']) {
    assert.ok(parallel.includes(must), `parallel README must mention ${must}`);
  }
  const board = norm(fs.readFileSync(path.join(BOARD, 'README.md'), 'utf8'));
  for (const must of ['**/laneconductor-board/**/bin/lc-board.mjs', 'no slash commands', 'private artifact', 'secrets and personal data', 'works alone']) assert.ok(board.includes(must), `board README must mention ${must}`);
});

test('no top-level bin/ in any plugin, no symlinks, no node_modules committed', () => {
  for (const dir of Object.values(DIRS)) assert.ok(!fs.existsSync(path.join(dir, 'bin')), 'a top-level bin/ stops claude.ai and Cowork installing the plugin');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    assert.ok(!e.isSymbolicLink(), `${path.join(dir, e.name)} is a symlink`);
    if (e.isDirectory() && e.name !== 'node_modules') walk(path.join(dir, e.name));
  });
  for (const dir of Object.values(DIRS)) walk(dir);
  const tracked = execFileSync('git', ['-C', REPO, 'ls-files', 'plugins'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  assert.ok(tracked.every((f) => !f.includes('/node_modules/')), 'node_modules must not be committed');
});

test('parallel package.json and lockfile: registry-only exact pins, lockfile v2/3, no scripts or overrides', () => {
  const pkg = readJson(path.join(PARALLEL, 'package.json'));
  assert.equal(pkg.name, 'laneconductor-parallel');
  assert.deepEqual(Object.keys(pkg).sort(), ['dependencies', 'name', 'type', 'version']);
  const exact = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
  for (const [n, v] of Object.entries(pkg.dependencies)) assert.match(v, exact, `${n} is not an exact pin`);
  const lock = readJson(path.join(PARALLEL, 'package-lock.json'));
  assert.ok([2, 3].includes(lock.lockfileVersion), `lockfileVersion ${lock.lockfileVersion}`);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies);
  assert.equal(lock.overrides, undefined);
  const entries = Object.entries(lock.packages).filter(([k]) => k !== '');
  assert.ok(entries.length > 0);
  for (const [k, e] of entries) {
    assert.match(e.version, exact, `${k} version`);
    assert.match(e.resolved ?? '', /^https:\/\/registry\.npmjs\.org\//, `${k} resolved from the registry only`);
    assert.match(e.integrity ?? '', /^sha\d+-/, `${k} integrity`);
    assert.ok(!e.hasInstallScript, `${k} has a lifecycle script`);
    assert.ok(!e.dev, `${k} is a dev dependency and must not ship`);
    assert.ok(!e.link, `${k} is a link`);
  }
  assert.ok(!lock.packages['node_modules/@modelcontextprotocol/client'], 'the test-only client is not shipped');
});

test('REQ-12-style secret scan over the three plugin directories', () => {
  const hits = [];
  for (const dir of Object.values(DIRS)) {
    for (const rel of listFiles(dir)) {
      if (/\.png$/.test(rel)) continue;
      const text = fs.readFileSync(path.join(dir, rel), 'utf8');
      for (const [label, re] of Object.entries(SECRET_PATTERNS)) if (re.test(text)) hits.push(`${path.basename(dir)}/${rel}: ${label}`);
    }
    for (const name of ['.env', '.laneconductor.json', '.worker.tokens.json']) {
      assert.ok(!listFiles(dir).some((r) => path.basename(r).startsWith(name)), `${name} must not ship`);
    }
  }
  assert.deepEqual(hits, []);
  const mcp = fs.readFileSync(path.join(PARALLEL, '.mcp.json'), 'utf8');
  assert.ok(!/"env"|"headers"|Authorization/i.test(mcp), 'no secrets or auth in .mcp.json');
});

test('skill: frontmatter fits the listing budget and every relative link resolves inside the plugin', () => {
  const skillDir = path.join(BASE, 'skills/laneconductor');
  const md = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  const fm = md.match(/^---\n([\s\S]*?)\n---\n/)[1];
  const field = (k) => (fm.match(new RegExp(`^${k}: (.*)$`, 'm')) ?? [])[1] ?? '';
  assert.equal(field('name'), 'laneconductor');
  assert.ok(field('description').length > 0);
  assert.ok(field('description').length + field('when_to_use').length <= 1536, 'description + when_to_use must be <= 1,536 chars');
  const links = [...md.matchAll(/\]\(([^)#\s]+)\)/g)].map((m) => m[1]).filter((l) => !/^[a-z]+:/.test(l));
  assert.ok(links.length >= 10, 'the command table links to the lane files');
  for (const l of links) {
    assert.ok(!path.isAbsolute(l) && !l.startsWith('..'), `${l} must stay relative and inside the skill`);
    assert.ok(fs.existsSync(path.join(skillDir, l)), `${l} (linked from SKILL.md) is missing from the plugin copy`);
  }
  assert.ok(links.includes('ADD-ONS.md'), 'SKILL.md points at the add-on note');
});

test('skill: the parked legacy tier is not shipped and nothing points at it', () => {
  const skillDir = path.join(BASE, 'skills/laneconductor');
  assert.deepEqual(SKILL_EXCLUDE_DIRS, ['legacy']);
  assert.ok(!fs.existsSync(path.join(skillDir, 'legacy')), 'legacy/ must not ship');
  const src = path.join(REPO, '.claude/skills/laneconductor');
  const shipped = listFiles(skillDir).sort();
  const wanted = [...listFiles(src).filter((r) => !r.startsWith('legacy/')), 'ADD-ONS.md'].sort();
  assert.deepEqual(shipped, wanted, 'the plugin skill is the source skill minus legacy/, plus ADD-ONS.md (setup/, deploy/, lanes/, ops/ all ship)');
  for (const dir of ['setup', 'deploy', 'lanes', 'ops']) assert.ok(shipped.some((r) => r.startsWith(`${dir}/`)), `${dir}/ ships`);
  // No file in the base names a legacy/ path (the generator drops every pointer to it).
  const offenders = listFiles(BASE).filter((rel) => !/\.png$/.test(rel) && /(^|[^A-Za-z])legacy\//.test(fs.readFileSync(path.join(BASE, rel), 'utf8')));
  assert.deepEqual(offenders, []);
  const skill = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  assert.ok(!/legacy\//.test(skill) && !/Postgres/i.test(skill), 'SKILL.md says nothing about the parked tier: its text is not shipped');
  for (const cmd of ['syncdb', 'remote-sync']) assert.ok(!skill.includes(`| \`${cmd}\``), `no routing row for ${cmd}`);
  // Every relative markdown link in every shipped skill file resolves (code fences skipped).
  for (const rel of shipped.filter((r) => r.endsWith('.md'))) {
    const text = fs.readFileSync(path.join(skillDir, rel), 'utf8').replace(/```[\s\S]*?```/g, '');
    for (const m of text.matchAll(/\]\(([^)#\s]+)\)/g)) {
      if (/^[a-z]+:/.test(m[1])) continue;
      assert.ok(fs.existsSync(path.join(skillDir, path.dirname(rel), m[1])), `${rel} links to missing ${m[1]}`);
    }
  }
});

test('skill: no database or cloud-service tooling in SKILL.md, lanes/ or ops/; setup/ and deploy/ stay tame', () => {
  const skillDir = path.join(BASE, 'skills/laneconductor');
  const banned = /psql|gcloud|DATABASE_URL|neon\.tech|supabase|run\.app|collector/i;
  const hits = listFiles(skillDir)
    .filter((r) => r === 'SKILL.md' || r.startsWith('lanes/') || r.startsWith('ops/'))
    .filter((r) => banned.test(fs.readFileSync(path.join(skillDir, r), 'utf8')));
  assert.deepEqual(hits, []);
  const okHost = /^(localhost|127\.0\.0\.1|example\.com|(?:[a-z0-9-]+\.)?laneconductor\.(?:com|io)|github\.com)$/;
  for (const r of listFiles(skillDir).filter((x) => x.startsWith('setup/') || x.startsWith('deploy/'))) {
    const text = fs.readFileSync(path.join(skillDir, r), 'utf8');
    for (const m of text.matchAll(/https?:\/\/([^/\s:`'")>]+)/g)) assert.match(m[1], okHost, `${r}: URL host ${m[1]} is not local, an example or this project's`);
    assert.ok(!/neon\.tech|supabase\.co|\.run\.app/i.test(text), `${r} names a private service host`);
  }
  // setup/setup.md is the short "add LaneConductor to this project" procedure (track AM-10130); the daemon-era install, operating
  // modes and collection text live in the source skill's legacy/ folder, which the plugin does not ship.
  const setup = fs.readFileSync(path.join(skillDir, 'setup/setup.md'), 'utf8');
  assert.match(setup, /^# setup: add LaneConductor to this project$/m);
  assert.ok(!/psql|Operating modes|mode.*local-api|remote-api/i.test(setup), 'no database tier in the shipped setup text');
});

test('skill transform: explicit edits, and a missing anchor fails the build', () => {
  const edits = { 'a.md': [['one', '1'], ['two\n', '']] };
  assert.equal(transformSkillFile('a.md', 'x one two\ny', edits), 'x 1 y');
  assert.equal(transformSkillFile('b.md', 'untouched', edits), 'untouched', 'files without edits pass through');
  assert.throws(() => transformSkillFile('a.md', 'only one', edits), /source text not found/);
  // Every real edit applies to the real source today (the build would throw otherwise), and removes what it names.
  const src = path.join(REPO, '.claude/skills/laneconductor');
  const real = skillEdits();
  for (const rel of Object.keys(real)) {
    const text = fs.readFileSync(path.join(src, rel), 'utf8');
    const out = transformSkillFile(rel, text, real);
    assert.notEqual(out, text, rel);
    assert.ok(!/(^|[^A-Za-z])legacy\//.test(out), `${rel} still names legacy/`);
  }
  // Source skill is untouched by the transform: the repo's own copy keeps the legacy tier.
  assert.ok(fs.existsSync(path.join(src, 'legacy/worker.md')));
});

test('skill: allowed-tools is deleted, Habits and the add-on pointer are appended, the source skill is untouched', () => {
  const md = fs.readFileSync(path.join(BASE, 'skills/laneconductor/SKILL.md'), 'utf8');
  const fm = md.match(/^---\n([\s\S]*?)\n---\n/)[1];
  assert.ok(!/allowed-tools|allowedTools/.test(fm), 'the skill declares no pre-approved tools: users keep normal permission prompts');
  assert.ok(fm.includes('name: laneconductor') && fm.includes('argument-hint:'), 'the other frontmatter keys stay');
  const src = fs.readFileSync(path.join(REPO, '.claude/skills/laneconductor/SKILL.md'), 'utf8');
  assert.match(src, /^allowed-tools: /m, 'the SOURCE skill keeps its allowed-tools');
  assert.ok(md.endsWith(BASE_HABITS), 'Habits and Add-ons are the last sections');
  assert.ok(md.split('\n').length < 500, 'SKILL.md stays under 500 lines');
  const habits = md.slice(md.indexOf('\n## Habits (this plugin has no hooks)'), md.indexOf('\n## Add-ons (mention rarely)'));
  assert.ok(habits.trim().split('\n').length <= 14, 'Habits stays within 14 lines');
  assert.match(habits, /3-line status/);
  assert.match(habits, /exactly one next step in one line/);
  assert.match(habits, /never rewrite the whole file/);
  assert.match(habits, /Before any `git push`, say what will be pushed/);
  const funnel = md.slice(md.indexOf('\n## Add-ons (mention rarely)'));
  assert.ok(funnel.trim().split('\n').length <= 4, 'the pointer section stays short (one paragraph)');
  for (const must of ['recommend nothing', 'Once per session', 'never nagging', 'NEVER run an install command yourself', 'ADD-ONS.md', 'several sessions, people or sub-agents', 'asks for a board', 'privacy scan', 'health report', 'mcp__plugin_laneconductor-parallel_lc__*', 'laneconductor-parallel:track-runner', '**/laneconductor-board/**/bin/lc-board.mjs']) {
    assert.ok(funnel.includes(must), `funnel paragraph must mention ${must}`);
  }
  assert.ok(!/claude plugin install|marketplace add/.test(md), 'SKILL.md itself holds no install command: ADD-ONS.md is the one source');
});

test('removeFrontmatterKey deletes exactly one key and fails loudly when it is gone', () => {
  const doc = '---\nname: x\nallowed-tools: Read, Edit\nargument-hint: y\n---\nbody\n';
  assert.equal(removeFrontmatterKey(doc, 'allowed-tools'), '---\nname: x\nargument-hint: y\n---\nbody\n');
  assert.throws(() => removeFrontmatterKey(doc, 'nope'), /not found/);
  assert.throws(() => removeFrontmatterKey('no frontmatter', 'x'), /no frontmatter/);
});

test('skill path audit: no hard-coded project or machine paths outside the setup docs', () => {
  const skillDir = path.join(BASE, 'skills/laneconductor');
  const offenders = [];
  for (const rel of listFiles(skillDir)) {
    const text = fs.readFileSync(path.join(skillDir, rel), 'utf8');
    const inSetup = rel.startsWith('setup/') || rel.startsWith('legacy/');
    if (/\/home\/[a-z]+\//.test(text)) offenders.push(`${rel}: /home/<user>/ path`);
    if (!inSetup && /\$HOME\/Code\/laneconductor/.test(text)) offenders.push(`${rel}: $HOME/Code/laneconductor`);
    if (!inSetup && rel !== 'SKILL.md' && /\.claude\/skills\/laneconductor/.test(text)) offenders.push(`${rel}: .claude/skills/laneconductor`);
  }
  assert.deepEqual(offenders, []);
  const head = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  assert.match(head, /Paths below are relative to this file's directory/);
  assert.match(head, /skills\/laneconductor\/` when installed as the LaneConductor plugin/);
});

test('make-zip: deterministic, holds exactly the plugin files at the zip root, keeps modes, refuses to write inside the repo', (t) => {
  const files = buildPlugin(REPO, 'base');
  const a = makeZip(files);
  assert.ok(a.equals(makeZip(buildPlugin(REPO, 'base'))), 'same sources, same bytes');
  const back = readZip(a);
  assert.deepEqual([...back.keys()], [...files.keys()].sort());
  assert.ok(back.has('.claude-plugin/plugin.json'), 'the plugin root is the zip root');
  for (const [name, f] of files) {
    assert.ok(back.get(name).content.equals(f.content), name);
    assert.ok(f.content.equals(fs.readFileSync(path.join(BASE, name))), `${name} equals the committed plugin file`);
    assert.equal(back.get(name).mode & 0o777, f.exec ? 0o755 : 0o644, `${name} mode`);
  }
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lc-zip-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const run = (...args) => spawnSync(process.execPath, [path.join(REPO, 'scripts/make-zip.mjs'), ...args], { encoding: 'utf8' });
  const ok = run('--out', path.join(tmp, 'dist'));
  assert.equal(ok.status, 0, ok.stderr);
  const zipPath = path.join(tmp, 'dist', `laneconductor-${version}.zip`);
  assert.ok(fs.readFileSync(zipPath).equals(a));
  assert.match(ok.stdout, new RegExp(`files:\\s+${files.size}\\n`));
  assert.match(ok.stdout, /sha256: [0-9a-f]{64}/);
  const board = run('--out', path.join(tmp, 'dist'), '--plugin', 'board');
  assert.equal(board.status, 0, board.stderr);
  assert.ok(fs.existsSync(path.join(tmp, 'dist', `laneconductor-board-${version}.zip`)));
  assert.match(run('--out', path.join(tmp, 'dist'), '--plugin', 'full').stderr, /--plugin must be one of/);
  assert.equal(run().status, 1, '--out is required');
  assert.match(run('--out', path.join(REPO, 'x.zip')).stderr, /refusing to write inside the repository/);
});

test('the install commands are one source: installCommands() and the marketplace add command', () => {
  assert.equal(MARKETPLACE_ADD_COMMAND, 'claude plugin marketplace add meller/laneconductor');
  assert.deepEqual(installCommands('parallel'), ['claude plugin marketplace add meller/laneconductor', 'claude plugin install laneconductor-parallel@laneconductor']);
  assert.deepEqual(installCommands('board'), ['claude plugin marketplace add meller/laneconductor', 'claude plugin install laneconductor-board@laneconductor']);
});

test('the generator CLI: --profile with --out builds one plugin elsewhere, and refuses the plugins/ folder, a non-empty folder and unknown profiles', (t) => {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lc-profile-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const run = (...args) => spawnSync(process.execPath, [path.join(REPO, 'scripts/build-plugin.mjs'), ...args], { encoding: 'utf8' });
  const out = path.join(tmp, 'board');
  const ok = run('--profile', 'board', '--out', out);
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(listFiles(out).sort(), [...buildPlugin(REPO, 'board').keys()].sort());
  assert.match(run('--profile', 'board', '--out', out).stderr, /is not empty/);
  assert.match(run('--profile', 'board', '--out', path.join(REPO, PLUGIN_REL, 'x')).stderr, /refusing to write inside/);
  assert.match(run('--profile', 'board').stderr, /pass --out/);
  assert.match(run('--out', path.join(tmp, 'y')).stderr, /--out needs --profile/);
  assert.match(run('--profile', 'lite', '--out', path.join(tmp, 'z')).stderr, /unknown profile lite/);
  assert.match(run('--profile', 'base', '--check').stderr, /--check checks only the default build/);
});
