#!/usr/bin/env node
// conductor/tests/mock-gh.mjs
// Mock `gh` (GitHub CLI) executable for the Track 10018 Phase 11 subprocess
// E2E test — pr-flow.mjs's only external dependency besides `git`, and the
// one thing that must never touch a real GitHub API from an automated test.
//
// Follows mock-cli.mjs's pattern (env-var-driven, zero deps), but needs to
// be MUTABLE mid-test (a real `gh pr view` poll result changes over a PR's
// lifetime — open, then merged — and this test drives that transition
// without restarting the worker process), so behaviour is scripted via a
// JSON FILE rather than a single fixed env var: the test can overwrite the
// file between poll cycles to flip what the next `gh pr view` call reports.
//
// Invoked as: gh <subcommand...> (resolved via PATH — see the test's setup,
// which symlinks a `gh` file to this one in a temp bin/ dir prepended to
// PATH before spawning the worker).
//
// Env vars:
//   MOCK_GH_SCRIPT_PATH=<path>   Required. JSON file mapping a stable
//                                 subcommand key (see matchKey below) to
//                                 { stdout, stderr, exitCode }. Missing
//                                 fields default to '' / '' / 0. Re-read on
//                                 every invocation — never cached — so the
//                                 test can rewrite it between calls.
//   MOCK_GH_ARGV_LOG=<path>      Optional. If set, appends one JSON line per
//                                 invocation ({ argv, at }) — lets a test
//                                 assert exactly what pr-flow.mjs called
//                                 `gh` with (e.g. the real --title/--body
//                                 passed to `gh pr create`), the same way
//                                 mock-cli.mjs's MOCK_CLI_ARGV_LOG does.

import { readFileSync, existsSync, appendFileSync } from 'node:fs';

const argv = process.argv.slice(2);

// Matches on the first two argv tokens only — stable regardless of which
// PR number or dynamic flag values (--title, --body, --json fields) follow.
// pollTrackPr always calls `gh pr view <n> --json ...`, so the numeric PR
// number never appears in the key.
function matchKey(argv) {
  if (argv[0] === 'auth' && argv[1] === 'status') return 'auth status';
  if (argv[0] === 'pr' && ['create', 'view', 'merge'].includes(argv[1])) return `pr ${argv[1]}`;
  return argv.slice(0, 2).join(' ');
}

if (process.env.MOCK_GH_ARGV_LOG) {
  appendFileSync(process.env.MOCK_GH_ARGV_LOG, JSON.stringify({ argv, at: Date.now() }) + '\n');
}

const key = matchKey(argv);
const scriptPath = process.env.MOCK_GH_SCRIPT_PATH;

let entry = null;
if (scriptPath && existsSync(scriptPath)) {
  try {
    entry = JSON.parse(readFileSync(scriptPath, 'utf8'))[key] ?? null;
  } catch (err) {
    console.error(`[mock-gh] failed to read/parse MOCK_GH_SCRIPT_PATH (${scriptPath}): ${err.message}`);
    process.exit(1);
  }
}

if (!entry) {
  console.error(`[mock-gh] no script entry for "${key}" (argv: ${JSON.stringify(argv)}, scriptPath: ${scriptPath || '(unset)'})`);
  process.exit(1);
}

if (entry.stdout) process.stdout.write(entry.stdout.endsWith('\n') ? entry.stdout : entry.stdout + '\n');
if (entry.stderr) process.stderr.write(entry.stderr.endsWith('\n') ? entry.stderr : entry.stderr + '\n');
process.exit(entry.exitCode ?? 0);
