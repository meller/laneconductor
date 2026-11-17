#!/usr/bin/env node
// Plans, and with --write performs, the file part of applying recipes (track AM-10117, Phase 3). Never overwrites a file.
//   lc-recipe-apply.mjs --recipe <recipe folder>... --target <project dir> [--var k=v]... [--vars <file.json>] [--write]
// Without --write it only reports: what would be written, what exists already, which recipes collide on a path (a CONFLICT:
// neither version is written), and which {{variables}} still have no value. Exit 1 when the plan is not clean.
// It does the recipe's files only. The recipe's "You run" steps (sign-in, secrets, deploy) are the person's, never done here.
import fs from 'node:fs';
import path from 'node:path';
import { planApply, writePlan } from '../src/recipes/apply.mjs';

const USAGE = `Usage: lc-recipe-apply.mjs --recipe <recipe folder>... --target <project dir> [--var k=v]... [--vars <file.json>] [--write]
`;

const argv = process.argv.slice(2);
const recipes = [];
const vars = {};
let target = null;
let write = false;
try {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
    if (a === '--recipe') { const d = path.resolve(val()); recipes.push({ name: path.basename(d), dir: d }); } else if (a === '--target') target = path.resolve(val());
    else if (a === '--var') { const kv = val(); const j = kv.indexOf('='); if (j < 1) throw new Error(`--var needs k=v (got ${kv})`); vars[kv.slice(0, j)] = kv.slice(j + 1); } else if (a === '--vars') Object.assign(vars, JSON.parse(fs.readFileSync(path.resolve(val()), 'utf8')));
    else if (a === '--write') write = true;
    else if (a === '--help' || a === '-h') { process.stdout.write(USAGE); process.exit(0); } else throw new Error(`Unknown argument ${a}`);
  }
  if (!recipes.length || !target) throw new Error('--recipe and --target are required');
  for (const r of recipes) if (!fs.existsSync(path.join(r.dir, 'SKILL.md'))) throw new Error(`${r.dir} is not a recipe folder (no SKILL.md)`);
  const plan = await planApply(recipes, vars, target);
  const written = write && plan.ok ? await writePlan(plan, target) : [];
  const { writes, ...rest } = plan;
  process.stdout.write(`${JSON.stringify({ ...rest, would_write: writes.map((w) => ({ path: w.path, recipe: w.recipe, rendered: w.rendered })), written, wrote: write && plan.ok }, null, 2)}\n`);
  process.exit(plan.ok ? 0 : 1);
} catch (e) {
  process.stderr.write(`${e.message}\n${USAGE}`);
  process.exit(2);
}
