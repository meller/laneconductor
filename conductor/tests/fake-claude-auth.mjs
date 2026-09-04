#!/usr/bin/env node
// conductor/tests/fake-claude-auth.mjs
// Substitute `claude` binary for track-10062-auth-required.test.mjs.
//
// checkClaudeCapacity() (laneconductor.sync.mjs) always spawns the literal
// `claude` binary for its `-p test` probe, even under LC_MOCK_CLI (which
// only substitutes the REAL dispatch's CLI, resolved separately in
// buildCliArgs) — see fake-claude-recorder.mjs's header comment for the
// same reasoning. This binary sits on PATH as `claude` so both call shapes
// reach it for real:
//
//   1. The probe: `claude -p test` — behaviour controlled by a small JSON
//      control file (FAKE_CLAUDE_CONTROL_FILE), so a single running
//      worker process can be driven through different probe outcomes
//      (auth failure → recovery, or a genuine rate limit) across the
//      test's real 60s throttle window without restarting it.
//   2. A real dispatch/lane action (`--output-format` present in argv,
//      same marker fake-claude-recorder.mjs uses) — always exits 0
//      immediately; this test only cares whether a dispatch was ATTEMPTED
//      at all (recorded via FAKE_CLAUDE_DISPATCH_LOG), not what it does.
//
// Every invocation (probe or dispatch) appends one JSON line to
// FAKE_CLAUDE_PROBE_LOG if set, so a test can count real spawns — the
// signal that proves capacity-probe-throttle.mjs is actually suppressing
// redundant probes within the TTL window, not just that the classified
// result looks right.

import { readFileSync, existsSync, appendFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const isDispatch = argv.includes('--output-format');

if (process.env.FAKE_CLAUDE_PROBE_LOG) {
  appendFileSync(process.env.FAKE_CLAUDE_PROBE_LOG, JSON.stringify({ isDispatch, at: Date.now(), argv }) + '\n');
}

if (isDispatch) {
  console.log('fake claude dispatch complete');
  process.exit(0);
}

function readControl() {
  const path = process.env.FAKE_CLAUDE_CONTROL_FILE;
  if (!path || !existsSync(path)) return { exitCode: 0, output: 'ok' };
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { return { exitCode: 0, output: 'ok' }; }
}

const { exitCode, output } = readControl();
if (output) process.stdout.write(output);
process.exit(exitCode);
