#!/usr/bin/env node
// The explain script (track AM-10155): where a track's time and tokens went, like an SQL EXPLAIN for agent work.
//   lc-explain.mjs --repo <path> --track <number> [--projects-dir <dir>] [--now <iso>] [--no-write]
//   lc-explain.mjs --repo <path> --statistics [--now <iso>]
// Prints the statistics as Markdown and writes it as conductor/tracks/<folder>/explain.md (overwritten on every run, never edited by
// hand), then regenerates the project file conductor/statistics.md from every track's explain.md (finished tracks included). The board
// shows the first as the "Agent run" tab of a track and the second as the "Statistics" tab of the Project drawer.
// Reads: the Claude session transcripts under --projects-dir (default $CLAUDE_CONFIG_DIR/projects, else ~/.claude/projects) and git
// history; writes nothing else. From the transcripts it keeps NUMBERS ONLY (timestamps, token counts, tool names): no prompt, message,
// tool input or output, file content or path ever reaches its output (see src/explain-transcripts.mjs).
// --no-write prints only. --statistics skips the transcripts and rebuilds conductor/statistics.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyzeTrack, renderExplain, renderStatistics, readExplains } from '../src/explain.mjs';

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const die = (msg) => { process.stderr.write(`explain: ${msg}\n`); process.exit(2); };
for (const f of ['--repo', '--track', '--projects-dir', '--now']) if (argv.includes(f) && !opt(f)) die(`${f} needs a value`);

const repo = path.resolve(opt('--repo') ?? process.cwd());
const now = opt('--now') ?? new Date().toISOString();
if (Number.isNaN(Date.parse(now))) die(`--now is not a date: ${now}`);
const write = !argv.includes('--no-write');
const projectsDir = path.resolve(opt('--projects-dir') ?? path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects'));

const writeStatistics = () => {
  const text = renderStatistics(readExplains(repo), { now: new Date(Date.parse(now)).toISOString() });
  if (write) {
    fs.mkdirSync(path.join(repo, 'conductor'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'conductor/statistics.md'), `${text}\n`, 'utf8');
    process.stderr.write('explain: wrote conductor/statistics.md\n');
  }
  return text;
};

if (argv.includes('--statistics')) {
  process.stdout.write(`${writeStatistics()}\n`);
} else {
  const track = opt('--track');
  if (!track) die('--track <number> is required (or --statistics)');
  if (!fs.existsSync(path.join(repo, 'conductor/tracks'))) die(`${repo} has no conductor/tracks folder`);
  let result;
  try { result = await analyzeTrack({ repo, track, projectsDir, now }); } catch (e) { die(String(e?.message ?? e).split('\n')[0]); }
  const text = renderExplain(result, { now: result.generatedAt });
  if (write) {
    fs.writeFileSync(path.join(repo, 'conductor/tracks', result.track.folder, 'explain.md'), `${text}\n`, 'utf8');
    process.stderr.write(`explain: wrote conductor/tracks/${result.track.folder}/explain.md\n`);
    writeStatistics();
  }
  process.stdout.write(`${text}\n`);
}
