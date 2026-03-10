#!/usr/bin/env node
// conductor/tests/mock-cli.mjs
// Mock CLI used by the local-fs E2E test.
// Invoked as: node mock-cli.mjs [command] [trackNumber]
//
// Behaviour is controlled by env vars:
//   MOCK_CLI_EXIT_CODE=0      Exit code (default 0 = success)
//   MOCK_CLI_DELAY_MS=100     How long to sleep before exiting (default 100ms)

const [,, command, trackNumber] = process.argv;
const exitCode = parseInt(process.env.MOCK_CLI_EXIT_CODE ?? '0');
const delay = parseInt(process.env.MOCK_CLI_DELAY_MS ?? '100');

console.log(`[mock-cli] ${command} track=${trackNumber} → exit ${exitCode} after ${delay}ms`);

setTimeout(() => {
  process.exit(exitCode);
}, delay);
