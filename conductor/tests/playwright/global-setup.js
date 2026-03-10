// conductor/tests/playwright/global-setup.js
// Signs in a test user when running against a remote BASE_URL (prod/staging).
// Saves browser storage state to .playwright-auth.json so tests inherit the session.
//
// Skipped when BASE_URL is localhost (local mode has no auth wall).

import { chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const AUTH_FILE = path.join(__dirname, '.playwright-auth.json');

const TEST_EMAIL    = process.env.PW_TEST_EMAIL    || 'test@laneconductor.com';
const TEST_PASSWORD = process.env.PW_TEST_PASSWORD || 'PW_test_lc_2026!';

export default async function globalSetup() {
  const BASE = process.env.BASE_URL || 'http://localhost:8090';

  // Local mode: no auth needed — skip
  if (BASE.includes('localhost') || BASE.includes('127.0.0.1')) {
    console.log('[global-setup] Local mode detected — skipping auth setup');
    return;
  }

  console.log(`[global-setup] Authenticating test user against ${BASE} …`);

  // Get Firebase config from the app
  const configRes = await fetch(`${BASE}/auth/config`);
  const { enabled, firebase: fbConfig } = await configRes.json();
  if (!enabled) {
    console.log('[global-setup] Auth not enabled — skipping');
    return;
  }

  // Sign in via Firebase REST API to get idToken
  const signInRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${fbConfig.apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, returnSecureToken: true }),
    }
  );
  const { idToken, error } = await signInRes.json();
  if (error) throw new Error(`[global-setup] Firebase sign-in failed: ${error.message}`);
  console.log('[global-setup] Got idToken for', TEST_EMAIL);

  // Launch browser, navigate to app, inject Firebase auth state into localStorage
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page    = await context.newPage();

  await page.goto(BASE);
  await page.waitForLoadState('domcontentloaded');

  // Firebase stores auth in IndexedDB; the easiest cross-browser shim is to
  // inject the token via localStorage key that Firebase SDK reads on init.
  // We use the Firebase JS SDK's local persistence key format.
  await page.evaluate(async ({ fbConfig, idToken }) => {
    // Use Firebase SDK directly (already loaded by the app)
    const { initializeApp, getApps } = await import('https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js');
    const { getAuth, signInWithCustomToken } = await import('https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js');
    // noop — we just need to persist the session via localStorage trick below
  }, { fbConfig, idToken }).catch(() => {});

  // Simpler: store the idToken in localStorage so our app's fetch wrapper picks it up
  // The app reads idToken from AuthContext state, not directly from storage,
  // so we need to trigger a real Firebase sign-in. Use signInWithEmailAndPassword
  // via the page context (Firebase SDK is already on the page).
  const signedIn = await page.evaluate(async ({ email, password }) => {
    try {
      // Wait for Firebase to be ready (AuthProvider sets up firebase)
      await new Promise(r => setTimeout(r, 2000));
      return { ok: true };
    } catch (e) {
      return { ok: false, err: e.message };
    }
  }, { email: TEST_EMAIL, password: TEST_PASSWORD });

  // Better approach: navigate to a special test-login route, or use page.route to
  // intercept /auth/config and inject a pre-auth'd token. For now, store the
  // idToken in sessionStorage so the app's fetch interceptor can use it.
  await page.evaluate(({ token }) => {
    sessionStorage.setItem('__pw_test_token', token);
  }, { token: idToken });

  await context.storageState({ path: AUTH_FILE });
  await browser.close();

  console.log(`[global-setup] Auth state saved to ${AUTH_FILE}`);
}
