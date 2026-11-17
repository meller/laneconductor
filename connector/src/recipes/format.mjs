// Recipe format (track 10107, spec REQ-1..4): a recipe is a skill folder, so this checks the skill
// frontmatter rules plus the recipe-specific `metadata` and body sections. Pure: text in, errors out.
import YAML from 'yaml';

export const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const DESCRIPTION_LIMIT = 1536;
export const BODY_LIMIT = 8000;
export const KINDS = ['recipe', 'process'];
const TOP_LEVEL = ['name', 'description', 'when_to_use', 'paths', 'metadata'];
// Documented skill frontmatter names (V1): a `metadata` key must not reuse any of them.
const RESERVED = [...TOP_LEVEL, 'allowed-tools', 'argument-hint', 'arguments', 'disable-model-invocation', 'user-invocable', 'model', 'effort', 'context', 'agent', 'hooks', 'shell'];
const SECTIONS = ['Why this works for you', 'Recommendation', 'Claude does', 'You run', 'Pitfalls', 'Unproven'];
const REQUIRED = { recipe: ['Why this works for you', 'Recommendation', 'Claude does', 'You run', 'Pitfalls'], process: ['Why this works for you', 'Recommendation'] };
const TAG_RE = /^[a-z0-9][a-z0-9._+-]*$/;

/** @returns {{ frontmatter: object|null, body: string, error: string|null }} */
export function parseSkill(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/.exec(text);
  if (!m) return { frontmatter: null, body: text, error: 'SKILL.md must start with a --- frontmatter block' };
  m[2] = m[2].replace(/^(?:[ \t]*\r?\n)+/, ''); // the blank line after the frontmatter is not body
  let fm;
  try {
    fm = YAML.parse(m[1]);
  } catch (e) {
    return { frontmatter: null, body: m[2], error: `frontmatter is not valid YAML: ${String(e.message).split('\n')[0]}` };
  }
  if (!fm || typeof fm !== 'object' || Array.isArray(fm)) return { frontmatter: null, body: m[2], error: 'frontmatter must be a YAML map' };
  return { frontmatter: fm, body: m[2], error: null };
}

/** `paths` is documented as a comma-separated string or a list; always returns a list of globs. */
export function parsePaths(value) {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? splitTopLevel(value) : [];
  return list.filter((p) => typeof p === 'string').map((p) => p.trim()).filter(Boolean);
}

function splitTopLevel(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '{') depth++;
    if (ch === '}') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Level-2 headings of a body, outside code fences, with their line numbers (1-based within the body). */
export function sectionHeadings(body) {
  const out = [];
  let fence = null;
  body.split('\n').forEach((line, i) => {
    const f = /^\s*(```+|~~~+)/.exec(line);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      return;
    }
    if (fence) return;
    const h = /^## +(.+?)\s*#*\s*$/.exec(line);
    if (h) out.push({ title: h[1].trim(), line: i + 1 });
  });
  return out;
}

const isStr = (v) => typeof v === 'string' && v.trim() !== '';
const isoDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

function checkMetadata(md, errors) {
  const err = (field, message) => errors.push({ field, message });
  if (md === undefined || md === null || typeof md !== 'object' || Array.isArray(md)) {
    err('metadata', 'must be a YAML map holding kind, stack, prerequisites, reference, verified (a value that is not a map is dropped by Claude Code)');
    return null;
  }
  for (const k of Object.keys(md)) if (RESERVED.includes(k)) err(`metadata.${k}`, `reuses the frontmatter field name "${k}"; pick another key`);
  const kind = md.kind;
  if (!KINDS.includes(kind)) {
    err('metadata.kind', `must be "recipe" or "process" (got ${JSON.stringify(kind)})`);
  }
  if (md.stack !== undefined) {
    if (!Array.isArray(md.stack) || !md.stack.every((t) => typeof t === 'string' && TAG_RE.test(t))) err('metadata.stack', 'must be a list of short lowercase tags such as gcp, firebase-hosting, nodejs22');
  } else if (kind === 'recipe') err('metadata.stack', 'is required for a recipe');
  if (md.prerequisites !== undefined && (!Array.isArray(md.prerequisites) || !md.prerequisites.every(isStr))) err('metadata.prerequisites', 'must be a list of plain sentences');
  if (md.reference !== undefined) {
    if (!Array.isArray(md.reference)) err('metadata.reference', 'must be a list of { repo, path, commit, proves }');
    else {
      md.reference.forEach((r, i) => {
        const at = `metadata.reference[${i}]`;
        if (!r || typeof r !== 'object' || Array.isArray(r)) return err(at, 'must be a map with repo, path, commit, proves');
        if (typeof r.repo !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(r.repo)) err(`${at}.repo`, 'must be owner/name');
        if (!isStr(r.path) || r.path.startsWith('/') || r.path.split('/').includes('..')) err(`${at}.path`, 'must be a relative path inside the repo');
        if (typeof r.commit !== 'string' || !/^[0-9a-f]{7,40}$/.test(r.commit)) err(`${at}.commit`, 'must be a 7 to 40 character hex commit, written as a string (quote it when it is all digits)');
        if (!isStr(r.proves)) err(`${at}.proves`, 'must say what the reference proves');
      });
    }
  }
  if (kind === 'recipe' && !(Array.isArray(md.reference) && md.reference.length > 0)) err('metadata.reference', 'a recipe needs at least one reference (a pointer to working code beats prose)');
  if (!('verified' in md)) err('metadata.verified', 'is required: an ISO date, or null for a draft');
  else if (md.verified !== null && !isoDate(md.verified)) err('metadata.verified', 'must be an ISO date (YYYY-MM-DD) or null');
  if (md.smoke_check !== undefined && (!isStr(md.smoke_check) || md.smoke_check.includes('\n'))) err('metadata.smoke_check', 'must be one command on one line');
  return kind;
}

function checkBody(body, kind, errors) {
  const err = (field, message) => errors.push({ field, message });
  if (body.length > BODY_LIMIT) err('body', `is ${body.length} characters; the limit is ${BODY_LIMIT} (longer usually means generic knowledge that does not belong in a recipe)`);
  const found = sectionHeadings(body).map((h) => h.title).filter((t) => SECTIONS.includes(t));
  for (const need of REQUIRED[kind] ?? REQUIRED.recipe) if (!found.includes(need)) err('body', `missing section "## ${need}"`);
  const seen = new Set();
  for (const t of found) {
    if (seen.has(t)) err('body', `section "## ${t}" appears more than once`);
    seen.add(t);
  }
  const order = found.map((t) => SECTIONS.indexOf(t));
  for (let i = 1; i < order.length; i++) {
    if (order[i] < order[i - 1]) {
      err('body', `section "## ${found[i]}" must come before "## ${found[i - 1]}" (order: ${SECTIONS.join(', ')})`);
      break;
    }
  }
}

/**
 * @param {{ folder: string, text: string }} input  `folder` is the recipe's directory name.
 * @returns {{ ok: boolean, errors: { field: string, message: string }[], frontmatter: object|null, body: string }}
 */
export function checkRecipe({ folder, text }) {
  const errors = [];
  const err = (field, message) => errors.push({ field, message });
  const { frontmatter: fm, body, error } = parseSkill(text);
  if (error) return { ok: false, errors: [{ field: 'frontmatter', message: error }], frontmatter: null, body };

  if (!isStr(fm.name)) err('name', 'is required');
  else if (!NAME_RE.test(fm.name) || fm.name.length > 64) err('name', `must be kebab-case, at most 64 characters (got ${JSON.stringify(fm.name)})`);
  else if (fm.name !== folder) err('name', `must equal the folder name (folder "${folder}", name "${fm.name}")`);
  for (const k of Object.keys(fm)) {
    if (!TOP_LEVEL.includes(k)) err(k, `is not a documented skill field; recipe-specific fields belong under metadata (allowed top-level: ${TOP_LEVEL.join(', ')})`);
  }
  if (!isStr(fm.description)) err('description', 'is required');
  if (fm.when_to_use !== undefined && typeof fm.when_to_use !== 'string') err('when_to_use', 'must be a string');
  const len = (typeof fm.description === 'string' ? fm.description.length : 0) + (typeof fm.when_to_use === 'string' ? fm.when_to_use.length : 0);
  if (len > DESCRIPTION_LIMIT) err('description', `description + when_to_use are ${len} characters; the listing cuts them at ${DESCRIPTION_LIMIT}`);
  if (fm.paths !== undefined && !(typeof fm.paths === 'string' || (Array.isArray(fm.paths) && fm.paths.every((p) => typeof p === 'string')))) err('paths', 'must be a comma-separated string or a list of globs');

  const kind = checkMetadata(fm.metadata, errors);
  checkBody(body, KINDS.includes(kind) ? kind : 'recipe', errors);
  return { ok: errors.length === 0, errors, frontmatter: fm, body };
}
