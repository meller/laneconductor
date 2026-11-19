#!/usr/bin/env node
// Checks the skills: format, secrets, references. Read-only.
//   node tools/bin/check.mjs <library dir> [--ref-root <dir>]...
// One line per finding; exit 1 when any is an error, 0 when clean. Read-only: it never fetches or writes.
import fs from 'node:fs';
import path from 'node:path';
import { checkLibraryDir } from '../src/check-library.mjs';
import { createRefResolver, defaultRoots } from '../src/references.mjs';

const USAGE = `Usage: node tools/bin/check.mjs [library dir] [--ref-root <dir>]...

  library dir        The repository root (default: the folder above tools/).

  --ref-root <dir>   Optional. Folder whose subfolders are checkouts of repos that a skill cites in metadata.reference (repeatable;
                     no default; the public skills cite none). The checkout is found by its origin URL, never by folder name.
`;

const argv = process.argv.slice(2);
const roots = [];
let lib = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
let libGiven = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--ref-root') roots.push(path.resolve(argv[++i] ?? ''));
  else if (a.startsWith('--ref-root=')) roots.push(path.resolve(a.slice(11)));
  else if (a === '--help' || a === '-h') {
    process.stdout.write(USAGE);
    process.exit(0);
  } else if (!a.startsWith('-') && !libGiven) { lib = path.resolve(a); libGiven = true; }
  else {
    process.stderr.write(`Unknown argument ${a}\n${USAGE}`);
    process.exit(2);
  }
}
if (!fs.existsSync(lib) || !fs.statSync(lib).isDirectory()) {
  process.stderr.write(`${lib} is not a directory\n${USAGE}`);
  process.exit(2);
}

const { skills, findings } = await checkLibraryDir(lib, { resolver: createRefResolver({ roots: roots.length ? roots : defaultRoots() }) });
for (const f of findings) process.stdout.write(`${f.severity} ${f.where}: ${f.message}\n`);
const errors = findings.filter((f) => f.severity === 'error').length;
const warns = findings.length - errors;
process.stdout.write(`${skills} skill${skills === 1 ? '' : 's'} checked: ${errors} error${errors === 1 ? '' : 's'}, ${warns} warning${warns === 1 ? '' : 's'}\n`);
process.exit(errors ? 1 : 0);
