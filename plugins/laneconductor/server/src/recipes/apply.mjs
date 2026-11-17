// Applying recipes (track AM-10117, Phase 3 Task 1, REQ-5): the deterministic part. A recipe's `files/` folder mirrors the paths
// it writes into the project; a file ending in `.tmpl` is rendered (the suffix is dropped and `{{var}}` is filled from the
// interview answers), every other file is copied as it is. Claude does the judgement (the recipe's "Claude does" section); this
// plans and writes the files so that three things hold: a missing variable is an error and never an empty string, two recipes that
// write the same path are a CONFLICT that is reported and never merged, and an existing file is never overwritten.
// The recipe's "You run" steps (sign-in, secrets, deploy) are never done here.
import fs from 'node:fs/promises';
import path from 'node:path';

const VAR_RE = /\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g;

async function walk(dir, rel = '') {
  const out = [];
  for (const e of await fs.readdir(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await walk(dir, r)));
    else if (e.isFile()) out.push(r);
  }
  return out;
}

/** `{{var}}` placeholders of a text, in order of first appearance. */
export const varsIn = (text) => [...new Set([...text.matchAll(VAR_RE)].map((m) => m[1]))];

/** Fills `{{var}}`; `missing` lists the names that had no value (those placeholders are left in place). */
export function render(text, vars) {
  const missing = [];
  const out = text.replace(VAR_RE, (whole, k) => {
    if (Object.hasOwn(vars, k) && String(vars[k]) !== '') return String(vars[k]);
    if (!missing.includes(k)) missing.push(k);
    return whole;
  });
  return { text: out, missing };
}

const safeRel = (rel) => !path.isAbsolute(rel) && !rel.split('/').includes('..') && rel !== '';

/**
 * Plans the writes of one or more recipes into `targetDir`; writes nothing.
 * @param {{ name: string, dir: string }[]} recipes  `dir` is the recipe folder (holds SKILL.md and files/)
 * @param {Record<string, string>} vars
 * @returns {Promise<{ writes: object[], conflicts: object[], existing: string[], missing_vars: object[], errors: string[], ok: boolean }>}
 */
export async function planApply(recipes, vars, targetDir) {
  const byPath = new Map(); // target path -> [{ recipe, content, rendered }]
  const missing_vars = [];
  const errors = [];
  for (const r of recipes) {
    const filesDir = path.join(r.dir, 'files');
    const names = await walk(filesDir).catch(() => []);
    for (const rel of names) {
      const isTmpl = rel.endsWith('.tmpl');
      const dest = isTmpl ? rel.slice(0, -'.tmpl'.length) : rel;
      if (!safeRel(dest)) { errors.push(`${r.name}: file path ${JSON.stringify(rel)} leaves the project`); continue; }
      let content = await fs.readFile(path.join(filesDir, rel));
      if (isTmpl) {
        const res = render(content.toString('utf8'), vars);
        if (res.missing.length) missing_vars.push({ recipe: r.name, file: rel, vars: res.missing });
        content = Buffer.from(res.text);
      }
      if (!byPath.has(dest)) byPath.set(dest, []);
      byPath.get(dest).push({ recipe: r.name, content, rendered: isTmpl });
    }
  }
  const writes = [];
  const conflicts = [];
  const existing = [];
  for (const [dest, sources] of [...byPath].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (sources.length > 1) {
      conflicts.push({ path: dest, recipes: sources.map((s) => s.recipe), identical: sources.every((s) => s.content.equals(sources[0].content)) });
      continue; // a conflict is for the human to resolve; neither version is written
    }
    if (await fs.stat(path.join(targetDir, dest)).then(() => true, () => false)) { existing.push(dest); continue; }
    writes.push({ path: dest, recipe: sources[0].recipe, rendered: sources[0].rendered, content: sources[0].content });
  }
  return { writes, conflicts, existing, missing_vars, errors, ok: conflicts.length === 0 && missing_vars.length === 0 && errors.length === 0 };
}

/** Writes the planned files. Refuses when the plan is not ok (a conflict or a missing variable). Returns the paths written. */
export async function writePlan(plan, targetDir) {
  if (!plan.ok) throw new Error('the plan has conflicts, missing variables or unsafe paths; nothing was written');
  const written = [];
  for (const w of plan.writes) {
    const abs = path.join(targetDir, w.path);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, w.content, { flag: 'wx' }); // wx: never overwrite
    written.push(w.path);
  }
  return written;
}
