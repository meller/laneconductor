#!/usr/bin/env node
// The privacy gate for SHIPPING a recipe in the public plugin (track AM-10117, Phase 2). Read-only.
//   lc-recipe-gate.mjs <recipe folder | library folder> [--deny-file <file>] [--no-deny-list]
// Refuses a recipe with a secret, an email, a phone number, a .env file, or a name from the deny list. The deny list is a local
// file that is never committed (default conductor/recipe-deny.local.txt, or $LC_RECIPE_DENY). Findings never print the matched
// text or the deny term. Exit 0 = clean, 1 = refused (or no deny list), 2 = usage error.
import fs from 'node:fs';
import path from 'node:path';
import { gateTarget, readDenyList } from '../src/recipes/privacy-gate.mjs';

const USAGE = `Usage: lc-recipe-gate.mjs <recipe folder | library folder> [--deny-file <file>] [--no-deny-list]

  --deny-file     The local deny list (one private name per line, # comments). Default: $LC_RECIPE_DENY, else
                  conductor/recipe-deny.local.txt in the current directory. Never commit it.
  --no-deny-list  Run without a deny list. Names are then NOT checked, and the gate says so; do not publish on this result.
`;

const argv = process.argv.slice(2);
let target = null;
let denyFile = process.env.LC_RECIPE_DENY || path.join(process.cwd(), 'conductor/recipe-deny.local.txt');
let noDeny = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--deny-file') denyFile = path.resolve(argv[++i] ?? '');
  else if (a.startsWith('--deny-file=')) denyFile = path.resolve(a.slice(12));
  else if (a === '--no-deny-list') noDeny = true;
  else if (a === '--help' || a === '-h') { process.stdout.write(USAGE); process.exit(0); } else if (!a.startsWith('-') && target === null) target = path.resolve(a);
  else { process.stderr.write(`Unknown argument ${a}\n${USAGE}`); process.exit(2); }
}
if (!target || !fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
  process.stderr.write(`${target ? `${target} is not a directory` : 'Missing recipe or library folder'}\n${USAGE}`);
  process.exit(2);
}

let deny = [];
let note = null;
if (!noDeny) {
  const r = await readDenyList(denyFile);
  if (r.missing) {
    process.stdout.write(`refused: no deny list at ${denyFile}. The gate cannot vouch for private names without one: create it (one private project id, site or repo name per line, never committed) or pass --no-deny-list to skip the name check.\n`);
    process.exit(1);
  }
  deny = r.terms;
} else note = 'WARNING: no deny list was used, so private names were NOT checked.';

const res = await gateTarget(target, deny);
for (const r of res.results) for (const f of r.findings) process.stdout.write(`refused ${r.recipe}: ${f.file}${f.line ? `:${f.line}` : ''} ${f.kind} (${f.detail}); the matched text is not shown\n`);
const bad = res.results.filter((r) => r.findings.length).length;
process.stdout.write(`${res.recipes} recipe${res.recipes === 1 ? '' : 's'} gated: ${res.recipes - bad} clean, ${bad} refused${deny.length ? `, ${deny.length} deny-list entries used` : ''}\n`);
if (note) process.stdout.write(`${note}\n`);
process.exit(res.ok ? 0 : 1);
