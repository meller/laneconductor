#!/usr/bin/env node
// Scaffolds a new project from the answers of the guided interview (track AM-10117, Phase 1).
//   lc-scaffold.mjs --answers <answers.json> [--dir <project dir>] [--dry-run] [--no-git-init] [--no-first-track]
//   lc-scaffold.mjs --detect [--dir <project dir>]      read an EXISTING repository and print the proposed answers (writes nothing)
// Creates conductor/ (context files, workflow, quality gate, tracks/), .laneconductor.json, the .gitignore entries and the
// first tracks. Never overwrites an existing file, never commits, never pushes. Prints one JSON object: created, skipped, merged.
import fs from 'node:fs';
import path from 'node:path';
import { detectProject } from '../src/newproject/detect.mjs';
import { writeScaffold } from '../src/newproject/scaffold.mjs';

const USAGE = `Usage: lc-scaffold.mjs --answers <answers.json> [--dir <project dir>] [--dry-run] [--no-git-init] [--no-first-track]
       lc-scaffold.mjs --detect [--dir <project dir>]

  --answers <file>   The interview answers as JSON (see connector/src/newproject/scaffold.mjs, normalizeAnswers).
  --dir <dir>        The project folder (default: the current directory; created when missing).
  --dry-run          Write nothing; report what would be created.
  --no-git-init      Do not run git init in a folder that is not a repository.
  --no-first-track   Do not add the walking-skeleton track (for a project that already exists).
  --detect           Read the existing project in --dir (package.json, README, CI, lint config, older tracks) and print
                     { answers, evidence, existing } as JSON. Read only. Check it with the person, then pass "answers" back.
`;

const argv = process.argv.slice(2);
let answersFile = null;
let dir = process.cwd();
let dryRun = false;
let gitInit = true;
let firstTrack = true;
let detect = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--answers') answersFile = argv[++i];
  else if (a.startsWith('--answers=')) answersFile = a.slice(10);
  else if (a === '--dir') dir = argv[++i] ?? '';
  else if (a.startsWith('--dir=')) dir = a.slice(6);
  else if (a === '--dry-run') dryRun = true;
  else if (a === '--no-git-init') gitInit = false;
  else if (a === '--no-first-track') firstTrack = false;
  else if (a === '--detect') detect = true;
  else if (a === '--help' || a === '-h') { process.stdout.write(USAGE); process.exit(0); } else { process.stderr.write(`Unknown argument ${a}\n${USAGE}`); process.exit(2); }
}
if (detect) {
  if (!fs.existsSync(path.resolve(dir))) { process.stderr.write(`${dir} does not exist\n`); process.exit(1); }
  process.stdout.write(`${JSON.stringify(detectProject(dir), null, 2)}\n`);
  process.exit(0);
}
if (!answersFile || !dir) { process.stderr.write(`Missing --answers\n${USAGE}`); process.exit(2); }
try {
  const answers = JSON.parse(fs.readFileSync(path.resolve(answersFile), 'utf8'));
  process.stdout.write(`${JSON.stringify(writeScaffold(dir, answers, { dryRun, gitInit, firstTrack }), null, 2)}\n`);
} catch (e) {
  process.stderr.write(`${e.message}\n`);
  process.exit(1);
}
