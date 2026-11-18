// The checker of the recommendation catalog (track AM-10124, REQ-1, test.md TC-1 and TC-14).
//
//   node scripts/check-catalog.mjs            structure, vocabulary, privacy and coverage; offline, exit 1 on any problem
//   node scripts/check-catalog.mjs --online   the same, plus: every source resolves on the public internet (the marketplace file exists
//                                             without credentials, names the plugin, and the plugin holds every skill, command or agent the
//                                             entry names). Run it before a release and whenever an entry changes.
//   node scripts/check-catalog.mjs --file <path>   check another catalog file (the tests use fixtures)
//
// The catalog is connector/plugin-extras/recommended-plugins.json, the ONE source of every recommendation. An entry that fails here must
// not ship: a missing field, an unknown lane, Type, level or stack tag, a source that is not a public GitHub `owner/repo`, install commands
// that differ from the ones derived from the source, or a name that looks private.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LANES = ['setup', 'brainstorm', 'plan', 'implement', 'review', 'quality-gate', 'merge', 'deploy'];
export const TYPES = ['dev', 'marketing', 'sales', 'support'];
export const KINDS = ['addon', 'skillpack', 'thirdparty'];
export const LEVELS = ['prerequisite', 'helps'];
export const OFFICIAL_MARKETPLACE = { marketplace: 'claude-plugins-official', add: 'anthropics/claude-plugins-official' };
export const REQUIRED = ['name', 'kind', 'display', 'source', 'why', 'licence', 'installs_code', 'lanes', 'types', 'stack', 'level', 'install', 'skills', 'detect', 'verified'];
const OWNER_REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const PLUGIN_ID = /^[a-z0-9][a-z0-9-]*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Names that look private: an internal word as a whole token, a path on someone's machine, a local or file source, a try or scratch marketplace.
const PRIVATE_WORD = [/(^|[-_@/.\s])(internal|private|intranet|corp|corporate|proprietary|confidential|staging|scratch)([-_@/.\s]|$)/i, 'an internal-looking word'];
const PRIVATE_PATTERNS = [
  [/(^|[\s"'(])(~|\/home\/|\/Users\/|\/tmp\/|\/var\/|[A-Za-z]:\\)/, 'a path on a computer'],
  [/\b(localhost|127\.0\.0\.1|file:\/\/|\.local\b|\.internal\b|\.corp\b)/i, 'a local address'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/, 'an email address'],
  [/(^|[-_])try($|[-_])/i, 'a try or test marketplace'],
  [/\bgit@|ssh:\/\//, 'an SSH source'],
];

/** The install commands of an entry, derived from its source (the official marketplace needs no `marketplace add`). */
export function derivedInstall(entry) {
  const s = entry.source ?? {};
  const install = `claude plugin install ${s.plugin}@${s.marketplace}`;
  return s.add === OFFICIAL_MARKETPLACE.add ? [install] : [`claude plugin marketplace add ${s.add}`, install];
}

const strings = (v) => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : []);

/** Structure, vocabulary and privacy of one entry. Returns problem strings (empty when fine). */
export function checkEntry(e, vocab) {
  const p = [];
  const id = typeof e?.name === 'string' && e.name ? e.name : '(unnamed entry)';
  const bad = (m) => p.push(`${id}: ${m}`);
  if (!e || typeof e !== 'object') return [`${id}: not an object`];
  for (const f of REQUIRED) if (!(f in e) || e[f] === null || e[f] === undefined || e[f] === '') bad(`missing field \`${f}\``);
  if (typeof e.name === 'string' && !PLUGIN_ID.test(e.name)) bad(`name \`${e.name}\` is not a plugin id (lower-case letters, digits, hyphens)`);
  if (e.kind !== undefined && !KINDS.includes(e.kind)) bad(`unknown kind \`${e.kind}\` (one of ${KINDS.join(', ')})`);
  if (e.level !== undefined && !LEVELS.includes(e.level)) bad(`unknown level \`${e.level}\` (one of ${LEVELS.join(', ')})`);
  if ('installs_code' in e && typeof e.installs_code !== 'boolean') bad('`installs_code` must be true or false');
  if (e.installs_code === true && !e.installs) bad('`installs_code` is true, so `installs` must say what it installs');
  for (const f of ['why', 'licence', 'detect', 'verified', 'display']) if (e[f] !== undefined && typeof e[f] !== 'string') bad(`\`${f}\` must be a string`);
  if (typeof e.why === 'string' && (e.why.includes('\n') || e.why.length > 300)) bad('`why` must be one line of at most 300 characters');
  for (const f of ['lanes', 'types', 'stack']) {
    if (e[f] !== undefined && !Array.isArray(e[f])) bad(`\`${f}\` must be a list`);
  }
  if (Array.isArray(e.lanes)) {
    if (!e.lanes.length) bad('`lanes` is empty');
    for (const l of e.lanes) if (!vocab.lanes.includes(l)) bad(`unknown lane \`${l}\` (one of ${vocab.lanes.join(', ')})`);
  }
  if (Array.isArray(e.types)) {
    if (!e.types.length) bad('`types` is empty');
    for (const t of e.types) if (!vocab.types.includes(t)) bad(`unknown track Type \`${t}\` (one of ${vocab.types.join(', ')})`);
  }
  if (Array.isArray(e.stack)) for (const t of e.stack) if (!vocab.stack.includes(t)) bad(`unknown stack tag \`${t}\` (one of ${vocab.stack.join(', ') || 'none defined'})`);
  const s = e.source;
  if (s !== undefined) {
    if (!s || typeof s !== 'object') bad('`source` must be { marketplace, add, plugin }');
    else {
      for (const k of ['marketplace', 'add', 'plugin']) if (typeof s[k] !== 'string' || !s[k]) bad(`source is missing \`${k}\``);
      if (typeof s.add === 'string' && !OWNER_REPO.test(s.add)) bad(`source.add \`${s.add}\` is not a public GitHub \`owner/repo\``);
      if (typeof s.plugin === 'string' && !PLUGIN_ID.test(s.plugin)) bad(`source.plugin \`${s.plugin}\` is not a plugin id`);
      if (typeof s.marketplace === 'string' && !PLUGIN_ID.test(s.marketplace)) bad(`source.marketplace \`${s.marketplace}\` is not a marketplace name`);
      if (s.add === OFFICIAL_MARKETPLACE.add && s.marketplace !== OFFICIAL_MARKETPLACE.marketplace) bad(`\`${s.add}\` registers as \`${OFFICIAL_MARKETPLACE.marketplace}\``);
    }
  }
  if (e.source && typeof e.source === 'object' && Array.isArray(e.install)) {
    const want = derivedInstall(e);
    if (JSON.stringify(e.install) !== JSON.stringify(want)) bad(`\`install\` differs from the commands derived from the source (${want.join(' ; ')})`);
  } else if (e.install !== undefined) bad('`install` must be a list of commands');
  if (Array.isArray(e.install)) for (const c of e.install) if (/\$\s|^\$|--yes|\s-y(\s|$)|sudo|\|\s*(ba)?sh|curl |wget /.test(String(c))) bad(`install command \`${c}\` must be a plain claude plugin command: no leading $, no --yes, no pipe to a shell`);
  if (Array.isArray(e.skills)) {
    for (const k of e.skills) {
      if (!k || typeof k.name !== 'string' || !k.name) { bad('each skill needs a `name`'); continue; }
      for (const l of k.lanes ?? []) if (!vocab.lanes.includes(l)) bad(`skill \`${k.name}\`: unknown lane \`${l}\``);
      for (const l of k.lanes ?? []) if (Array.isArray(e.lanes) && !e.lanes.includes(l)) bad(`skill \`${k.name}\`: lane \`${l}\` is not among the entry's lanes`);
      for (const t of k.types ?? []) if (!vocab.types.includes(t)) bad(`skill \`${k.name}\`: unknown Type \`${t}\``);
      for (const t of k.types ?? []) if (Array.isArray(e.types) && !e.types.includes(t)) bad(`skill \`${k.name}\`: Type \`${t}\` is not among the entry's Types`);
    }
  }
  if (e.kind === 'addon' && !(e.triggers?.length && e.adds?.length)) bad('an add-on needs `adds` and `triggers`');
  // Identity strings (names, sources, commands) must not carry an internal-looking word; prose may say "private" (a private board page).
  for (const text of strings([e.name, e.display, e.source, e.install, (e.skills ?? []).map((k) => [k.name, k.aliases])])) {
    for (const [re, what] of [PRIVATE_WORD, ...PRIVATE_PATTERNS]) if (re.test(text)) bad(`looks private (${what}): ${JSON.stringify(text.slice(0, 80))}`);
  }
  for (const text of strings([e.why, e.installs, e.detect, e.licence])) {
    for (const [re, what] of PRIVATE_PATTERNS) if (re.test(text)) bad(`looks private (${what}): ${JSON.stringify(text.slice(0, 80))}`);
  }
  return p;
}

/** The whole catalog, offline: the date, the vocabulary, every entry, unique names, and (unless `coverage: false`) every lane and Type covered. */
export function checkCatalog(catalog, { coverage = true } = {}) {
  const p = [];
  if (!catalog || !Array.isArray(catalog.entries)) return ['the catalog has no `entries` list'];
  if (typeof catalog.checked !== 'string' || !DATE.test(catalog.checked)) p.push('the catalog needs a `checked` date (YYYY-MM-DD)');
  const tags = catalog.stack_tags && typeof catalog.stack_tags === 'object' ? Object.keys(catalog.stack_tags) : [];
  for (const [t, how] of Object.entries(catalog.stack_tags ?? {})) if (typeof how !== 'string' || !how) p.push(`stack tag \`${t}\` has no description of how to recognise it`);
  const vocab = { lanes: LANES, types: TYPES, stack: tags };
  const seen = new Set();
  for (const e of catalog.entries) {
    p.push(...checkEntry(e, vocab));
    if (e?.name) { if (seen.has(e.name)) p.push(`${e.name}: listed twice`); seen.add(e.name); }
    if (typeof e?.verified === 'string' && !DATE.test(e.verified.slice(0, 10))) p.push(`${e.name}: \`verified\` must start with the date it was checked (YYYY-MM-DD)`);
  }
  const fb = catalog.fallback;
  if (fb !== undefined) {
    for (const f of ['name', 'source', 'licence', 'install', 'note', 'verified']) if (!fb?.[f] || (Array.isArray(fb[f]) && !fb[f].length)) p.push(`fallback: missing field \`${f}\``);
    for (const text of strings([fb?.name, fb?.source, fb?.install])) for (const [re, what] of [PRIVATE_WORD, ...PRIVATE_PATTERNS]) if (re.test(text)) p.push(`fallback: looks private (${what}): ${JSON.stringify(text.slice(0, 80))}`);
  }
  if (coverage) p.push(...coverageProblems(catalog));
  return p;
}

/** TC-14: every lane has at least one entry or skill, and every track Type has at least one entry that serves it. */
export function coverageProblems(catalog) {
  const p = [];
  for (const lane of LANES) {
    const hit = catalog.entries.some((e) => (e.skills?.length ? e.skills.some((k) => (k.lanes ?? e.lanes).includes(lane)) : e.lanes?.includes(lane)));
    if (!hit) p.push(`coverage: no entry for the lane \`${lane}\``);
  }
  for (const type of TYPES) if (!catalog.entries.some((e) => e.types?.includes(type))) p.push(`coverage: no entry for the track Type \`${type}\``);
  for (const type of ['marketing', 'sales', 'support']) {
    for (const lane of ['plan', 'implement']) {
      const hit = catalog.entries.some((e) => e.types?.includes(type) && (e.skills?.length ? e.skills.some((k) => (k.lanes ?? e.lanes).includes(lane) && (k.types ?? e.types).includes(type)) : e.lanes?.includes(lane)));
      if (!hit) p.push(`coverage: nothing for a \`${type}\` track in the \`${lane}\` lane`);
    }
  }
  return p;
}

// ---- Online: does every source resolve, and does the plugin hold what the entry names? ----
const RAW = 'https://raw.githubusercontent.com';
const githubRepoOf = (url) => (typeof url === 'string' ? url.match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/)?.[1] ?? null : null);

/** Fetches a text file; null when it does not exist. */
export async function fetchRaw(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

/** Where a marketplace entry's plugin lives: { repo, dir, ref } or null (a source kind this checker does not read). */
export function pluginLocation(marketplaceRepo, listed) {
  const src = listed.source;
  if (typeof src === 'string') return { repo: marketplaceRepo, dir: src.replace(/^\.\//, '').replace(/^\.$/, '').replace(/\/$/, ''), ref: 'HEAD' };
  const repo = githubRepoOf(src?.url) ?? (typeof src?.repo === 'string' && OWNER_REPO.test(src.repo) ? src.repo : null);
  if (!repo) return null;
  return { repo, dir: (src.path ?? '').replace(/^\.\//, '').replace(/\/$/, ''), ref: src.sha ?? src.ref ?? 'HEAD' };
}

/** Resolves every entry's source with `fetchText(url) -> string | null`. Returns problem strings. */
export async function checkCatalogOnline(catalog, { fetchText = fetchRaw } = {}) {
  const p = [];
  const markets = new Map();
  const get = async (url) => { try { return await fetchText(url); } catch (err) { p.push(`could not read ${url}: ${err.message}`); return undefined; } };
  const all = catalog.entries.map((e) => ({ ...e, fb: false }));
  for (const e of all) {
    const bad = (m) => p.push(`${e.name}: ${m}`);
    const s = e.source;
    if (!s?.add || !OWNER_REPO.test(s.add)) continue; // the offline check already reports it
    if (!markets.has(s.add)) {
      const text = await get(`${RAW}/${s.add}/HEAD/.claude-plugin/marketplace.json`);
      let json = null;
      if (text) { try { json = JSON.parse(text); } catch { json = false; } }
      markets.set(s.add, json);
    }
    const market = markets.get(s.add);
    if (market === undefined) continue;
    if (market === null) { bad(`${s.add} has no public .claude-plugin/marketplace.json (the source does not resolve)`); continue; }
    if (market === false) { bad(`${s.add}: .claude-plugin/marketplace.json is not valid JSON`); continue; }
    if (market.name !== s.marketplace) bad(`${s.add} registers as marketplace \`${market.name}\`, not \`${s.marketplace}\``);
    const listed = (market.plugins ?? []).find((x) => x.name === s.plugin);
    if (!listed) { bad(`marketplace ${s.add} does not list a plugin \`${s.plugin}\``); continue; }
    const loc = pluginLocation(s.add, listed);
    if (!loc) { bad(`plugin \`${s.plugin}\` has a source this checker cannot read (${JSON.stringify(listed.source).slice(0, 80)})`); continue; }
    const base = `${RAW}/${loc.repo}/${loc.ref}${loc.dir ? `/${loc.dir}` : ''}`;
    let skillsDir = 'skills';
    const manifest = await get(`${base}/.claude-plugin/plugin.json`);
    if (manifest) { try { const m = JSON.parse(manifest); if (typeof m.skills === 'string') skillsDir = m.skills.replace(/^\.\//, '').replace(/\/$/, ''); } catch { /* a manifest that is not JSON is not ours to judge here */ } }
    for (const k of e.skills ?? []) {
      let found = false;
      for (const rel of [`${skillsDir}/${k.name}/SKILL.md`, `commands/${k.name}.md`, `agents/${k.name}.md`]) {
        if ((await get(`${base}/${rel}`)) != null) { found = true; break; }
      }
      if (!found) bad(`plugin \`${s.plugin}\` (${loc.repo}) holds no skill, command or agent named \`${k.name}\``);
    }
  }
  const fb = catalog.fallback;
  if (fb?.repo && OWNER_REPO.test(fb.repo) && fb.skill_path) {
    if ((await get(`${RAW}/${fb.repo}/HEAD/${fb.skill_path}`)) == null) p.push(`fallback ${fb.name}: ${fb.repo} has no ${fb.skill_path}`);
  }
  return p;
}

const here = fileURLToPath(import.meta.url);
export const DEFAULT_CATALOG = path.join(path.dirname(here), '..', 'connector', 'plugin-extras', 'recommended-plugins.json');

if (process.argv[1] && path.resolve(process.argv[1]) === here) {
  const args = process.argv.slice(2);
  const fi = args.indexOf('--file');
  const file = fi >= 0 ? path.resolve(args[fi + 1]) : DEFAULT_CATALOG;
  const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
  let problems = checkCatalog(catalog);
  if (args.includes('--online')) problems = [...problems, ...(await checkCatalogOnline(catalog))];
  if (problems.length) {
    process.stderr.write(`catalog problems in ${path.relative(process.cwd(), file) || file}:\n${problems.map((x) => `  ${x}`).join('\n')}\n`);
    process.exit(1);
  }
  console.log(`${path.basename(file)}: ${catalog.entries.length} entries, checked ${catalog.checked}${args.includes('--online') ? ', every source resolved online' : ' (offline; add --online to resolve the sources)'}.`);
}
