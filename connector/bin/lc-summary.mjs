#!/usr/bin/env node
// `lc summary`: regenerates conductor/tracks-summary.md from the track folders (plan Phase 3b).
//   lc-summary.mjs [--repo <path>] [--check]
// Writes the file but does not commit it (like the other `lc` commands that edit track files).
// With --check it writes nothing and exits 1 when the committed file is missing or out of date.
import fs from 'node:fs/promises';
import path from 'node:path';
import { LocalGitStore } from '../src/store-local.mjs';
import { summaryChange } from '../src/tools/common.mjs';

const argv = process.argv.slice(2);
const check = argv.includes('--check');
const i = argv.indexOf('--repo');
const repo = path.resolve(i >= 0 && argv[i + 1] ? argv[i + 1] : process.cwd());

const store = new LocalGitStore({ repo });
const change = await store.transaction((tx) => summaryChange(tx, Date.now(), new Map()));
if (!change) {
  console.log('conductor/tracks-summary.md is up to date.');
} else if (check) {
  console.log('conductor/tracks-summary.md is missing or out of date. Run: lc summary');
  process.exitCode = 1;
} else {
  const abs = path.join(repo, change.path);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.lc-tmp-${process.pid}`;
  await fs.writeFile(tmp, change.content, 'utf8');
  await fs.rename(tmp, abs);
  console.log(`Wrote ${change.path}.`);
}
