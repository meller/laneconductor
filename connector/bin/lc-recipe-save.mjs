#!/usr/bin/env node
// Saves a drafted recipe to the person's OWN library as a local commit, or retires one (track AM-10117, Phase 3). Never pushes.
//   lc-recipe-save.mjs --lib <library repo> --draft <recipe folder> [--approved] [--ref-root <dir>]...
//   lc-recipe-save.mjs --lib <library repo> --retire <name> [--approved]
// Without --approved it only runs the checker and prints its result ("needs approval"); nothing is written. Pass --approved only
// after the person said yes to saving THIS recipe. Exit 0 = saved (or, without --approved, a clean check awaiting approval),
// 1 = the checker found errors or the save failed, 2 = usage.
import fs from 'node:fs';
import path from 'node:path';
import { createRefResolver, defaultRoots } from '../src/recipes/references.mjs';
import { retireRecipe, saveRecipe } from '../src/recipes/save.mjs';

const USAGE = `Usage: lc-recipe-save.mjs --lib <library repo> --draft <recipe folder> [--approved] [--ref-root <dir>]...
       lc-recipe-save.mjs --lib <library repo> --retire <name> [--approved]
`;

const argv = process.argv.slice(2);
const o = { lib: null, draft: null, retire: null, approved: false, roots: [] };
try {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
    if (a === '--lib') o.lib = path.resolve(val());
    else if (a === '--draft') o.draft = path.resolve(val());
    else if (a === '--retire') o.retire = val();
    else if (a === '--approved') o.approved = true;
    else if (a === '--ref-root') o.roots.push(path.resolve(val()));
    else if (a === '--help' || a === '-h') { process.stdout.write(USAGE); process.exit(0); } else throw new Error(`Unknown argument ${a}`);
  }
  if (!o.lib || !fs.existsSync(o.lib) || !!o.draft === !!o.retire) throw new Error('give --lib (an existing folder) and exactly one of --draft and --retire');
} catch (e) {
  process.stderr.write(`${e.message}\n${USAGE}`);
  process.exit(2);
}
try {
  if (o.retire) {
    const r = await retireRecipe({ libDir: o.lib, name: o.retire, approved: o.approved });
    process.stdout.write(r.retired ? `retired ${o.retire}: local commit ${r.commit} (not pushed)\n` : `not retired: needs approval. Ask the person, then run again with --approved.\n`);
    process.exit(0);
  }
  const r = await saveRecipe({ libDir: o.lib, draftDir: o.draft, approved: o.approved, resolver: createRefResolver({ roots: o.roots.length ? o.roots : defaultRoots() }) });
  for (const f of r.check.findings) process.stdout.write(`${f.severity} ${f.where}: ${f.message}\n`);
  process.stdout.write(`checker: ${r.check.errors} error${r.check.errors === 1 ? '' : 's'}, ${r.check.warnings} warning${r.check.warnings === 1 ? '' : 's'}\n`);
  if (r.saved) process.stdout.write(`saved (${r.action}) ${r.check.name}: local commit ${r.commit} in ${o.lib} (not pushed)\n`);
  else if (r.reason === 'needs_approval') process.stdout.write('not saved: needs approval. Show the person this result, ask, then run again with --approved.\n');
  else process.stdout.write('not saved: fix the errors above first.\n');
  process.exit(r.reason === 'checker_errors' ? 1 : 0);
} catch (e) {
  process.stderr.write(`${e.message}\n`);
  process.exit(1);
}
