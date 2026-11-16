#!/usr/bin/env node
// LaneConductor connector, stdio transport (track AM-10106, Phase 3).
//   lc-connector.mjs --repo <path> [--repo <path2>] [--state-branch main]
// stdout carries MCP messages only (F3); every log line goes to stderr.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createConnectorServer } from '../src/server.mjs';
import { readPushPolicy } from '../src/push-policy.mjs';
import { LocalGitStore } from '../src/store-local.mjs';

const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));
const err = (m) => process.stderr.write(`[lc-connector] ${m}\n`);

function parseArgs(argv) {
  const out = { repos: [], stateBranch: 'main', help: false, version: false };
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
  --state-branch <name>  Branch that holds track state (default: main). Writes are refused on any other branch.
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
const stores = repos.map((repo) => {
  const { policy, problem } = readPushPolicy(repo);
  if (problem) err(`${repo}: ${problem}`);
  return new LocalGitStore({ repo, stateBranch: args.stateBranch, pushPolicy: policy });
});
err(`v${pkg.version} serving ${repos.join(', ')} (state branch ${args.stateBranch}; push policy ${stores.map((s) => s.pushPolicy).join(', ')})`);

const handle = serveStdio(() => createConnectorServer({ stores, version: pkg.version }), { onerror: (e) => err(String(e?.stack ?? e)) });
const shutdown = () => {
  Promise.resolve(handle?.close?.()).finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.stdin.on('end', shutdown);
