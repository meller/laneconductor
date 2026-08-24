// playwright.config.js
import { defineConfig } from '@playwright/test';

// Track 1100 Phase 3: the suite is split into two tiers.
//
// Everything used to sit in one undifferentiated pile with a 3-minute default
// per-test timeout, so "run the E2E suite" meant a worst case of tens of
// minutes. Nothing in the workflow ever actually ran it. Tiering lets the
// quality gate gate on the deterministic part every track, while the specs
// that drive a real agent/worker run stay available but opt-in.
//
//   fast — deterministic; UI + collector API only. No LLM calls, no dependence
//          on a live heartbeat worker claiming a lane action.
//          Run: npx playwright test --project=fast
//
//   slow — drives real worker/agent runs end to end. Inherently minutes long
//          and REQUIRES a running sync+poll worker (`lc worker start
//          --sync-and-work`); without one these fail by design, waiting for a
//          claim that never comes.
//          Run: npx playwright test --project=slow
//
// Specs are assigned by filename below, so a new spec that matches neither
// list lands in `fast` by default — which is the safe direction (it gets run
// rather than silently dropped) but means new agent-driven specs must be added
// to SLOW_SPECS explicitly.
const SLOW_SPECS = [
  '**/brainstorm-concurrency.spec.js',
  '**/brainstorm-concurrency-v2.spec.js',
  '**/new-track-plan.spec.js',
];

export default defineConfig({
  testDir: './conductor/tests/playwright',
  timeout: 180000,
  retries: 0,
  // Track 1100 Phase 4: kept at 1, and this is NOT stale. The previous comment
  // just said "tests share state (track number)", which was too vague to act
  // on. The concrete, verified conflicts as of 2026-08-12:
  //
  //   1. brainstorm-concurrency-v2.spec.js hardcodes track numbers 991 and 992
  //      and creates/deletes those directories under conductor/tracks/ on the
  //      real filesystem.
  //   2. track-1033-e2e.spec.js hardcodes track number 999 (the canary track)
  //      and creates then DELETEs it in the live DB.
  //   3. worker-identity.spec.js and track-1033-e2e.spec.js both generate and
  //      revoke API keys on the same project, and worker-identity asserts on a
  //      before/after *row count* of api-key-row — concurrent key mutation
  //      from the other file corrupts that count directly.
  //   4. The brainstorm/new-track specs drive the single real heartbeat worker
  //      and assert on its concurrency limit. Running them in parallel races
  //      the very thing under test.
  //
  // (1)-(3) are fixable per-spec; (4) is not, short of a second isolated
  // worker. The fast tier is only two files and ~16s total, so parallelising
  // it would buy a couple of seconds for real flakiness risk. Not worth it.
  workers: 1,
  use: {
    baseURL: 'http://localhost:8090',
    headless: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  reporter: [['list'], ['html', { open: 'never' }]],
  projects: [
    {
      name: 'fast',
      testIgnore: SLOW_SPECS,
      // A real ceiling rather than the 180s global default. Nothing in this
      // tier legitimately takes a minute; if something does, it has picked up
      // a dependency on a live agent run and belongs in `slow`.
      timeout: 60000,
    },
    {
      name: 'slow',
      testMatch: SLOW_SPECS,
      // These poll real worker runs with 120-180s deadlines of their own.
      timeout: 300000,
    },
  ],
});
