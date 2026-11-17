// The privacy gate (track AM-10117, Phase 2 Task 4): a recipe may be SHIPPED inside the public plugin only when this passes.
// It refuses a recipe that holds a secret, an email address, a phone number, a .env file, or a name from the deny list.
//
// The deny list is a LOCAL, NEVER-COMMITTED text file (default conductor/recipe-deny.local.txt, which .gitignore covers; override
// with --deny-file or LC_RECIPE_DENY). One term per line, `#` comments, matched case-insensitively as a substring of every line of
// every text file and of every file path in the recipe. Private project ids, site names and private repo names go there; they
// must never be written into a committed file, a test, a log or a report. So findings carry the file, the line and WHICH deny
// entry (its line number in the deny file), never the matched text or the term itself.
//
// The gate checks (a) and (b) of the publication rule. (c), the human's approval of that recipe for publication, is recorded in
// the track and cannot be checked by a script.
import fs from 'node:fs/promises';
import path from 'node:path';
import { scanText as scanSecrets } from './secrets.mjs';
import { scanText as scanPrivacy } from '../scan.mjs';

/** @returns {{ term: string, line: number }[]} terms lower-cased; blank lines and `#` comments are skipped */
export function parseDenyList(text) {
  const out = [];
  String(text).split(/\r?\n/).forEach((raw, i) => {
    const t = raw.trim();
    if (t && !t.startsWith('#')) out.push({ term: t.toLowerCase(), line: i + 1 });
  });
  return out;
}

/** Reads the deny file. Missing file: `{ terms: null, missing: true }` (the caller decides whether that is fatal). */
export async function readDenyList(file) {
  try {
    return { terms: parseDenyList(await fs.readFile(file, 'utf8')), missing: false };
  } catch (e) {
    if (e.code === 'ENOENT') return { terms: null, missing: true };
    throw e;
  }
}

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

/** Gate one recipe folder (SKILL.md plus files/). `deny` is the parsed list ([] when the caller chose to run without one). */
export async function gateRecipeDir(recipeDir, deny = []) {
  const findings = [];
  const add = (file, line, kind, detail) => findings.push({ file, line, kind, detail });
  const hit = (s) => deny.find((d) => s.toLowerCase().includes(d.term));
  for (const rel of await walk(recipeDir)) {
    const d = hit(rel);
    if (d) add(rel, 0, 'denied_name', `file path contains deny-list entry on line ${d.line}`);
    if (isEnvFile(path.basename(rel))) add(rel, 0, 'env_file', 'a .env file does not belong in a recipe');
    const buf = await fs.readFile(path.join(recipeDir, rel));
    if (buf.includes(0)) continue; // binary: not scanned (and not expected in a recipe)
    const text = buf.toString('utf8');
    const seen = new Set();
    // one finding per line and kind, whichever scanner saw it first
    const once = (line, kind, detail) => { const k = `${line}|${kind}`; if (!seen.has(k)) { seen.add(k); add(rel, line, kind, detail); } };
    for (const s of scanSecrets(text, rel)) once(s.line, 'secret', s.pattern);
    for (const s of scanPrivacy(text)) once(s.line, /email/.test(s.pattern) ? 'email' : /phone/.test(s.pattern) ? 'phone' : 'secret', s.pattern);
    if (deny.length) {
      text.split(/\r?\n/).forEach((line, i) => {
        const d2 = hit(line);
        if (d2) once(i + 1, 'denied_name', `contains deny-list entry on line ${d2.line}`);
      });
    }
  }
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.kind.localeCompare(b.kind));
  return findings;
}

/**
 * Gates a recipe folder (has SKILL.md) or a library folder (has recipes/<name>/).
 * @returns {Promise<{ ok: boolean, recipes: number, results: { recipe: string, findings: object[] }[] }>}
 */
export async function gateTarget(target, deny = []) {
  // A library folder has recipes/; the shipped library is the skill folder itself, which also has a SKILL.md, so recipes/ decides first.
  const isLibrary = await fs.stat(path.join(target, 'recipes')).then((s) => s.isDirectory(), () => false);
  const isRecipe = !isLibrary && await fs.stat(path.join(target, 'SKILL.md')).then((s) => s.isFile(), () => false);
  let dirs;
  if (isRecipe) dirs = [{ name: path.basename(target), dir: target }];
  else {
    const root = path.join(target, 'recipes');
    const names = (await fs.readdir(root, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    dirs = names.map((name) => ({ name, dir: path.join(root, name) }));
  }
  const results = [];
  for (const { name, dir } of dirs) {
    const findings = await gateRecipeDir(dir, deny);
    const d = deny.find((x) => name.toLowerCase().includes(x.term));
    if (d) findings.unshift({ file: name, line: 0, kind: 'denied_name', detail: `recipe name contains deny-list entry on line ${d.line}` });
    results.push({ recipe: name, findings });
  }
  return { ok: results.every((r) => r.findings.length === 0), recipes: results.length, results };
}
