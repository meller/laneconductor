#!/usr/bin/env node
// Checks a recipe library: format, secrets, references (track AM-10107, Phase 2).
//   lc-recipe-check.mjs <library dir> [--ref-root <dir>]...
// One line per finding; exit 1 when any is an error. Read-only: it never fetches or writes.
import fs from 'node:fs';
import path from 'node:path';
import { checkLibraryDir } from '../src/recipes/check-library.mjs';
import { createRefResolver, defaultRoots } from '../src/recipes/references.mjs';

const USAGE = `Usage: lc-recipe-check.mjs <library dir> [--ref-root <dir>]...

  --ref-root <dir>   Folder whose subfolders are checkouts of the repos recipes cite (repeatable; default ~/Code).
`;

const argv = process.argv.slice(2);
const roots = [];
let lib = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--ref-root') roots.push(path.resolve(argv[++i] ?? ''));
  else if (a.startsWith('--ref-root=')) roots.push(path.resolve(a.slice(11)));
  else if (a === '--help' || a === '-h') {
    process.stdout.write(USAGE);
    process.exit(0);
  } else if (!a.startsWith('-') && lib === null) lib = path.resolve(a);
  else {
    process.stderr.write(`Unknown argument ${a}\n${USAGE}`);
    process.exit(2);
  }
}
if (!lib || !fs.existsSync(lib) || !fs.statSync(lib).isDirectory()) {
  process.stderr.write(`${lib ? `${lib} is not a directory` : 'Missing library directory'}\n${USAGE}`);
  process.exit(2);
}

const { recipes, findings } = await checkLibraryDir(lib, { resolver: createRefResolver({ roots: roots.length ? roots : defaultRoots() }) });
for (const f of findings) process.stdout.write(`${f.severity} ${f.where}: ${f.message}\n`);
const errors = findings.filter((f) => f.severity === 'error').length;
const warns = findings.length - errors;
process.stdout.write(`${recipes} recipe${recipes === 1 ? '' : 's'} checked: ${errors} error${errors === 1 ? '' : 's'}, ${warns} warning${warns === 1 ? '' : 's'}\n`);
process.exit(errors ? 1 : 0);
