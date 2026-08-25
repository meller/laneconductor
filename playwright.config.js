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
//   slow — drives real worker/agent runs end to end. Inherently minutes long.
//          Track 10021: these specs now bring their OWN throwaway worker
//          (see conductor/tests/playwright/helpers/scoped-worker.mjs),
//          scoped to only the track(s) each spec creates, and no longer
//          depend on an ambient `lc worker start --sync-and-work` process —
//          this tier is CI-runnable with zero external setup.
//          The one requirement is the INVERSE of the old one: an ambient
//          worker, if running, must be STOPPED first (`lc worker stop`) —
//          not because these specs need it absent to function, but because
//          an ambient `--sync-and-work` worker would claim the tracks first
//          and re-pollute the parallel_limit:1 assertion the concurrency
//          spec depends on being hermetic (exactly the failure this track
//          was filed to eliminate — see conductor/tracks/10021-*/spec.md).
//          Run: lc worker stop && npx playwright test --project=slow
//
// Specs are assigned by filename below, so a new spec that matches neither
// list lands in `fast` by default — which is the safe direction (it gets run
// rather than silently dropped) but means new agent-driven specs must be added
// to SLOW_SPECS explicitly.
//
// track-1033-sharing.spec.js is deliberately NOT in SLOW_SPECS despite also
// spawning its own worker/server: it brings a dedicated PW_TEST_MODE API
// server (helpers/test-server.mjs), not an agent-driven worker run, and
// measured at ~2s for all 6 tests (track 10021 Phase 6) — comfortably
// inside the fast tier's 60s-per-test ceiling.
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
  //
  // Track 10021 revisit: point (4)'s "not fixable short of a second isolated
  // worker" is exactly what scoped-worker.mjs now provides — each slow spec
  // gets its own worker_number, so two slow specs running in parallel would
  // no longer race each other's concurrency assertion the way they did
  // under one shared ambient worker. NOT changed here anyway: (1)-(3) still
  // stand unfixed (track-1033-e2e.spec.js / worker-identity.spec.js still
  // share DB-level state — API keys, hardcoded track 999), and this track's
  // scope is the slow tier's worker dependency, not a parallelism audit of
  // the whole suite. Worth a dedicated look, not a drive-by change here.
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
