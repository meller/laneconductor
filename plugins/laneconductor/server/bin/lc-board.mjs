#!/usr/bin/env node
// `lc board`: prints the board data (plan Phase 5d) for one project as JSON.
//   lc-board.mjs [--repo <path>] [--out <file>] [--pretty] [--now <iso>] [--check <file>] [--site <dir>]
// Default: JSON on STDOUT and nothing is written into the repo (a board is a snapshot, not a
// committed file). --out writes the file. --check <file> exits 1 when the file's data differs from
// a fresh build (generated_at is ignored). Reads only conductor/workflow.json, .laneconductor.json
// (project.name) and each track's index.md.
// --site <dir> writes the two files a board artifact is published from: board.html (the static page,
// byte-identical every run, no data in it) and board.json (the page's data). It prints the two
// absolute paths, one per line, and nothing else; <dir> may not be inside the repo's conductor/ folder.
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildBoard, boardPageData, BOARD_PAGE_PATH, DEFAULT_LANES, sameBoard } from '../src/board.mjs';
import { blobSha } from '../src/blob.mjs';

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const die = (msg) => { process.stderr.write(`lc board: ${msg}\n`); process.exit(2); };
for (const n of ['--repo', '--out', '--now', '--check', '--site']) if (argv.includes(n) && !opt(n)) die(`${n} needs a value`);

const repo = path.resolve(opt('--repo') ?? process.cwd());
const now = opt('--now') ?? new Date().toISOString();
if (Number.isNaN(Date.parse(now))) die(`--now is not a date: ${now}`);

const readText = (p) => fs.readFile(p, 'utf8').catch(() => null);
const readJson = async (p) => { try { return JSON.parse(await readText(p)); } catch { return null; } };

const wf = await readJson(path.join(repo, 'conductor/workflow.json'));
const lanes = Object.keys(wf?.lanes ?? {});
const cfg = await readJson(path.join(repo, '.laneconductor.json'));
const project = typeof cfg?.project?.name === 'string' && cfg.project.name.trim() ? cfg.project.name.trim() : path.basename(repo);

const tracksDir = path.join(repo, 'conductor/tracks');
const dirs = (await fs.readdir(tracksDir, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory());
const entries = await Promise.all(dirs.map(async (d) => {
  const content = await readText(path.join(tracksDir, d.name, 'index.md'));
  return { folder: d.name, index: content === null ? null : { content, sha: blobSha(content) } };
}));

const board = buildBoard(entries, { lanes: lanes.length ? lanes : DEFAULT_LANES, generatedAt: now, project });

const checkFile = opt('--check');
const siteDir = opt('--site');
if (siteDir) {
  const dir = path.resolve(siteDir);
  const rel = path.relative(path.join(repo, 'conductor'), dir);
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) die(`--site ${siteDir} is inside conductor/; use a folder outside the repo (a temp dir)`);
  await fs.mkdir(dir, { recursive: true });
  const page = path.join(dir, 'board.html');
  const data = path.join(dir, 'board.json');
  await fs.copyFile(BOARD_PAGE_PATH, page);
  await fs.writeFile(data, `${JSON.stringify(boardPageData(board))}\n`, 'utf8');
  process.stdout.write(`${page}\n${data}\n`);
} else if (checkFile) {
  const text = await readText(path.resolve(checkFile));
  let have = null;
  try { have = JSON.parse(text); } catch { /* missing or invalid */ }
  if (have && sameBoard(have, board)) console.log(`${checkFile} is up to date.`);
  else { console.log(`${checkFile} is missing or out of date. Run: lc board --out ${checkFile}`); process.exitCode = 1; }
} else {
  const json = `${JSON.stringify(board, null, argv.includes('--pretty') ? 2 : 0)}\n`;
  const out = opt('--out');
  if (out) { await fs.writeFile(path.resolve(out), json, 'utf8'); console.log(`Wrote ${out}.`); } else process.stdout.write(json);
}
