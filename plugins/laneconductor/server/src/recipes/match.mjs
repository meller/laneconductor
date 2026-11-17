// Recipe discovery and ranking (track AM-10117, Phase 2 Tasks 1 and 2). Pure ranking plus a small reader for the two libraries.
//
// Two libraries, read in this order (REQ-2): (1) the SHIPPED library, `recipes/<name>/SKILL.md` inside the skill folder; (2) the
// person's OWN library, a local git repo named by `--personal`, the `LC_RECIPES` environment variable, or `recipes.path` in the
// project's `.laneconductor.json`. A recipe with the same name in both is shown once, from the person's own library.
//
// Ranking is deterministic and uses only `metadata.stack`: overlap with the tags derived from the interview (more shared tags
// first), then the share of the recipe's own tags covered, then the newer `verified` date, then the name. A recipe sharing no tag
// is not a match. `metadata.prerequisites` are sentences, so they are not scored; they travel with the match for the person to
// confirm. Nothing here applies anything.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseSkill } from './format.mjs';
import { recipeFreshness } from './references.mjs';

export const MAX_MATCHES = 5;
export const LIBRARY_ORDER = ['shipped', 'personal'];
// Reasons that deserve a warning next to a recommendation. `reference_unresolvable` only means this machine has no checkout.
const WARN = new Set(['verified_missing', 'verified_older_than_90d', 'reference_missing', 'reference_changed_since_verified']);

export const expandHome = (p) => (typeof p === 'string' && (p === '~' || p.startsWith('~/')) ? path.join(os.homedir(), p.slice(1)) : p);

const asTags = (v) => (Array.isArray(v) ? v.filter((t) => typeof t === 'string').map((t) => t.trim().toLowerCase()).filter(Boolean) : []);

/** Reads `<libDir>/recipes/<name>/SKILL.md` into plain recipe records. Unreadable or malformed ones are listed under `skipped`, never thrown. */
export async function loadLibrary(libDir, role) {
  const root = path.join(libDir, 'recipes');
  let dirs;
  try {
    dirs = (await fs.readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch {
    return { role, path: libDir, status: 'no_recipes_folder', recipes: [], skipped: [] };
  }
  const recipes = [];
  const skipped = [];
  for (const name of dirs) {
    let text;
    try {
      text = await fs.readFile(path.join(root, name, 'SKILL.md'), 'utf8');
    } catch {
      skipped.push({ name, reason: 'no SKILL.md' });
      continue;
    }
    const { frontmatter: fm, error } = parseSkill(text);
    if (error || typeof fm?.name !== 'string') {
      skipped.push({ name, reason: error ?? 'no name' });
      continue;
    }
    const md = fm.metadata && typeof fm.metadata === 'object' ? fm.metadata : {};
    recipes.push({
      name: fm.name,
      library: role,
      dir: path.join(root, name),
      description: typeof fm.description === 'string' ? fm.description : '',
      kind: md.kind ?? 'recipe',
      stack: asTags(md.stack),
      prerequisites: Array.isArray(md.prerequisites) ? md.prerequisites.filter((p) => typeof p === 'string') : [],
      verified: typeof md.verified === 'string' ? md.verified : null,
      metadata: md,
    });
  }
  return { role, path: libDir, status: recipes.length || dirs.length ? 'ok' : 'empty', recipes, skipped };
}

/**
 * Finds the two libraries in the documented order. `personal` wins over the environment, which wins over the config file.
 * @returns {Promise<{ libraries: object[], recipes: object[] }>} `recipes` is the merged list (shipped first; a personal recipe replaces a shipped one of the same name)
 */
export async function discoverLibraries({ shipped = null, personal = null, env = process.env, repo = null } = {}) {
  let personalDir = personal || env.LC_RECIPES || null;
  let personalFrom = personal ? 'flag' : env.LC_RECIPES ? 'LC_RECIPES' : null;
  if (!personalDir && repo) {
    try {
      const cfg = JSON.parse(await fs.readFile(path.join(repo, '.laneconductor.json'), 'utf8'));
      if (typeof cfg?.recipes?.path === 'string' && cfg.recipes.path.trim()) { personalDir = cfg.recipes.path.trim(); personalFrom = 'recipes.path'; }
    } catch { /* no config, or not JSON: no personal library named */ }
  }
  const libraries = [];
  if (shipped) libraries.push(await loadLibrary(shipped, 'shipped'));
  if (personalDir) {
    const dir = path.resolve(expandHome(personalDir));
    const lib = await loadLibrary(dir, 'personal');
    lib.named_by = personalFrom;
    libraries.push(lib);
  }
  const byName = new Map();
  for (const lib of libraries) {
    for (const r of lib.recipes) byName.set(r.name, byName.has(r.name) ? { ...r, shadows: byName.get(r.name).library } : r);
  }
  return { libraries, recipes: [...byName.values()] };
}

/** Every stack tag in the given recipes, sorted: the vocabulary to pick interview tags from. */
export const vocabulary = (recipes) => [...new Set(recipes.flatMap((r) => r.stack))].sort();

/**
 * Ranks recipes against interview tags. With no tags it lists them all (name order). `limit` caps the result (default 5, null = no cap).
 * @returns {object[]} `{ ...recipe, overlap: string[], coverage: number }`, best first
 */
export function rankRecipes(recipes, { tags = [], limit = MAX_MATCHES } = {}) {
  const want = new Set(asTags(tags));
  const scored = recipes.map((r) => {
    const overlap = r.stack.filter((t) => want.has(t));
    return { ...r, overlap, coverage: r.stack.length ? overlap.length / r.stack.length : 0 };
  }).filter((r) => want.size === 0 || r.overlap.length > 0);
  scored.sort((a, b) => b.overlap.length - a.overlap.length
    || b.coverage - a.coverage
    || (b.verified ?? '').localeCompare(a.verified ?? '')
    || a.name.localeCompare(b.name)
    || LIBRARY_ORDER.indexOf(a.library) - LIBRARY_ORDER.indexOf(b.library));
  return limit == null ? scored : scored.slice(0, limit);
}

/** The one line of why a match fits. */
export function whyLine(r, tags) {
  if (!tags.length) return `${r.kind} in the ${r.library} library${r.stack.length ? `: ${r.stack.join(', ')}` : ''}`;
  return `matches ${r.overlap.join(', ')} (${r.overlap.length} of its ${r.stack.length} stack tags)`;
}

/**
 * The full answer: libraries read, matches with freshness. `resolver` (createRefResolver) lets freshness look at the cited
 * reference repos; null skips that and says so.
 */
export async function recommend({ shipped = null, personal = null, env = process.env, repo = null, tags = [], limit = MAX_MATCHES, resolver = null, now = Date.now() } = {}) {
  const found = await discoverLibraries({ shipped, personal, env, repo });
  const want = asTags(tags);
  const ranked = rankRecipes(found.recipes, { tags: want, limit });
  const matches = [];
  for (const [i, r] of ranked.entries()) {
    const fr = resolver ? await recipeFreshness(r.metadata, { resolver, now }) : null;
    const warnings = (fr?.stale_reasons ?? []).filter((x) => WARN.has(x));
    matches.push({
      rank: i + 1,
      name: r.name,
      library: r.library,
      ...(r.shadows ? { shadows: r.shadows } : {}),
      kind: r.kind,
      why: whyLine(r, want),
      verified: r.verified,
      freshness: fr?.freshness ?? 'not_checked',
      warnings,
      references_not_checked: !fr || (fr.stale_reasons ?? []).includes('reference_unresolvable'),
      stack: r.stack,
      prerequisites: r.prerequisites,
      dir: r.dir,
    });
  }
  const anyLibrary = found.libraries.some((l) => l.recipes.length > 0);
  return {
    libraries: found.libraries.map((l) => ({ role: l.role, path: l.path, status: l.status, recipes: l.recipes.length, skipped: l.skipped, ...(l.named_by ? { named_by: l.named_by } : {}) })),
    tags: want,
    matches,
    note: !anyLibrary ? 'No recipe library available (none shipped with the skill and none named by recipes.path or LC_RECIPES); continue without recipes.'
      : matches.length === 0 ? 'No recipe matches these tags; continue without recipes.' : null,
    vocabulary: vocabulary(found.recipes),
  };
}
