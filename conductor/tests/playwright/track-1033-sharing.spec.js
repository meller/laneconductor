// conductor/tests/playwright/track-1033-sharing.spec.js
// E2E test for Track 1033: Multi-user Worker Sharing & Visibility
//
// Run modes:
//
//   MODE 1 — PW_TEST_MODE (local, no Firebase needed)
//     Restart server: PW_TEST_MODE=true node ui/server/index.mjs
//     Run test: PW_TEST_MODE=true npx playwright test track-1033-sharing.spec.js
//
//   MODE 2 — Real Firebase tokens (against local Firebase-enabled server or production)
//     TEST_TOKEN_A=<firebase-id-token-user-a> \
//     TEST_TOKEN_B=<firebase-id-token-user-b> \
//     TEST_USER_B_UID=<firebase-uid-user-b> \
//     TEST_API_URL=https://api.yourdomain.com \   # optional, defaults to localhost:8091
//     npx playwright test track-1033-sharing.spec.js
//
// Uses test.describe.serial so all steps share workerId/tokenA/tokenB state.

import { test, expect } from '@playwright/test';
import { randomUUID } from 'crypto';
import pg from 'pg';

const API = process.env.TEST_API_URL || 'http://localhost:8091';
const PW_TEST_MODE = process.env.PW_TEST_MODE === 'true';
const FIREBASE_MODE = Boolean(process.env.TEST_TOKEN_A && process.env.TEST_TOKEN_B && process.env.TEST_USER_B_UID);

const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/laneconductor';

// Shared state across serial steps
const state = {
  tokenA: null,
  tokenB: null,
  userAUid: null,
  userBUid: null,
  projectId: null,
  workerId: null,
  hostname: null,
  dbPool: null,      // only used in PW_TEST_MODE for seeding
};

test.describe.serial('Track 1033: Multi-user Worker Sharing', () => {
  test.beforeAll(async ({ request }) => {
    if (FIREBASE_MODE) {
      state.tokenA = process.env.TEST_TOKEN_A;
      state.tokenB = process.env.TEST_TOKEN_B;
      state.userBUid = process.env.TEST_USER_B_UID;
      console.log(`[sharing] Mode: FIREBASE — API: ${API}`);
    } else if (PW_TEST_MODE) {
      const uidA = 'test_userA_' + randomUUID().slice(0, 8);
      const uidB = 'test_userB_' + randomUUID().slice(0, 8);
      state.tokenA = `MOCK_TOKEN_FOR_${uidA}`;
      state.tokenB = `MOCK_TOKEN_FOR_${uidB}`;
      state.userAUid = uidA;
      state.userBUid = uidB;
      console.log(`[sharing] Mode: PW_TEST_MODE — A: ${uidA}, B: ${uidB}`);

      // Seed test users into DB (workers.user_uid FK requires users to exist)
      state.dbPool = new pg.Pool({ connectionString: DB_URL });
      const fakeGhBase = randomUUID().slice(0, 8);
      await state.dbPool.query(
        `INSERT INTO users (uid, github_id, login, name, email)
         VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)
         ON CONFLICT (uid) DO NOTHING`,
        [uidA, `gh_${fakeGhBase}_a`, `test-user-a-${fakeGhBase}`, 'Test User A', 'a@pw-test.local',
         uidB, `gh_${fakeGhBase}_b`, `test-user-b-${fakeGhBase}`, 'Test User B', 'b@pw-test.local']
      );
      console.log(`[sharing] Seeded test users in DB`);
    } else {
      const configRes = await request.get(`${API}/auth/config`);
      const { enabled } = await configRes.json();
      if (!enabled) {
        console.log('[sharing] Skipping: set PW_TEST_MODE=true on the server and re-run with PW_TEST_MODE=true,');
        console.log('[sharing] or provide TEST_TOKEN_A, TEST_TOKEN_B, TEST_USER_B_UID for Firebase mode.');
        test.skip();
        return;
      }
      console.log('[sharing] Skipping: auth enabled but no test tokens set (TEST_TOKEN_A/B).');
      test.skip();
      return;
    }

    // Resolve projectId
    if (process.env.TEST_PROJECT_ID) {
      state.projectId = parseInt(process.env.TEST_PROJECT_ID);
    } else if (PW_TEST_MODE) {
      // In PW_TEST_MODE the random test user has no project membership, so we can't use
      // the auth-scoped GET /api/projects. Default to project_id=1 (local dev project).
      // Override by setting TEST_PROJECT_ID.
      state.projectId = 1;
      console.log(`[sharing] PW_TEST_MODE: defaulting to project_id=1 (set TEST_PROJECT_ID to override)`);
    } else {
      const res = await request.get(`${API}/api/projects`, {
        headers: { Authorization: `Bearer ${state.tokenA}` },
      });
      expect(res.ok(), `GET /api/projects failed: ${res.status()}`).toBeTruthy();
      const projects = await res.json();
      expect(projects.length, 'No projects found for User A — ensure the user is a project member').toBeGreaterThan(0);
      state.projectId = projects[0].id;
      console.log(`[sharing] project_id=${state.projectId}`);
    }
  });

  test.afterAll(async ({ request }) => {
    if (state.hostname && state.tokenA) {
      await request.post(`${API}/worker/deregister`, {
        headers: { Authorization: `Bearer ${state.tokenA}` },
        data: { hostname: state.hostname },
      }).catch(() => {});
    }
    if (state.dbPool) {
      // Clean up seeded test users (cascades to workers and worker_permissions)
      await state.dbPool.query(
        `DELETE FROM users WHERE uid IN ($1, $2)`,
        [state.userAUid, state.userBUid]
      ).catch(() => {});
      await state.dbPool.end().catch(() => {});
    }
  });

  test('Step 1 — User A registers a private worker', async ({ request }) => {
    state.hostname = `pw-share-${randomUUID().slice(0, 6)}`;

    const res = await request.post(`${API}/worker/register`, {
      headers: { Authorization: `Bearer ${state.tokenA}` },
      data: {
        hostname: state.hostname,
        pid: process.pid,
        project_id: state.projectId,
        visibility: 'private',
      },
    });
    expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();

    const workersRes = await request.get(`${API}/api/projects/${state.projectId}/workers`, {
      headers: { Authorization: `Bearer ${state.tokenA}` },
    });
    const workers = await workersRes.json();
    const worker = workers.find(w => w.hostname === state.hostname);
    expect(worker, `Worker ${state.hostname} not found`).toBeDefined();
    expect(worker.visibility).toBe('private');
    state.workerId = worker.id;
    console.log(`[sharing] registered worker_id=${state.workerId}`);
  });

  test("Step 2 — User B cannot see User A's private worker", async ({ request }) => {
    const res = await request.get(`${API}/api/projects/${state.projectId}/workers`, {
      headers: { Authorization: `Bearer ${state.tokenB}` },
    });
    expect(res.ok()).toBeTruthy();
    const workers = await res.json();
    expect(
      workers.find(w => w.id === state.workerId),
      'Private worker must be hidden from User B'
    ).toBeUndefined();
    console.log('[sharing] PASS — private worker hidden from User B');
  });

  test('Step 3 — User A shares with Team + adds User B', async ({ request }) => {
    const patchRes = await request.patch(`${API}/api/workers/${state.workerId}/visibility`, {
      headers: { Authorization: `Bearer ${state.tokenA}` },
      data: { visibility: 'team' },
    });
    expect(patchRes.ok(), `PATCH visibility=team failed: ${patchRes.status()} ${await patchRes.text()}`).toBeTruthy();

    const grantRes = await request.post(`${API}/api/workers/${state.workerId}/permissions`, {
      headers: { Authorization: `Bearer ${state.tokenA}` },
      data: { user_uid: state.userBUid },
    });
    expect(grantRes.ok(), `grant permission failed: ${grantRes.status()} ${await grantRes.text()}`).toBeTruthy();
    console.log(`[sharing] visibility=team, User B (${state.userBUid}) granted`);
  });

  test('Step 4 — User B can now see the team worker', async ({ request }) => {
    const res = await request.get(`${API}/api/projects/${state.projectId}/workers`, {
      headers: { Authorization: `Bearer ${state.tokenB}` },
    });
    expect(res.ok()).toBeTruthy();
    const workers = await res.json();
    expect(
      workers.find(w => w.id === state.workerId),
      'Team worker must be visible to User B after grant'
    ).toBeDefined();
    console.log('[sharing] PASS — team worker visible to User B');
  });

  test('Step 5 — User A revokes User B access', async ({ request }) => {
    const revokeRes = await request.delete(
      `${API}/api/workers/${state.workerId}/permissions/${state.userBUid}`,
      { headers: { Authorization: `Bearer ${state.tokenA}` } }
    );
    expect(revokeRes.ok(), `revoke failed: ${revokeRes.status()} ${await revokeRes.text()}`).toBeTruthy();

    const res = await request.get(`${API}/api/projects/${state.projectId}/workers`, {
      headers: { Authorization: `Bearer ${state.tokenB}` },
    });
    const workers = await res.json();
    expect(
      workers.find(w => w.id === state.workerId),
      'Worker must be hidden from User B after revoke'
    ).toBeUndefined();
    console.log('[sharing] PASS — access revoked, worker hidden');
  });

  test('Step 6 — User A sets worker to Public (visible to everyone)', async ({ request }) => {
    const patchRes = await request.patch(`${API}/api/workers/${state.workerId}/visibility`, {
      headers: { Authorization: `Bearer ${state.tokenA}` },
      data: { visibility: 'public' },
    });
    expect(patchRes.ok(), `PATCH visibility=public failed: ${patchRes.status()}`).toBeTruthy();

    const res = await request.get(`${API}/api/projects/${state.projectId}/workers`, {
      headers: { Authorization: `Bearer ${state.tokenB}` },
    });
    const workers = await res.json();
    expect(
      workers.find(w => w.id === state.workerId),
      'Public worker must be visible to User B without permission'
    ).toBeDefined();
    console.log('[sharing] PASS — public worker visible to any user');
  });
});
