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

import { existsSync } from 'node:fs';

const [,, command, trackNumber] = process.argv;
const sentinelPath = process.env.MOCK_CLI_RESUME_FAILURE_SENTINEL;
const resumeFailure = !!sentinelPath && existsSync(sentinelPath);
const exitCode = resumeFailure ? 1 : parseInt(process.env.MOCK_CLI_EXIT_CODE ?? '0');
const delay = parseInt(process.env.MOCK_CLI_DELAY_MS ?? '100');

if (resumeFailure) {
  console.log('No conversation found with session ID: (mock)');
} else {
  console.log(`[mock-cli] ${command} track=${trackNumber} → exit ${exitCode} after ${delay}ms`);
}

setTimeout(() => {
  process.exit(exitCode);
}, delay);
