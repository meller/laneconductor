// Runs the format checker, the secret scanner and the reference resolver over a library checkout on
// disk. Used by bin/lc-recipe-check.mjs (and later by save_recipe's validation).
import fs from 'node:fs/promises';
import path from 'node:path';
import { checkRecipe } from './format.mjs';
import { checkReference, recipeFreshness } from './references.mjs';
import { scanText } from './secrets.mjs';

async function walk(dir, rel = '') {
  const out = [];
  for (const e of await fs.readdir(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await walk(dir, r)));
    else if (e.isFile()) out.push(r);
  }
  return out;
}

const isEnvFile = (name) => /^\.env(\..+)?$/.test(name) && !/^\.env\.example(\.tmpl)?$/.test(name);

/**
 * @returns {Promise<{ recipes: number, findings: { severity: 'error'|'warn', recipe: string|null, where: string, message: string }[] }>}
 * Errors fail the check; warnings (a reference that cannot be resolved here, a possibly stale recipe) do not.
 */
export async function checkLibraryDir(libDir, { resolver = null, now = Date.now() } = {}) {
  const findings = [];
  const add = (severity, recipe, where, message) => findings.push({ severity, recipe, where, message });
  const root = path.join(libDir, 'recipes');
  let dirs;
  try {
    dirs = (await fs.readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch {
    add('error', null, 'recipes/', 'no recipes/ folder in the library');
    return { recipes: 0, findings };
  }
  for (const name of dirs) {
    const base = `recipes/${name}`;
    let text;
    try {
      text = await fs.readFile(path.join(root, name, 'SKILL.md'), 'utf8');
    } catch {
      add('error', name, `${base}/SKILL.md`, 'SKILL.md is missing');
      continue;
    }
    const res = checkRecipe({ folder: name, text });
    for (const e of res.errors) add('error', name, `${base}/SKILL.md [${e.field}]`, e.message);
    for (const f of await walk(path.join(root, name))) {
      if (isEnvFile(path.basename(f))) add('error', name, `${base}/${f}`, 'a .env file does not belong in a recipe (only .env.example with empty or fake values)');
      const buf = await fs.readFile(path.join(root, name, f));
      if (buf.includes(0)) continue;
      for (const s of scanText(buf.toString('utf8'), `${base}/${f}`)) add('error', name, `${s.file}:${s.line}`, `possible secret (${s.pattern}); the value is not shown`);
    }
    const md = res.frontmatter?.metadata;
    if (md && typeof md === 'object' && Array.isArray(md.reference)) {
      let refError = false;
      for (const ref of md.reference) {
        if (!ref || typeof ref.repo !== 'string' || typeof ref.path !== 'string' || typeof ref.commit !== 'string') continue;
        const r = await checkReference(ref, resolver);
        const at = `${base}/SKILL.md [metadata.reference ${ref.repo}:${ref.path}@${ref.commit}]`;
        if (r.status === 'missing_at_commit') refError = true;
        if (r.status === 'missing_at_commit') add('error', name, at, 'the path does not exist at the cited commit (or the commit is unknown in the local checkout)');
        else if (r.status === 'unresolvable') add('warn', name, at, 'no local checkout of this repo was found by origin URL, so it could not be checked');
      }
      const fr = await recipeFreshness(md, { resolver, now });
      if (fr.freshness !== 'fresh' && !refError) add('warn', name, `${base}/SKILL.md [metadata]`, `${fr.freshness}: ${fr.stale_reasons.join(', ')}`);
    }
  }
  return { recipes: dirs.length, findings };
}
