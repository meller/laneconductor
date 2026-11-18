// Phase 5c and the one-plugin decision (2026-11-17): the generated LaneConductor plugin (plugins/laneconductor/, profile
// `full`: skill, commands, agents, connector, board script) and the marketplace file. The plugin running from a bare copy
// (connector over stdio, board script) is in directory-precheck.test.mjs and full-plugin.test.mjs; the lean (directory) variant
// is in directory-lean.test.mjs.
// What is NOT covered here is HUMAN (plan 5c Task 5, 5e): installing from the marketplace, `/mcp`
// showing the server connected, and Claude Code really exporting CLAUDE_PROJECT_DIR to the server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAll, buildPlugin, diffAgainstDisk, transformSkillFile, removeFrontmatterKey, skillEdits, SKILL_EXCLUDE_DIRS, LEGACY_NOTE, HABITS, REPO, PLUGIN_REL, MARKETPLACE_REL } from '../../scripts/build-plugin.mjs';
import { makeZip, readZip } from '../../scripts/make-zip.mjs';
import { SECRET_PATTERNS } from './helpers/secret-patterns.mjs';

const PLUGIN = path.join(REPO, PLUGIN_REL);
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const listFiles = (root, rel = '') => fs.readdirSync(path.join(root, rel), { withFileTypes: true }).flatMap((e) => {
  const r = rel ? `${rel}/${e.name}` : e.name;
  if (e.name === 'node_modules') return [];
  return e.isDirectory() ? listFiles(root, r) : [r];
});

test('regenerating gives byte-identical output (no drift) and is deterministic', () => {
  assert.deepEqual(diffAgainstDisk(), [], 'run: node scripts/build-plugin.mjs');
  const a = buildAll();
  const b = buildAll();
  assert.deepEqual([...a.keys()], [...b.keys()]);
  for (const [k, v] of a) assert.ok(v.content.equals(b.get(k).content), k);
  const r = spawnSync(process.execPath, [path.join(REPO, 'scripts/build-plugin.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('--check exits 1 and names the file when the committed output has drifted', () => {
  // Build a scratch "repo" holding only what the generator reads, then edit one generated file.
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lc-plugin-drift-'));
  try {
    for (const rel of ['.claude/skills/laneconductor', 'connector/src', 'connector/guides', 'connector/plugin-extras']) {
      fs.cpSync(path.join(REPO, rel), path.join(tmp, rel), { recursive: true });
    }
    fs.mkdirSync(path.join(tmp, 'connector/bin'), { recursive: true });
    for (const bin of fs.readdirSync(path.join(REPO, 'connector/bin'))) fs.copyFileSync(path.join(REPO, 'connector/bin', bin), path.join(tmp, 'connector/bin', bin));
    for (const rel of ['connector/package.json', 'connector/package-lock.json', 'connector/PLUGIN-README.md', 'LICENSE']) fs.copyFileSync(path.join(REPO, rel), path.join(tmp, rel));
    // The repo files the server imports from outside connector/ (the generator finds them by their imports).
    for (const rel of listFiles(path.join(PLUGIN, 'conductor'))) {
      fs.mkdirSync(path.dirname(path.join(tmp, 'conductor', rel)), { recursive: true });
      fs.copyFileSync(path.join(REPO, 'conductor', rel), path.join(tmp, 'conductor', rel));
    }
    fs.cpSync(PLUGIN, path.join(tmp, PLUGIN_REL), { recursive: true });
    fs.mkdirSync(path.join(tmp, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(path.join(REPO, MARKETPLACE_REL), path.join(tmp, MARKETPLACE_REL));
    assert.deepEqual(diffAgainstDisk(tmp), [], 'the scratch copy starts clean');
    fs.appendFileSync(path.join(tmp, PLUGIN_REL, 'skills/laneconductor/SKILL.md'), '\nedited by hand\n');
    fs.writeFileSync(path.join(tmp, PLUGIN_REL, 'stray.txt'), 'x');
    fs.appendFileSync(path.join(tmp, PLUGIN_REL, 'server/src/tracks.mjs'), '\n// edited by hand\n');
    fs.rmSync(path.join(tmp, PLUGIN_REL, 'server/src/scan.mjs'));
    fs.mkdirSync(path.join(tmp, 'plugins/old-add-on'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'plugins/old-add-on/x.md'), 'x');
    const problems = diffAgainstDisk(tmp);
    assert.ok(problems.includes(`differs: ${PLUGIN_REL}/skills/laneconductor/SKILL.md`), problems.join('\n'));
    assert.ok(problems.includes(`extra file: ${PLUGIN_REL}/stray.txt`), problems.join('\n'));
    assert.ok(problems.includes(`differs: ${PLUGIN_REL}/server/src/tracks.mjs`), problems.join('\n'));
    assert.ok(problems.includes(`missing: ${PLUGIN_REL}/server/src/scan.mjs`), problems.join('\n'));
    assert.ok(problems.includes('extra file: plugins/old-add-on/x.md'), 'a leftover plugin directory is drift');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// `claude plugin validate --strict` on the plugin and the marketplace runs in directory-precheck.test.mjs.

test('manifest, marketplace (ONE entry) and .mcp.json have the agreed shape', () => {
  const m = readJson(path.join(PLUGIN, '.claude-plugin/plugin.json'));
  const pkg = readJson(path.join(REPO, 'connector/package.json'));
  assert.equal(pkg.version, '0.6.0');
  assert.equal(m.name, 'laneconductor');
  assert.equal(m.version, pkg.version, 'the plugin version follows connector/package.json');
  assert.equal(m.dependencies, undefined, 'the one plugin has no dependencies');
  assert.equal(m.mcpServers, undefined, '.mcp.json declares the server, not the manifest');
  const market = readJson(path.join(REPO, MARKETPLACE_REL));
  assert.equal(market.name, 'laneconductor');
  assert.deepEqual(market.plugins.map((p) => p.name), [m.name], 'marketplace entry name equals the manifest name');
  assert.deepEqual(market.plugins.map((p) => p.source), ['./plugins/laneconductor']);
  for (const p of market.plugins) assert.ok(!p.source.includes('..'));
  assert.deepEqual(fs.readdirSync(path.join(REPO, 'plugins')), ['laneconductor'], 'one plugin directory');
  const mcp = readJson(path.join(PLUGIN, '.mcp.json'));
  assert.deepEqual(Object.keys(mcp.mcpServers), ['lc'], 'the server key is lc');
  const s = mcp.mcpServers.lc;
  assert.equal(s.command, 'node');
  assert.deepEqual(s.args, ['${CLAUDE_PLUGIN_ROOT}/server/bin/lc-connector.mjs'], 'only ${CLAUDE_PLUGIN_ROOT} is used: the repo comes from the CLAUDE_PROJECT_DIR environment variable');
  assert.equal(s.type, undefined, 'no remote (http) entry yet: plan 5c Task 6 waits for Phase 8');
  assert.equal(s.env, undefined);
  for (const f of ['skills', 'commands', 'agents', 'server/bin/lc-connector.mjs', 'server/bin/lc-board.mjs', 'server/src/board-page.html', 'server/guides']) assert.ok(fs.existsSync(path.join(PLUGIN, f)), `the plugin ships ${f}`);
  assert.ok(!fs.existsSync(path.join(PLUGIN, 'hooks')), 'no hooks in the main plugin (they will be the separate laneconductor-hooks extension)');
});

const proseWords = (text) => text.replace(/```[\s\S]*?```/g, ' ').split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;

test('listing: README (>= 120 words outside code blocks), LICENSE and manifest fields', () => {
  const version = readJson(path.join(REPO, 'connector/package.json')).version;
  const readme = fs.readFileSync(path.join(PLUGIN, 'README.md'), 'utf8');
  const words = proseWords(readme);
  assert.ok(words >= 120, `our floor is 120 words outside code blocks, got ${words}`);
  assert.ok(!readme.includes('{{'), 'a template placeholder was left in the README');
  assert.ok(readme.includes(`Version ${version}`));
  for (const must of ['LICENSE', 'Elastic License 2.0', 'claude plugin marketplace add meller/laneconductor', 'claude plugin install laneconductor@laneconductor', 'Upload plugin', '--scope local', '--scope user',
    'plan-reviewer', 'track-runner', 'mcp__plugin_laneconductor_lc__', 'plugin:laneconductor:lc', 'auto-state', 'only program it starts is `git`', 'makes no network requests of its own',
    'server/bin/lc-board.mjs', 'conductor/advice-log', 'conflict-checked writes', 'Claude Code and Cowork', 'not in Anthropic\'s plugin directory', 'Releases page', 'remove it so the skill is not loaded twice']) {
    assert.ok(readme.replace(/\s+/g, ' ').toLowerCase().includes(must.toLowerCase()), `README must mention ${must}`);
  }
  assert.ok(!/laneconductor-(plus|extended|board|connector)/.test(readme), 'names a plugin that does not exist');
  assert.ok(fs.readFileSync(path.join(PLUGIN, 'LICENSE')).equals(fs.readFileSync(path.join(REPO, 'LICENSE'))), 'plugin LICENSE is the repo LICENSE');
  assert.ok(!fs.existsSync(path.join(REPO, 'connector/BOARD-README.md')) && !fs.existsSync(path.join(REPO, 'connector/CONNECTOR-README.md')), 'one README source');
  const m = readJson(path.join(PLUGIN, '.claude-plugin/plugin.json'));
  assert.match(m.name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  for (const k of ['description', 'version']) assert.ok(typeof m[k] === 'string' && m[k].length > 0, k);
  assert.deepEqual(m.author, { name: 'Asaf Meller', url: 'https://github.com/meller' });
  assert.equal(m.license, 'Elastic-2.0');
  assert.deepEqual(m.keywords, ['laneconductor', 'tracks', 'planning', 'git']);
  for (const k of ['homepage', 'repository', 'documentationUrl', 'supportUrl']) assert.match(m[k], /^https:\/\//, k);
  assert.ok(m.documentationUrl.endsWith('/connector/PLUGIN-README.md'));
  assert.equal(m.privacyPolicyUrl, undefined, 'no privacy policy page exists yet; do not invent a URL');
});

test('no top-level bin/ in the plugin, no symlinks, no node_modules committed', () => {
  for (const dir of [PLUGIN]) assert.ok(!fs.existsSync(path.join(dir, 'bin')), 'a top-level bin/ stops claude.ai and Cowork installing the plugin');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    assert.ok(!e.isSymbolicLink(), `${path.join(dir, e.name)} is a symlink`);
    if (e.isDirectory() && e.name !== 'node_modules') walk(path.join(dir, e.name));
  });
  walk(PLUGIN);
  const tracked = execFileSync('git', ['-C', REPO, 'ls-files', 'plugins'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  assert.ok(tracked.every((f) => !f.includes('/node_modules/')), 'node_modules must not be committed');
});

test('connector package.json and the lockfile: registry-only exact pins, lockfile v2/3, no scripts or overrides', () => {
  const pkg = readJson(path.join(PLUGIN, 'package.json'));
  assert.equal(pkg.name, 'laneconductor');
  assert.deepEqual(Object.keys(pkg).sort(), ['dependencies', 'name', 'type', 'version']);
  const exact = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
  for (const [n, v] of Object.entries(pkg.dependencies)) assert.match(v, exact, `${n} is not an exact pin`);
  const lock = readJson(path.join(PLUGIN, 'package-lock.json'));
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

test('REQ-12-style secret scan over the plugin directory', () => {
  const patterns = SECRET_PATTERNS;
  const hits = [];
  for (const dir of [PLUGIN]) {
    for (const rel of listFiles(dir)) {
      if (/\.png$/.test(rel)) continue;
      const text = fs.readFileSync(path.join(dir, rel), 'utf8');
      for (const [label, re] of Object.entries(patterns)) if (re.test(text)) hits.push(`${path.basename(dir)}/${rel}: ${label}`);
    }
    for (const name of ['.env', '.laneconductor.json', '.worker.tokens.json']) {
      assert.ok(!listFiles(dir).some((r) => path.basename(r).startsWith(name)), `${name} must not ship`);
    }
  }
  assert.deepEqual(hits, []);
  const mcp = fs.readFileSync(path.join(PLUGIN, '.mcp.json'), 'utf8');
  assert.ok(!/"env"|"headers"|Authorization/i.test(mcp), 'no secrets or auth in .mcp.json');
});

test('skill: frontmatter fits the listing budget and every relative link resolves inside the plugin', () => {
  const skillDir = path.join(PLUGIN, 'skills/laneconductor');
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
});

test('skill: the parked legacy tier is not shipped and nothing points at it', () => {
  const skillDir = path.join(PLUGIN, 'skills/laneconductor');
  assert.deepEqual(SKILL_EXCLUDE_DIRS, ['legacy']);
  assert.ok(!fs.existsSync(path.join(skillDir, 'legacy')), 'legacy/ must not ship');
  const src = path.join(REPO, '.claude/skills/laneconductor');
  const shipped = listFiles(skillDir).sort();
  const wanted = listFiles(src).filter((r) => !r.startsWith('legacy/')).sort();
  assert.deepEqual(shipped, wanted, 'the plugin skill is the source skill minus legacy/ (setup/, deploy/, lanes/, ops/ all ship)');
  for (const dir of ['setup', 'deploy', 'lanes', 'ops']) assert.ok(shipped.some((r) => r.startsWith(`${dir}/`)), `${dir}/ ships`);
  // No file in the plugin names a legacy/ path (the generator drops every pointer to it).
  const offenders = listFiles(PLUGIN).filter((rel) => /(^|[^A-Za-z])legacy\//.test(fs.readFileSync(path.join(PLUGIN, rel), 'utf8')));
  assert.deepEqual(offenders, []);
  const skill = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  assert.ok(skill.includes(LEGACY_NOTE), 'SKILL.md carries the one honest line about the parked tier');
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
  const skillDir = path.join(PLUGIN, 'skills/laneconductor');
  const banned = /psql|gcloud|DATABASE_URL|neon\.tech|supabase|run\.app|collector/i;
  const hits = listFiles(skillDir)
    .filter((r) => r === 'SKILL.md' || r.startsWith('lanes/') || r.startsWith('ops/'))
    .filter((r) => banned.test(fs.readFileSync(path.join(skillDir, r), 'utf8')));
  assert.deepEqual(hits, []);
  // setup/ and deploy/ are instructions the user asks for by name, so they may name tools such as gcloud,
  // but every URL must be local, an example, or this project's own; no credentials (the secret scan also runs).
  const okHost = /^(localhost|127\.0\.0\.1|example\.com|(?:[a-z0-9-]+\.)?laneconductor\.(?:com|io)|github\.com)$/;
  for (const r of listFiles(skillDir).filter((x) => x.startsWith('setup/') || x.startsWith('deploy/'))) {
    const text = fs.readFileSync(path.join(skillDir, r), 'utf8');
    for (const m of text.matchAll(/https?:\/\/([^/\s:`'")>]+)/g)) assert.match(m[1], okHost, `${r}: URL host ${m[1]} is not local, an example or this project's`);
    assert.ok(!/neon\.tech|supabase\.co|\.run\.app/i.test(text), `${r} names a private service host`);
  }
  // The database steps that remain in setup.md say they belong to the parked tier.
  const setup = fs.readFileSync(path.join(skillDir, 'setup/setup.md'), 'utf8');
  assert.match(setup, /^## Operating modes \(.*parked database tier\)$/m);
  assert.match(setup, /^## setup collection \(steps 2 and 3 apply only to the parked database tier\)$/m);
  assert.ok(setup.indexOf('psql') > setup.indexOf('## setup collection (steps 2'), 'the psql step sits under that heading');
});

test('skill transform: explicit edits, and a missing anchor fails the build', () => {
  const edits = { 'a.md': [['one', '1'], ['two\n', '']] };
  assert.equal(transformSkillFile('a.md', 'x one two\ny', edits), 'x 1 y');
  assert.equal(transformSkillFile('b.md', 'untouched', edits), 'untouched', 'files without edits pass through');
  assert.throws(() => transformSkillFile('a.md', 'only one', edits), /source text not found/);
  // Every real edit applies to the real source today (the build would throw otherwise), and removes what it names.
  const src = path.join(REPO, '.claude/skills/laneconductor');
  for (const profile of ['full', 'lean']) {
    const edits = skillEdits(profile);
    for (const rel of Object.keys(edits)) {
      const text = fs.readFileSync(path.join(src, rel), 'utf8');
      const out = transformSkillFile(rel, text, edits);
      assert.notEqual(out, text, `${profile} ${rel}`);
      assert.ok(!/(^|[^A-Za-z])legacy\//.test(out), `${profile} ${rel} still names legacy/`);
    }
  }
  // Source skill is untouched by the transform: the repo's own copy keeps the legacy tier.
  assert.ok(fs.existsSync(path.join(src, 'legacy/worker.md')));
});

test('skill: allowed-tools is deleted, the Habits section (until the hooks extension ships) is appended, the source skill is untouched', () => {
  const md = fs.readFileSync(path.join(PLUGIN, 'skills/laneconductor/SKILL.md'), 'utf8');
  const fm = md.match(/^---\n([\s\S]*?)\n---\n/)[1];
  assert.ok(!/allowed-tools|allowedTools/.test(fm), 'the skill declares no pre-approved tools: users keep normal permission prompts');
  assert.ok(fm.includes('name: laneconductor') && fm.includes('argument-hint:'), 'the other frontmatter keys stay');
  const src = fs.readFileSync(path.join(REPO, '.claude/skills/laneconductor/SKILL.md'), 'utf8');
  assert.match(src, /^allowed-tools: /m, 'the SOURCE skill keeps its allowed-tools');
  assert.ok(md.endsWith(HABITS), 'Habits is the last section');
  const habits = md.slice(md.indexOf('\n## Habits (until the hooks extension ships)'));
  assert.ok(habits.trim().split('\n').length <= 14, 'Habits stays within 14 lines');
  assert.ok(md.split('\n').length < 500, 'SKILL.md stays under 500 lines');
  assert.ok(!/(^|[\s`(])[\w./-]*\.(sh|mjs|js|py)\b/.test(habits) && !/scripts?\//.test(habits), 'Habits names no script path');
  assert.match(habits, /3-line status/);
  assert.match(habits, /exactly one next step in one line/);
  assert.match(habits, /The connector is included/);
  assert.ok(!/optional/i.test(habits), 'the connector is not optional');
  assert.match(habits, /If they are unavailable \(its MCP server failed to start\), re-read the file right before editing and change only the marker lines; never rewrite the whole file/);
  assert.match(habits, /Before any `git push`, say what will be pushed/);
  assert.match(habits, /Until the hooks extension ships/);
  // The plugin ships the board script, so ops/board.md points at it (and says how to find it if the variable is not substituted).
  const board = fs.readFileSync(path.join(PLUGIN, 'skills/laneconductor/ops/board.md'), 'utf8');
  assert.ok(board.includes('${CLAUDE_PLUGIN_ROOT}/server/bin/lc-board.mjs'));
  assert.ok(board.includes('**/laneconductor/**/server/bin/lc-board.mjs'));
  assert.ok(fs.existsSync(path.join(PLUGIN, 'server/bin/lc-board.mjs')));
});

test('removeFrontmatterKey deletes exactly one key and fails loudly when it is gone', () => {
  const doc = '---\nname: x\nallowed-tools: Read, Edit\nargument-hint: y\n---\nbody\n';
  assert.equal(removeFrontmatterKey(doc, 'allowed-tools'), '---\nname: x\nargument-hint: y\n---\nbody\n');
  assert.throws(() => removeFrontmatterKey(doc, 'nope'), /not found/);
  assert.throws(() => removeFrontmatterKey('no frontmatter', 'x'), /no frontmatter/);
});

test('skill path audit: no hard-coded project or machine paths outside the setup docs', () => {
  const skillDir = path.join(PLUGIN, 'skills/laneconductor');
  const offenders = [];
  for (const rel of listFiles(skillDir)) {
    const text = fs.readFileSync(path.join(skillDir, rel), 'utf8');
    const inSetup = rel.startsWith('setup/') || rel.startsWith('legacy/');
    // Any machine-specific absolute path is out, everywhere.
    if (/\/home\/[a-z]+\//.test(text)) offenders.push(`${rel}: /home/<user>/ path`);
    // The author's checkout location and the repo-relative skill path are allowed only where the
    // setup docs deliberately talk about installing or linking the skill from a LaneConductor install.
    if (!inSetup && /\$HOME\/Code\/laneconductor/.test(text)) offenders.push(`${rel}: $HOME/Code/laneconductor`);
    if (!inSetup && rel !== 'SKILL.md' && /\.claude\/skills\/laneconductor/.test(text)) offenders.push(`${rel}: .claude/skills/laneconductor`);
  }
  assert.deepEqual(offenders, []);
  // SKILL.md names both locations, so a reader of the plugin copy knows where its own files are.
  const head = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  assert.match(head, /Paths below are relative to this file's directory/);
  assert.match(head, /skills\/laneconductor\/` when installed as the LaneConductor plugin/);
});

test('make-zip: deterministic, holds exactly the plugin files at the zip root, keeps modes, refuses to write inside the repo', (t) => {
  const files = buildPlugin(REPO, 'full');
  const a = makeZip(files);
  assert.ok(a.equals(makeZip(buildPlugin(REPO, 'full'))), 'same sources, same bytes');
  const back = readZip(a);
  assert.deepEqual([...back.keys()], [...files.keys()].sort());
  assert.ok(back.has('.claude-plugin/plugin.json'), 'the plugin root is the zip root');
  for (const [name, f] of files) {
    assert.ok(back.get(name).content.equals(f.content), name);
    assert.ok(f.content.equals(fs.readFileSync(path.join(PLUGIN, name))), `${name} equals the committed plugin file`);
    assert.equal(back.get(name).mode & 0o777, f.exec ? 0o755 : 0o644, `${name} mode`);
  }
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lc-zip-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const run = (...args) => spawnSync(process.execPath, [path.join(REPO, 'scripts/make-zip.mjs'), ...args], { encoding: 'utf8' });
  const ok = run('--out', path.join(tmp, 'dist'));
  assert.equal(ok.status, 0, ok.stderr);
  const zipPath = path.join(tmp, 'dist', 'laneconductor-0.6.0.zip');
  assert.ok(fs.readFileSync(zipPath).equals(a));
  assert.match(ok.stdout, new RegExp(`files:\\s+${files.size}\\n`));
  assert.match(ok.stdout, /sha256: [0-9a-f]{64}/);
  assert.equal(run().status, 1, '--out is required');
  assert.match(run('--out', path.join(REPO, 'x.zip')).stderr, /refusing to write inside the repository/);
});
