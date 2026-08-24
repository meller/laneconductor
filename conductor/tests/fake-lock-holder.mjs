#!/usr/bin/env node
// conductor/tests/fake-lock-holder.mjs
// Track 1110 Phase 2, Task 5: acquires a worker-lock.mjs lock and holds
// it (idling) until killed. Used to prove a lock becomes stealable once
// its holding PROCESS actually dies — proper-lockfile auto-refreshes the
// lock on a timer for as long as the calling process is alive, so "never
// call release()" within the SAME process does not simulate death (the
// refresh timer keeps ticking); only a real killed process does.
//
// Usage: node fake-lock-holder.mjs <lockPath> <staleMs>

import { acquireWorkerLock } from '../services/worker-lock.mjs';

const [, , lockPath, staleMsArg] = process.argv;
const staleMs = parseInt(staleMsArg, 10);

const release = await acquireWorkerLock(lockPath, { staleMs });
if (!release) {
  console.log('LOCK_FAILED');
  process.exit(1);
}
console.log('LOCK_HELD');
setInterval(() => {}, 1000); // idle, keep the process (and proper-lockfile's refresh timer) alive
