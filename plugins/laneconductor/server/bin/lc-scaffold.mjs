#!/usr/bin/env node
// Scaffolds a new project from the answers of the guided interview (track AM-10117, Phase 1).
//   lc-scaffold.mjs --answers <answers.json> [--dir <project dir>] [--dry-run] [--no-git-init]
// Creates conductor/ (context files, workflow, quality gate, tracks/), .laneconductor.json, the .gitignore entries and the
// first tracks. Never overwrites an existing file, never commits, never pushes. Prints one JSON object: created, skipped, merged.
import fs from 'node:fs';
import path from 'node:path';
import { writeScaffold } from '../src/newproject/scaffold.mjs';

const USAGE = `Usage: lc-scaffold.mjs --answers <answers.json> [--dir <project dir>] [--dry-run] [--no-git-init]

  --answers <file>   The interview answers as JSON (see connector/src/newproject/scaffold.mjs, normalizeAnswers).
  --dir <dir>        The project folder (default: the current directory; created when missing).
  --dry-run          Write nothing; report what would be created.
  --no-git-init      Do not run git init in a folder that is not a repository.
`;

const argv = process.argv.slice(2);
let answersFile = null;
let dir = process.cwd();
let dryRun = false;
let gitInit = true;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--answers') answersFile = argv[++i];
  else if (a.startsWith('--answers=')) answersFile = a.slice(10);
  else if (a === '--dir') dir = argv[++i] ?? '';
  else if (a.startsWith('--dir=')) dir = a.slice(6);
  else if (a === '--dry-run') dryRun = true;
  else if (a === '--no-git-init') gitInit = false;
  else if (a === '--help' || a === '-h') { process.stdout.write(USAGE); process.exit(0); } else { process.stderr.write(`Unknown argument ${a}\n${USAGE}`); process.exit(2); }
}
if (!answersFile || !dir) { process.stderr.write(`Missing --answers\n${USAGE}`); process.exit(2); }
try {
  const answers = JSON.parse(fs.readFileSync(path.resolve(answersFile), 'utf8'));
  process.stdout.write(`${JSON.stringify(writeScaffold(dir, answers, { dryRun, gitInit }), null, 2)}\n`);
} catch (e) {
  process.stderr.write(`${e.message}\n`);
  process.exit(1);
}
