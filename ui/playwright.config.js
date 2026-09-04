import { defineConfig, devices } from '@playwright/test';

// Track AM-1119 Phase 6 (Task 1): browser E2E for flows unit/component
// tests can't exercise (multi-step wizard navigation, real DOM click
// delegation on radio/checkbox labels). Was "(planned)" in tech-stack.md —
// this is the first real setup. Runs against `vite` alone (client script,
// not the full `dev` concurrently pair) since every spec mocks the API at
// the network layer via page.route() — no live Express server or Postgres
// needed, keeping specs fast and deterministic.
export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:8190',
    trace: 'retain-on-failure',
  },
  // Port 8190, not 8090: this dev machine commonly has a real, separately
  // launched LaneConductor Vite server already running on 8090 (the
  // documented UI port — see tech-stack.md) serving unrelated, currently
  // live sessions. `reuseExistingServer: false` is deliberate, not the
  // usual `!process.env.CI` default — confirmed live that a reused
  // ambient server on the "standard" port silently served a completely
  // different build (missing this track's whole wizard UI), and every
  // spec here mocks the API anyway, so a fresh isolated instance costs
  // nothing.
  webServer: {
    command: 'npx vite --port 8190 --strictPort',
    port: 8190,
    reuseExistingServer: false,
    timeout: 30000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Track 1121 Phase 6: real-phone-viewport coverage for the mobile UX
    // work (Phases 1-5) — everything else in this config (mocked API,
    // isolated port 8190) applies unchanged to this project too.
    { name: 'mobile-chrome', use: { ...devices['Pixel 5'] } },
  ],
});
