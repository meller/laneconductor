#!/usr/bin/env node
// conductor/tests/mock-cli.mjs
// Mock CLI used by the local-fs E2E test.
// Invoked as: node mock-cli.mjs [command] [trackNumber]
//
// Behaviour is controlled by env vars:
//   MOCK_CLI_EXIT_CODE=0                Exit code (default 0 = success)
//   MOCK_CLI_DELAY_MS=100                How long to sleep before exiting (default 100ms)
//   MOCK_CLI_RESUME_FAILURE_SENTINEL=<path>   Track 1086 Phase 4: if set and
//                               the file at <path> exists at the moment
//                               this process runs, print the real claude
//                               CLI's "session not found" error text and
//                               exit 1, regardless of MOCK_CLI_EXIT_CODE —
//                               simulates a --resume call whose session was
//                               pruned/corrupted. A *sentinel file* rather
//                               than a plain on/off env var because the env
//                               var is fixed for the worker process's whole
//                               lifetime, but a test needs the first
//                               dispatch to fail and a later one to
//                               succeed — the test creates/deletes the file
//                               between dispatches instead.
//   MOCK_CLI_PROGRESS_INTERVAL_MS=<n>   Track 1102 F11: if set, print a
//                               new output line every <n>ms throughout
//                               the full MOCK_CLI_DELAY_MS instead of
//                               going silent after the first line —
//                               simulates a genuinely-progressing run
//                               (log file still growing) so a test can
//                               tell a real hang apart from a run that's
//                               just taking a while but producing output
//                               the whole time.
//   MOCK_CLI_CLAIM_MARKER=<path>   Track 1110 Phase 1: if set, append
//                               "<pid>\n" to the file at <path> on every
//                               invocation. Lets a test with TWO worker
//                               processes sharing one project directory
//                               observe how many distinct pids spawned a
//                               CLI run — the signal a claim-race
//                               reproduction needs — without parsing
//                               interleaved stdout from two child
//                               processes, which is fragile. Deliberately
//                               NOT keyed by trackNumber: spawnCli's
//                               context-injection fallback overwrites the
//                               trailing argv slot (normally trackNumber)
//                               with the injected prompt text for any CLI
//                               whose last arg looks like a prompt —
//                               mock-cli.mjs included — so trackNumber
//                               cannot be trusted to survive in argv here.
//                               Fine for a single-track reproduction; a
//                               future multi-track version would need a
//                               different signal (e.g. reading it back
//                               out of the per-track log file spawnCli
//                               already writes).

import { existsSync, appendFileSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const [,, command, trackNumber] = process.argv;
const sentinelPath = process.env.MOCK_CLI_RESUME_FAILURE_SENTINEL;
const resumeFailure = !!sentinelPath && existsSync(sentinelPath);
const exitCode = resumeFailure ? 1 : parseInt(process.env.MOCK_CLI_EXIT_CODE ?? '0');
const delay = parseInt(process.env.MOCK_CLI_DELAY_MS ?? '100');

if (process.env.MOCK_CLI_CLAIM_MARKER) {
  appendFileSync(process.env.MOCK_CLI_CLAIM_MARKER, `${process.pid}\n`);
}

// Track 1113: one JSON line per invocation with the full argv, so a test can
// assert which session flag a chat turn was actually invoked with
// (--session-id on a fresh session vs --resume on a shared one). The
// CLAIM_MARKER above only records pids, which cannot answer that.
if (process.env.MOCK_CLI_ARGV_LOG) {
  appendFileSync(process.env.MOCK_CLI_ARGV_LOG,
    JSON.stringify({ pid: process.pid, argv: process.argv.slice(2), at: Date.now() }) + '\n');
}

if (resumeFailure) {
  console.log('No conversation found with session ID: (mock)');
} else {
  console.log(`[mock-cli] ${command} track=${trackNumber} → exit ${exitCode} after ${delay}ms`);
}

const progressIntervalMs = parseInt(process.env.MOCK_CLI_PROGRESS_INTERVAL_MS ?? '0');
let progressTimer = null;
if (progressIntervalMs > 0 && !resumeFailure) {
  progressTimer = setInterval(() => {
    console.log(`[mock-cli] ${command} track=${trackNumber} → still working at ${Date.now()}`);
  }, progressIntervalMs);
}

// Track 10020: MOCK_CLI_EMIT_BLOCKED_SUMMARY=<question text> — if set,
// print a real post_turn_summary JSONL line (status_category: 'blocked')
// right before exiting, so a test can drive spawnCli's exit handler through
// its actual isBlockedTurn path against a real spawned process, not just
// extractBlockedQuestion() in isolation.
const blockedSummary = process.env.MOCK_CLI_EMIT_BLOCKED_SUMMARY;

// Track 10035: MOCK_CLI_COMMIT_FILE=<filename> — if set, writes a small
// distinguishing file and commits it in cwd (the track's own worktree
// during a branch-mode lane action, e.g. quality-gate) before exiting.
// Lets a direct-mode merge E2E test prove AC-1 ("its commits are reachable
// from local main") against a branch that's actually ahead of main by a
// real commit, not just a no-op merge of two identical trees.
//
// Deliberately excluded for command === 'done': that run's cwd is the
// PRIMARY checkout itself (workspace:main), not the track's own worktree —
// committing there would land an unrelated change directly on main, not on
// the branch being merged, which then makes `lc worktrees merge` see a
// genuine (spurious) conflict between that stray commit and the real one
// on the track branch — confirmed live in this exact test file before this
// guard existed.
const commitFile = process.env.MOCK_CLI_COMMIT_FILE;
if (commitFile && command !== 'done') {
  try {
    writeFileSync(join(process.cwd(), commitFile), `written by mock-cli for ${command} track=${trackNumber}\n`);
    execFileSync('git', ['add', commitFile], { cwd: process.cwd() });
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', `mock-cli: ${command} wrote ${commitFile}`], { cwd: process.cwd() });
  } catch (e) {
    console.error(`[mock-cli] MOCK_CLI_COMMIT_FILE failed: ${e.message}`);
  }
}

// Track 10035: MOCK_CLI_WRITE_LANE_STATUS=<value> — if set, patch
// **Lane Status** in the track's own index.md to <value> right before
// exiting — simulates an agent's own self-transition write as its last
// action (e.g. the done-lane merge action writing "waiting" after opening
// a PR), so a test can drive the real exit handler's
// agent-self-reported-outcome detection against a genuinely spawned
// process instead of just unit-testing that logic in isolation.
//
// Deliberately does NOT resolve the track by matching `trackNumber` from
// argv against folder names: spawnCli's context-injection fallback
// overwrites the trailing argv slot (normally trackNumber) with the
// injected prompt text for any CLI whose last arg looks like a prompt —
// mock-cli.mjs included, see the MOCK_CLI_CLAIM_MARKER comment above — so
// `trackNumber` here is frequently the whole context+goal string, not a
// number, and a regex built from it never matches any folder. Instead,
// find the one track folder the caller already marked running (spawnCli
// writes **Lane Status**: running into it just before spawning) — exactly
// as unambiguous in these single-track-at-a-time tests, and immune to the
// same argv-clobbering.
function findRunningTrackDir() {
  const tracksDir = join(process.cwd(), 'conductor', 'tracks');
  const trackDir = readdirSync(tracksDir).find(d => {
    const p = join(tracksDir, d, 'index.md');
    return existsSync(p) && /\*\*Lane Status\*\*:\s*running/i.test(readFileSync(p, 'utf8'));
  });
  return trackDir ? { tracksDir, trackDir, indexPath: join(tracksDir, trackDir, 'index.md') } : null;
}

// Track 10035: MOCK_CLI_RUN_LC_CREATE_PR=1 — for a done-lane ('merge'
// action) invocation, actually shell out to `lc worktrees create-pr
// <track-number>` (the exact primitive SKILL.md's merge command documents
// running in pr-mode) before exiting, so a PR-mode E2E test exercises the
// real push + `gh pr create` + PR-marker-write code path
// (conductor/services/pr-flow.mjs + bin/lc.mjs) instead of only simulating
// its end state via MOCK_CLI_WRITE_LANE_STATUS below. Resolves the track
// number from the running track's own folder name (see
// MOCK_CLI_WRITE_LANE_STATUS's comment below for why argv can't be
// trusted), same as that flag does.
if (process.env.MOCK_CLI_RUN_LC_CREATE_PR && command === 'done') {
  const running = findRunningTrackDir();
  const numMatch = running?.trackDir.match(/(?:^|-)(\d+)-/);
  if (numMatch) {
    try {
      execFileSync('node', [join(__dirname, '..', '..', 'bin', 'lc.mjs'), 'worktrees', 'create-pr', numMatch[1]],
        { cwd: process.cwd(), stdio: 'inherit' });
    } catch (e) {
      console.error(`[mock-cli] lc worktrees create-pr ${numMatch[1]} failed: ${e.message}`);
    }
  }
}

// Track 10035: MOCK_CLI_RUN_LC_MERGE=1 — the direct-mode counterpart to
// MOCK_CLI_RUN_LC_CREATE_PR above: for a done-lane ('merge' action)
// invocation, actually shell out to `lc worktrees merge <track-number>`
// (the primitive SKILL.md's merge command documents running in direct
// mode) so a direct-mode E2E test exercises the real
// merge-into-main + worktree/branch cleanup code path
// (conductor/services/worktree-merge.mjs + bin/lc.mjs), not just a
// simulated end state.
if (process.env.MOCK_CLI_RUN_LC_MERGE && command === 'done') {
  const running = findRunningTrackDir();
  const numMatch = running?.trackDir.match(/(?:^|-)(\d+)-/);
  if (numMatch) {
    try {
      execFileSync('node', [join(__dirname, '..', '..', 'bin', 'lc.mjs'), 'worktrees', 'merge', numMatch[1]],
        { cwd: process.cwd(), stdio: 'inherit' });
    } catch (e) {
      console.error(`[mock-cli] lc worktrees merge ${numMatch[1]} failed: ${e.message}`);
    }
  }
}

// Track 10035: MOCK_CLI_WRITE_LANE_STATUS=<value> — if set, patch
// **Lane Status** in the track's own index.md to <value> right before
// exiting — simulates an agent's own self-transition write as its last
// action (e.g. the done-lane merge action writing "waiting" after opening
// a PR), so a test can drive the real exit handler's
// agent-self-reported-outcome detection against a genuinely spawned
// process instead of just unit-testing that logic in isolation.
//
// Deliberately does NOT resolve the track by matching `trackNumber` from
// argv against folder names: spawnCli's context-injection fallback
// overwrites the trailing argv slot (normally trackNumber) with the
// injected prompt text for any CLI whose last arg looks like a prompt —
// mock-cli.mjs included, see the MOCK_CLI_CLAIM_MARKER comment above — so
// `trackNumber` here is frequently the whole context+goal string, not a
// number, and a regex built from it never matches any folder. Instead,
// find the one track folder the caller already marked running (spawnCli
// writes **Lane Status**: running into it just before spawning) — exactly
// as unambiguous in these single-track-at-a-time tests, and immune to the
// same argv-clobbering.
const writeLaneStatus = process.env.MOCK_CLI_WRITE_LANE_STATUS;
if (writeLaneStatus) {
  try {
    const running = findRunningTrackDir();
    if (running) {
      const content = readFileSync(running.indexPath, 'utf8');
      const patched = content.replace(/\*\*Lane Status\*\*:\s*[^\n]+/i, `**Lane Status**: ${writeLaneStatus}`);
      writeFileSync(running.indexPath, patched, 'utf8');
    }
  } catch (e) { /* best-effort — a missing track dir shouldn't crash the mock */ }
}

setTimeout(() => {
  if (progressTimer) clearInterval(progressTimer);
  if (blockedSummary) {
    console.log(JSON.stringify({ type: 'system', subtype: 'post_turn_summary', status_category: 'blocked', status_detail: blockedSummary }));
  }
  process.exit(exitCode);
}, delay);
