#!/usr/bin/env node
// The privacy gate: run it before any skill is published (a push, a copy into another repo). Read-only.
//   node tools/bin/gate.mjs [skill folder | library folder] [--deny-file <file>] [--no-deny-list]
// Refuses a skill with a secret, an email, a phone number, a .env file, a local path, a repository URL, a commit-like hash, or a name from the deny list. The deny list is a local
// file that is never committed (default .homebrew-deny.local.txt in the library root, or $HOMEBREW_DENY). Findings never print the matched
// text or the deny term. Exit 0 = clean, 1 = refused (or no deny list), 2 = usage error.
import fs from 'node:fs';
import path from 'node:path';
import { gateTarget, readDenyList } from '../src/privacy-gate.mjs';

const USAGE = `Usage: node tools/bin/gate.mjs [skill folder | library folder] [--deny-file <file>] [--no-deny-list]

  --deny-file     The local deny list (one private name per line, # comments). Default: $HOMEBREW_DENY, else
                  $LIBRARY/.homebrew-deny.local.txt (gitignored). Never commit it.
  --no-deny-list  Run without a deny list. Names are then NOT checked, and the gate says so; do not publish on this result.
`;

const argv = process.argv.slice(2);
const LIB = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
let target = LIB;
let targetGiven = false;
let denyFile = process.env.HOMEBREW_DENY || path.join(LIB, '.homebrew-deny.local.txt');
let noDeny = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--deny-file') denyFile = path.resolve(argv[++i] ?? '');
  else if (a.startsWith('--deny-file=')) denyFile = path.resolve(a.slice(12));
  else if (a === '--no-deny-list') noDeny = true;
  else if (a === '--help' || a === '-h') { process.stdout.write(USAGE); process.exit(0); } else if (!a.startsWith('-') && !targetGiven) { target = path.resolve(a); targetGiven = true; }
  else { process.stderr.write(`Unknown argument ${a}\n${USAGE}`); process.exit(2); }
}
if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
  process.stderr.write(`${target} is not a directory\n${USAGE}`);
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
for (const r of res.results) for (const f of r.findings) process.stdout.write(`refused ${r.skill}: ${f.file}${f.line ? `:${f.line}` : ''} ${f.kind} (${f.detail}); the matched text is not shown\n`);
const bad = res.results.filter((r) => r.findings.length).length;
process.stdout.write(`${res.skills} skill${res.skills === 1 ? '' : 's'} gated: ${res.skills - bad} clean, ${bad} refused${deny.length ? `, ${deny.length} deny-list entries used` : ''}\n`);
if (note) process.stdout.write(`${note}\n`);
process.exit(res.ok ? 0 : 1);
