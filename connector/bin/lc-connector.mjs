#!/usr/bin/env node
// LaneConductor connector, stdio transport (track AM-10106, Phase 3).
//   lc-connector.mjs --repo <path> [--repo <path2>] [--state-branch <branch>]
// stdout carries MCP messages only (F3); every log line goes to stderr.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createConnectorServer } from '../src/server.mjs';
import { readPushPolicy } from '../src/push-policy.mjs';
import { resolveStateBranch } from '../src/state-branch.mjs';
import { LocalGitStore } from '../src/store-local.mjs';

// package.json sits beside bin/ in the repo (connector/) and one level up in the generated plugin
// (plugins/laneconductor/server/bin -> plugin root), so look in both.
const here = path.dirname(fileURLToPath(import.meta.url));
const pkgPath = ['..', path.join('..', '..')].map((d) => path.join(here, d, 'package.json')).find((p) => fs.existsSync(p));
const pkg = pkgPath ? JSON.parse(fs.readFileSync(pkgPath, 'utf8')) : { version: 'unknown' };
const err = (m) => process.stderr.write(`[lc-connector] ${m}\n`);

function parseArgs(argv) {
  const out = { repos: [], stateBranch: null, help: false, version: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    if (a === '--repo') out.repos.push(val());
    else if (a.startsWith('--repo=')) out.repos.push(a.slice(7));
    else if (a === '--state-branch') out.stateBranch = val();
    else if (a.startsWith('--state-branch=')) out.stateBranch = a.slice(15);
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--version' || a === '-v') out.version = true;
    else throw new Error(`Unknown argument ${a}`);
  }
  return out;
}

const USAGE = `Usage: lc-connector.mjs --repo <path> [--repo <path>...] [--state-branch <branch>]

  --repo <path>          Git checkout holding conductor/tracks/ (repeatable; the first is the default). Default: current directory.
  --state-branch <name>  Branch that holds track state, for every --repo. Without it each repo resolves its own, first match wins:
                         connector.state_branch in its .laneconductor.json; its default branch (refs/remotes/origin/HEAD);
                         the current branch if it is main or master; else main. Writes are refused on any other branch.
`;

let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (e) {
  err(e.message);
  process.stderr.write(USAGE);
  process.exit(2);
}
if (args.help) {
  process.stderr.write(USAGE);
  process.exit(0);
}
if (args.version) {
  process.stderr.write(`${pkg.version}\n`);
  process.exit(0);
}

const repos = (args.repos.length ? args.repos : [process.cwd()]).map((r) => path.resolve(r));
for (const r of repos) {
  if (!fs.existsSync(r) || !fs.statSync(r).isDirectory()) {
    err(`--repo ${r} is not a directory`);
    process.exit(2);
  }
}
let badConfig = false;
const stores = repos.map((repo) => {
  const { policy, problem } = readPushPolicy(repo);
  if (problem) err(`${repo}: ${problem}`);
  const sb = resolveStateBranch(repo, { cliBranch: args.stateBranch });
  if (sb.problem) {
    err(`${repo}: ${sb.problem}`);
    badConfig = true;
  } else {
    err(`${repo}: state branch ${sb.branch} (chosen by ${sb.source})`);
  }
  return new LocalGitStore({ repo, stateBranch: sb.branch, stateBranchSource: sb.source, pushPolicy: policy });
});
if (badConfig) process.exit(2);
err(`v${pkg.version} serving ${repos.join(', ')} (state branch ${stores.map((s) => s.stateBranch).join(', ')}; push policy ${stores.map((s) => s.pushPolicy).join(', ')})`);

const handle = serveStdio(() => createConnectorServer({ stores, version: pkg.version }), { onerror: (e) => err(String(e?.stack ?? e)) });
const shutdown = () => {
  Promise.resolve(handle?.close?.()).finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.stdin.on('end', shutdown);
