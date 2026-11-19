// Builds the skill packs (track AM-10129, Phase 3): Markdown-only plugins made from the root `skills/` folder, which also serves
// `npx skills add meller/laneconductor`. Called by scripts/build-plugin.mjs; it writes nothing itself.
//
//   scripts/skill-packs.json     the pack list: name, display name, version, description, keywords and skills of each pack. Each folder under
//                                skills/ is in exactly one pack. (Not in skills/ itself: that folder holds only skill folders.)
//   skills/<name>/**             copied byte for byte (hidden template files included) into plugins/<pack>/skills/<name>/**
//
// Output per pack: .claude-plugin/plugin.json, .claude-plugin/icon.png (the one the other plugins use), skills/<name>/**, README.md, LICENSE.
// No script, hook, .mcp.json, package file, agent or `isolation` key: a pack holds advice and templates only. Deterministic: no dates, sorted
// order, every byte from a source file or a fixed template, so `build-plugin.mjs --check` is a pure comparison.
//
//   node scripts/build-skill-packs.mjs [--repo <dir>]    validate the pack list against skills/ and list the packs; exit 1 with a message when
//                                                        a skill is in no pack or in two, or a pack names a missing skill
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUTHOR, AUTHOR_URL, MARKETPLACE, MARKETPLACE_SOURCE, PRIVACY_URL, REPO_URL } from './plugin-texts.mjs';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PACKS_REL = 'scripts/skill-packs.json';
export const SKILLS_REL = 'skills';
export const PACK_ICON_SRC = 'connector/plugin-extras/icon.png'; // the same icon as the three other plugins
export const SKILLS_DOC_URL = `${REPO_URL}/blob/main/docs/skills.md`;
const json = (v) => `${JSON.stringify(v, null, 2)}\n`;

/** The skill folders under skills/ (sorted names). Anything that is not a visible folder is ignored; a folder without SKILL.md is an error. */
export function skillFolders(repo = HERE) {
  const root = path.join(repo, SKILLS_REL);
  if (!fs.existsSync(root)) throw new Error(`skill packs: ${SKILLS_REL}/ does not exist`);
  const names = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort();
  for (const n of names) if (!fs.existsSync(path.join(root, n, 'SKILL.md'))) throw new Error(`skill packs: ${SKILLS_REL}/${n}/ has no SKILL.md`);
  return names;
}

/** Reads and validates the pack list. Throws one Error naming every problem. */
export function readPacks(repo = HERE) {
  const file = path.join(repo, PACKS_REL);
  if (!fs.existsSync(file)) throw new Error(`skill packs: ${PACKS_REL} does not exist`);
  const packs = JSON.parse(fs.readFileSync(file, 'utf8')).packs;
  if (!Array.isArray(packs) || packs.length === 0) throw new Error(`skill packs: ${PACKS_REL} has no "packs" list`);
  const problems = [];
  const folders = skillFolders(repo);
  const owner = new Map(); // skill -> pack names
  const names = new Set();
  for (const p of packs) {
    for (const k of ['name', 'displayName', 'version', 'description']) if (typeof p[k] !== 'string' || !p[k]) problems.push(`pack ${p.name ?? '?'}: "${k}" is missing`);
    if (!Array.isArray(p.keywords) || p.keywords.length === 0) problems.push(`pack ${p.name}: "keywords" is missing`);
    if (!Array.isArray(p.skills) || p.skills.length === 0) problems.push(`pack ${p.name}: "skills" is missing or empty`);
    if (typeof p.version === 'string' && !/^\d+\.\d+\.\d+$/.test(p.version)) problems.push(`pack ${p.name}: version ${p.version} is not a plain x.y.z`);
    if (names.has(p.name)) problems.push(`pack ${p.name} is listed twice`);
    names.add(p.name);
    for (const s of p.skills ?? []) {
      if (!folders.includes(s)) problems.push(`pack ${p.name} names the skill "${s}", but ${SKILLS_REL}/${s}/ does not exist`);
      owner.set(s, [...(owner.get(s) ?? []), p.name]);
    }
  }
  for (const f of folders) if (!owner.has(f)) problems.push(`the skill "${f}" is in no pack: add it to ${PACKS_REL}`);
  for (const [s, ps] of owner) if (ps.length > 1) problems.push(`the skill "${s}" is in ${ps.length} packs (${ps.join(', ')}): each skill belongs to exactly one`);
  if (problems.length) throw new Error(`skill packs: ${PACKS_REL} does not match ${SKILLS_REL}/:\n${problems.map((x) => `  ${x}`).join('\n')}`);
  return packs;
}

function walk(root, rel = '') {
  const out = [];
  for (const ent of fs.readdirSync(path.join(root, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const r = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.name === 'node_modules' || ent.name === '.DS_Store') continue;
    if (ent.isSymbolicLink()) throw new Error(`${path.join(root, r)} is a symlink; a pack must hold real files`);
    if (ent.isDirectory()) out.push(...walk(root, r));
    else if (ent.isFile()) out.push(r);
  }
  return out;
}

/** The one-line description of a skill, read from its frontmatter (a quoted or plain single-line `description:`). */
export function skillDescription(text, name = '?') {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  const line = m && m[1].split('\n').find((l) => l.startsWith('description:'));
  if (!line) throw new Error(`skill ${name}: SKILL.md has no description in its frontmatter`);
  const v = line.slice('description:'.length).trim();
  if (v.startsWith('"')) return JSON.parse(v);
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  if (!v) throw new Error(`skill ${name}: the description is not on one line`);
  return v;
}

const bullets = (items) => items.map((i) => `- ${i}`).join('\n');

/** The README of one pack, generated. Short on purpose (under 400 words). */
export function packReadme(pack, descriptions) {
  const plugin = `${pack.name}@${MARKETPLACE}`;
  return `# ${pack.displayName}

${pack.description}

A skill pack for Claude Code, version ${pack.version}, from the LaneConductor marketplace. It holds Markdown and template files only: no script, hook, MCP server or agent, and it sends nothing anywhere. It works on its own; LaneConductor is not required.

## Skills

${bullets(pack.skills.map((s) => `\`${s}\`: ${descriptions[s]}`))}

## Install

\`\`\`
claude plugin marketplace add ${MARKETPLACE_SOURCE}
claude plugin install ${plugin}
\`\`\`

## Update

\`\`\`
claude plugin marketplace update ${MARKETPLACE}
claude plugin update ${plugin}
\`\`\`

## Advice, never orders

These skills are one author's own conventions and the incidents behind them, observed in the author's own projects with LaneConductor. Claude may decide against one and say why. Names such as \`<shared-project>\` or \`<product>\` are placeholders you fill in for your own setup. See [docs/skills.md](${SKILLS_DOC_URL}) for the format and for attaching skills to lanes.

## License

Elastic License 2.0; see [LICENSE](LICENSE). Privacy: ${PRIVACY_URL}. Questions and bugs: ${REPO_URL}/issues
`;
}

function manifest(pack) {
  return json({
    name: pack.name,
    displayName: pack.displayName,
    version: pack.version,
    description: pack.description,
    author: { name: AUTHOR, url: AUTHOR_URL },
    homepage: 'https://laneconductor.com',
    repository: REPO_URL,
    license: 'Elastic-2.0',
    keywords: pack.keywords,
    privacyPolicyUrl: PRIVACY_URL,
  });
}

/** Everything the packs own: { packs, files: Map<repo-relative path, { content: Buffer, exec: boolean }> }. */
export function buildSkillPacks(repo = HERE) {
  const packs = readPacks(repo);
  const files = new Map();
  const put = (rel, content, exec = false) => files.set(rel, { content, exec });
  const fromRepo = (srcRel) => { const abs = path.join(repo, srcRel); return [fs.readFileSync(abs), (fs.statSync(abs).mode & 0o111) !== 0]; };
  for (const pack of packs) {
    const base = `plugins/${pack.name}`;
    const descriptions = {};
    for (const s of pack.skills) {
      for (const r of walk(path.join(repo, SKILLS_REL, s))) put(`${base}/skills/${s}/${r}`, ...fromRepo(`${SKILLS_REL}/${s}/${r}`));
      descriptions[s] = skillDescription(fs.readFileSync(path.join(repo, SKILLS_REL, s, 'SKILL.md'), 'utf8'), s);
    }
    put(`${base}/.claude-plugin/plugin.json`, Buffer.from(manifest(pack)));
    put(`${base}/.claude-plugin/icon.png`, ...fromRepo(PACK_ICON_SRC));
    put(`${base}/LICENSE`, ...fromRepo('LICENSE'));
    put(`${base}/README.md`, Buffer.from(packReadme(pack, descriptions)));
  }
  return { packs, files };
}

/** Marketplace entries for the packs, in the style of the three others plus the pack's own version. */
export function packMarketplaceEntries(packs) {
  return packs.map((p) => ({ name: p.name, source: `./plugins/${p.name}`, description: p.description, version: p.version, author: { name: AUTHOR } }));
}

/** The section appended to docs/plugin-map.md: which skills each pack holds. */
export function packsMapSection(packs) {
  const L = ['', '## Skill packs', ''];
  L.push(`${packs.length} more plugins from the same generator, built from the root \`${SKILLS_REL}/\` folder (the pack list is \`${PACKS_REL}\`). Each holds Markdown and template files only (no script, hook, MCP server, agent or \`isolation\` key), has its own version, depends on no other plugin, and each skill is in exactly one pack. They are advice, never orders; the base plugin does not list them.`, '');
  L.push('| Plugin | Version | Skills |', '| :--- | :--- | :--- |');
  for (const p of packs) L.push(`| \`${p.name}\` | ${p.version} | ${p.skills.map((s) => `\`${s}\``).join(', ')} |`);
  L.push('');
  return L.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const i = process.argv.indexOf('--repo');
    const repo = i < 0 ? HERE : path.resolve(process.argv[i + 1]);
    const packs = readPacks(repo);
    for (const p of packs) console.log(`${p.name} ${p.version}: ${p.skills.join(', ')}`);
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exit(1);
  }
}
