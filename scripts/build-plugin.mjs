#!/usr/bin/env node
// Builds the LaneConductor plugin (track AM-10106, Phase 5c) from its sources. Deterministic: no
// timestamps, sorted file order, every byte comes from a source file or a fixed template.
//
//   node scripts/build-plugin.mjs           rewrite plugins/laneconductor/ and .claude-plugin/marketplace.json
//   node scripts/build-plugin.mjs --check   write nothing; exit 1 when the committed output differs
//
// Sources                                   Output (under plugins/laneconductor/)
//   .claude/skills/laneconductor/**         skills/laneconductor/**
//   connector/bin/lc-connector.mjs          server/bin/lc-connector.mjs
//   connector/bin/lc-board.mjs              server/bin/lc-board.mjs (the board data generator, Phase 5d)
//   connector/src/**, connector/guides/**   server/src/**, server/guides/**
//   repo files the server imports with a    the same repo-relative path (server/ stands in for connector/,
//     relative path outside connector/        so `../../conductor/x.mjs` keeps resolving)
//   connector/package.json + lockfile       package.json + package-lock.json at the plugin ROOT (Claude
//                                            Code installs registry deps only from a root lockfile)
//   connector/PLUGIN-README.md              README.md ({{VERSION}} filled in; the directory wants a README here)
//   LICENSE                                 LICENSE (Elastic License 2.0; named by `license` in plugin.json)
//
// Why a copy: only the plugin directory is installed, and symlinks leading outside it are rejected.
// Why server/ and not bin/: a top-level bin/ stops claude.ai and Cowork installing the plugin.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PLUGIN_REL = 'plugins/laneconductor';
export const MARKETPLACE_REL = '.claude-plugin/marketplace.json';
const SKILL_SRC = '.claude/skills/laneconductor';
const AUTHOR = 'Asaf Meller';
const AUTHOR_URL = 'https://github.com/meller';
const REPO_URL = 'https://github.com/meller/laneconductor';
const SERVER_ENTRY = 'bin/lc-connector.mjs';
const SERVER_BINS = [SERVER_ENTRY, 'bin/lc-board.mjs'];

const json = (v) => `${JSON.stringify(v, null, 2)}\n`;

function walk(root, rel = '') {
  const out = [];
  for (const ent of fs.readdirSync(path.join(root, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const r = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.name === 'node_modules' || ent.name === '.DS_Store') continue;
    if (ent.isSymbolicLink()) throw new Error(`${path.join(root, r)} is a symlink; the plugin must hold real files`);
    if (ent.isDirectory()) out.push(...walk(root, r));
    else if (ent.isFile()) out.push(r);
  }
  return out;
}

/** Relative import specifiers (static `from '...'`, `import '...'`, `import('...')`) of a source file. */
function relativeImports(source) {
  const specs = [];
  const re = /(?:\bfrom\s*|\bimport\s*\(?\s*)(['"])(\.{1,2}\/[^'"]+)\1/g;
  for (let m; (m = re.exec(source));) specs.push(m[2]);
  return specs;
}

/** Returns Map<pluginRelPath, { content: Buffer, exec: boolean }>. */
export function buildPlugin(repo = REPO) {
  const files = new Map();
  const srcOf = new Map(); // plugin-relative path -> repo-relative source path
  const addFrom = (srcRel, destRel) => {
    const abs = path.join(repo, srcRel);
    files.set(destRel, { content: fs.readFileSync(abs), exec: (fs.statSync(abs).mode & 0o111) !== 0 });
    srcOf.set(destRel, srcRel);
  };
  const add = (rel, content) => files.set(rel, { content: Buffer.from(content), exec: false });

  // Skill: everything under the skill folder.
  for (const r of walk(path.join(repo, SKILL_SRC))) addFrom(`${SKILL_SRC}/${r}`, `skills/laneconductor/${r}`);

  // Server: entry point, src/, guides/ (server/ is connector/'s stand-in).
  for (const bin of SERVER_BINS) addFrom(`connector/${bin}`, `server/${bin}`);
  for (const dir of ['src', 'guides']) {
    for (const r of walk(path.join(repo, 'connector', dir))) addFrom(`connector/${dir}/${r}`, `server/${dir}/${r}`);
  }

  // Repo files the server reaches with a relative import that leaves connector/ (transitively).
  // They land at their repo-relative path under the plugin root, which is what `../../` from
  // server/src resolves to.
  const queue = [...files.keys()].filter((r) => r.startsWith('server/') && r.endsWith('.mjs'));
  while (queue.length) {
    const rel = queue.shift();
    const srcRel = srcOf.get(rel);
    for (const spec of relativeImports(files.get(rel).content.toString('utf8'))) {
      const targetRel = path.relative(repo, path.resolve(repo, path.dirname(srcRel), spec)).split(path.sep).join('/');
      if (targetRel.startsWith('connector/')) continue; // copied under server/ (or deliberately not shipped)
      if (targetRel.startsWith('..')) throw new Error(`${srcRel} imports ${spec}, which leaves the repo`);
      if (files.has(targetRel)) continue;
      if (!fs.existsSync(path.join(repo, targetRel))) throw new Error(`${srcRel} imports ${spec}, but ${targetRel} does not exist`);
      addFrom(targetRel, targetRel);
      queue.push(targetRel);
    }
  }

  // package.json + lockfile at the plugin root, derived from the connector's (runtime deps only).
  const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'connector/package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(repo, 'connector/package-lock.json'), 'utf8'));
  const pluginPkgName = 'laneconductor-plugin';
  add('package.json', json({ name: pluginPkgName, version: pkg.version, type: pkg.type, dependencies: pkg.dependencies }));
  const packages = {};
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (key === '') {
      packages[''] = { name: pluginPkgName, version: pkg.version, dependencies: pkg.dependencies, engines: entry.engines };
      if (!entry.engines) delete packages[''].engines;
    } else if (!entry.dev) packages[key] = entry;
  }
  add('package-lock.json', json({ name: pluginPkgName, version: pkg.version, lockfileVersion: lock.lockfileVersion, requires: true, packages }));

  // README (the directory's checks read the plugin folder) and LICENSE.
  add('README.md', fs.readFileSync(path.join(repo, 'connector/PLUGIN-README.md'), 'utf8').replaceAll('{{VERSION}}', pkg.version));
  addFrom('LICENSE', 'LICENSE');

  // Manifest and MCP config.
  add('.claude-plugin/plugin.json', json({
    name: 'laneconductor',
    version: pkg.version,
    description: 'LaneConductor: the planning and delivery workflow skill plus the git-backed MCP connector that reads and writes tracks safely.',
    author: { name: AUTHOR, url: AUTHOR_URL },
    homepage: 'https://laneconductor.com',
    repository: REPO_URL,
    license: 'Elastic-2.0',
    keywords: ['laneconductor', 'tracks', 'planning', 'git', 'mcp'],
    documentationUrl: `${REPO_URL}/blob/main/connector/PLUGIN-README.md`,
    supportUrl: `${REPO_URL}/issues`,
  }));
  add('.mcp.json', json({
    mcpServers: {
      'lc-connector': {
        command: 'node',
        args: ['${CLAUDE_PLUGIN_ROOT}/server/bin/lc-connector.mjs', '--repo', '${CLAUDE_PROJECT_DIR}'],
      },
    },
  }));
  return files;
}

export function buildMarketplace() {
  return json({
    name: 'laneconductor',
    owner: { name: AUTHOR },
    description: 'LaneConductor plugins: the planning and delivery workflow skill and its git-backed MCP connector.',
    plugins: [{
      name: 'laneconductor',
      source: `./${PLUGIN_REL}`,
      description: 'The LaneConductor skill and its git-backed MCP connector, delivered as one plugin.',
      author: { name: AUTHOR },
    }],
  });
}

/** Everything the generator owns, keyed by repo-relative path. */
export function buildAll(repo = REPO) {
  const out = new Map();
  for (const [rel, f] of buildPlugin(repo)) out.set(`${PLUGIN_REL}/${rel}`, f);
  out.set(MARKETPLACE_REL, { content: Buffer.from(buildMarketplace()), exec: false });
  return out;
}

/** Differences between a fresh build and what is on disk. Empty array means no drift. */
export function diffAgainstDisk(repo = REPO) {
  const want = buildAll(repo);
  const problems = [];
  const pluginAbs = path.join(repo, PLUGIN_REL);
  const have = fs.existsSync(pluginAbs) ? walk(pluginAbs).map((r) => `${PLUGIN_REL}/${r}`) : [];
  for (const rel of have) if (!want.has(rel)) problems.push(`extra file: ${rel}`);
  for (const [rel, f] of want) {
    const abs = path.join(repo, rel);
    if (!fs.existsSync(abs)) { problems.push(`missing: ${rel}`); continue; }
    if (!fs.readFileSync(abs).equals(f.content)) problems.push(`differs: ${rel}`);
    else if (((fs.statSync(abs).mode & 0o111) !== 0) !== f.exec) problems.push(`exec bit differs: ${rel}`);
  }
  return problems;
}

export function writeAll(repo = REPO) {
  const want = buildAll(repo);
  fs.rmSync(path.join(repo, PLUGIN_REL), { recursive: true, force: true });
  for (const [rel, f] of want) {
    const abs = path.join(repo, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, f.content, { mode: f.exec ? 0o755 : 0o644 });
    fs.chmodSync(abs, f.exec ? 0o755 : 0o644);
  }
  return want.size;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const problems = diffAgainstDisk();
    if (problems.length) {
      process.stderr.write(`plugin output is out of date (run: node scripts/build-plugin.mjs):\n${problems.map((p) => `  ${p}`).join('\n')}\n`);
      process.exit(1);
    }
    console.log('plugins/laneconductor and .claude-plugin/marketplace.json are up to date.');
  } else {
    console.log(`wrote ${writeAll()} files under ${PLUGIN_REL}/ and ${MARKETPLACE_REL}`);
  }
}
