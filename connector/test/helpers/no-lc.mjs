// The pattern of track AM-10133 (see no-lc-text.test.mjs): a line fails when it names an `lc` command or a daemon script.
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from '../../../scripts/build-plugin.mjs';

// The subcommands of the old command line, read from its own dispatch table so a new one cannot slip by, plus the names the track lists.
const LC_SRC = fs.readFileSync(path.join(REPO, 'bin/lc.mjs'), 'utf8');
export const SUBCOMMANDS = new Set([
  ...[...LC_SRC.matchAll(/command === '([a-z][a-z-]*)'/g)].map((m) => m[1]),
  ...'board new move delete status workflow update-track report-bug feature-request track-dir worktrees deploy setup setup-deploy brainstorm init-summary summary worker start stop restart state ui api logs config add-target list-targets remove-target remote-sync pulse comment show rerun quality-gate plan implement review merge'.split(' '),
]);
const SUB_RE = new RegExp(`(^|[^\\w./-])lc (?!-)(${[...SUBCOMMANDS].sort((a, b) => b.length - a.length).join('|')})\\b`);
const OTHER = [
  /which lc\b/, /command -v lc\b/, /make install/, /laneconductorrc/, /\b(un)?lock\.mjs\b/, /measure\.mjs/, /init-tracks-summary\.mjs/, /track-dir/, /worktrees (merge|create-pr)/,
];
const BARE_LC = /`lc`/;
const BARE_ALLOWED = /server key|MCP key|plugin:laneconductor/;

/** The hits of one text: `line number: text` for every line that names an `lc` command or a daemon script. */
export function noLcHits(text) {
  const hits = [];
  text.split('\n').forEach((line, i) => {
    const bad = SUB_RE.test(line) || OTHER.some((re) => re.test(line)) || (BARE_LC.test(line) && !BARE_ALLOWED.test(line));
    if (bad) hits.push(`${i + 1}: ${line.trim().slice(0, 120)}`);
  });
  return hits;
}

