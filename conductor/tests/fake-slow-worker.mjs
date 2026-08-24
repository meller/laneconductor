#!/usr/bin/env node
// conductor/tests/fake-slow-worker.mjs
// Track 1110 Phase 2: stands in for laneconductor.sync.mjs's own slow
// SIGTERM handler (removeWorker()'s up-to-10s network call) without
// needing a real collector/DB. Writes its own pid to the given pidfile
// on startup, then on SIGTERM waits SLOW_SHUTDOWN_MS before actually
// exiting — simulating "signal delivered, but the process takes a while
// to really die."
//
// Usage: node fake-slow-worker.mjs <pidfile-path> [slowShutdownMs=2000]

import { writeFileSync } from 'node:fs';

const [, , pidFilePath, slowMsArg] = process.argv;
const slowMs = parseInt(slowMsArg ?? '2000', 10);

writeFileSync(pidFilePath, String(process.pid));

process.on('SIGTERM', () => {
  setTimeout(() => process.exit(0), slowMs);
});

// Keep the event loop alive so the process doesn't exit on its own.
setInterval(() => {}, 1000);
