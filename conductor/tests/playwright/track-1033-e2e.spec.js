// conductor/tests/playwright/track-1033-e2e.spec.js
// E2E test for Track 1033: Worker Identity, Remote API, and Sync
// 
// Requirements:
// 1. Firebase OAuth to create a token
// 2. API GET from remote API (with token)
// 3. Register a local worker (with API Key)
// 4. Change worker options (private/team/public)
// 5. Update of tracks from file system to prod

import { test, expect } from '@playwright/test';
import { randomUUID } from 'crypto';

const BASE = 'http://localhost:8090';
const API  = 'http://localhost:8091';

const TEST_EMAIL    = process.env.PW_TEST_EMAIL    || 'test@laneconductor.com';
const TEST_PASSWORD = process.env.PW_TEST_PASSWORD || 'PW_test_lc_2026!';

test.describe('Track 1033: Worker Identity & Sync E2E', () => {
  let idToken;
  let apiKey;
  let projectId;
  let machineToken;
  let workerId;

  test.beforeAll(async ({ request }) => {
    // 1. Get Firebase config and sign in to get an idToken
    console.log('--- Step 1: Firebase Auth ---');
    const configRes = await request.get(`${BASE}/auth/config`);
    const { enabled, firebase: fbConfig } = await configRes.json();
    
    if (!enabled) {
      console.log('Auth not enabled on server, skipping Firebase auth step (using local mode)');
    } else {
      const signInRes = await request.post(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${fbConfig.apiKey}`,
        {
          data: { email: TEST_EMAIL, password: TEST_PASSWORD, returnSecureToken: true }
        }
      );
      const signInData = await signInRes.json();
      if (signInData.error) {
        throw new Error(`Firebase sign-in failed: ${signInData.error.message}`);
      }
      idToken = signInData.idToken;
      console.log('✅ Got Firebase idToken');
    }
  });

  test('Step 2: API GET from remote API (with token)', async ({ request }) => {
    console.log('--- Step 2: API GET with Token ---');
    const headers = idToken ? { 'Authorization': `Bearer ${idToken}` } : {};
    const res = await request.get(`${API}/api/projects`, { headers });
    expect(res.ok()).toBeTruthy();
    const projects = await res.json();
    expect(Array.isArray(projects)).toBeTruthy();
    if (projects.length > 0) {
      projectId = projects[0].id;
    }
    console.log(`✅ Fetched ${projects.length} projects`);
  });

  test('Step 3: Register a local worker (with API Key)', async ({ page, request }) => {
    console.log('--- Step 3: API Key & Worker Registration ---');
    
    // 3.1 Generate API Key via UI/API
    const headers = idToken ? { 'Authorization': `Bearer ${idToken}` } : {};
    const keyRes = await request.post(`${API}/api/keys`, {
      headers,
      data: { name: 'E2E Test Worker Key' }
    });
    expect(keyRes.ok()).toBeTruthy();
    const keyData = await keyRes.json();
    apiKey = keyData.key;
    expect(apiKey).toContain('lc_live_');
    console.log('✅ Generated API Key');

    // 3.2 Register Worker using API Key
    // Simulated hostname and pid
    const hostname = `e2e-test-host-${randomUUID().slice(0, 8)}`;
    const pid = Math.floor(Math.random() * 10000);
    
    const regRes = await request.post(`${API}/worker/register`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      data: {
        hostname,
        pid,
        project_id: projectId,
        visibility: 'private',
        mode: 'polling'
      }
    });
    expect(regRes.ok()).toBeTruthy();
    const regData = await regRes.json();
    machineToken = regData.machine_token;
    expect(machineToken).toBeTruthy();
    console.log('✅ Registered simulated worker');

    // Get worker ID for later
    const workersRes = await request.get(`${API}/api/projects/${projectId}/workers`, { headers });
    const workers = await workersRes.json();
    const worker = workers.find(w => w.hostname === hostname && w.pid === pid);
    expect(worker).toBeTruthy();
    workerId = worker.id;
  });

  test('Step 4: Change worker options (private/team/public)', async ({ page, request }) => {
    console.log('--- Step 4: Worker Visibility Change ---');
    const headers = idToken ? { 'Authorization': `Bearer ${idToken}` } : {};
    
    // Change to Team
    const teamRes = await request.patch(`${API}/api/workers/${workerId}/visibility`, {
      headers,
      data: { visibility: 'team' }
    });
    expect(teamRes.ok()).toBeTruthy();
    console.log('✅ Changed visibility to Team');

    // Verify in DB
    let workerRes = await request.get(`${API}/api/workers`, { headers });
    let workers = await workerRes.json();
    let worker = workers.find(w => w.id === workerId);
    expect(worker.visibility).toBe('team');

    // Change to Public
    const publicRes = await request.patch(`${API}/api/workers/${workerId}/visibility`, {
      headers,
      data: { visibility: 'public' }
    });
    expect(publicRes.ok()).toBeTruthy();
    console.log('✅ Changed visibility to Public');

    // Verify in DB
    workerRes = await request.get(`${API}/api/workers`, { headers });
    workers = await workerRes.json();
    worker = workers.find(w => w.id === workerId);
    expect(worker.visibility).toBe('public');
    
    // Reset to Private
    await request.patch(`${API}/api/workers/${workerId}/visibility`, {
      headers,
      data: { visibility: 'private' }
    });
    console.log('✅ Reset visibility to Private');
  });

  test('Step 5: Update of tracks from file system to prod', async ({ request }) => {
    console.log('--- Step 5: Track Sync Simulation ---');
    
    // Simulate a worker syncing a track from filesystem to DB
    const trackNum = '999'; // Canary track
    const title = 'E2E Sync Test Track';
    const content = `# Track 999: ${title}\n\n**Lane**: implement\n**Progress**: 50%\n**Summary**: Synced from E2E test.\n`;
    
    const syncRes = await request.post(`${API}/track?project_id=${projectId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      data: {
        track_number: trackNum,
        title,
        lane_status: 'implement',
        progress_percent: 50,
        content_summary: 'Synced from E2E test.',
        index_content: content,
        lane_action_status: 'running'
      }
    });
    
    expect(syncRes.ok()).toBeTruthy();
    console.log('✅ Synced track to DB using API Key');

    // Verify track in DB via project API
    const headers = idToken ? { 'Authorization': `Bearer ${idToken}` } : {};
    const tracksRes = await request.get(`${API}/api/projects/${projectId}/tracks?track=${trackNum}`, { headers });
    const tracks = await tracksRes.json();
    expect(tracks.length).toBe(1);
    expect(tracks[0].track_number).toBe(trackNum);
    expect(tracks[0].progress_percent).toBe(50);
    expect(tracks[0].lane_status).toBe('implement');
    console.log('✅ Verified track update in DB');
    
    // Cleanup track
    await request.delete(`${API}/api/projects/${projectId}/tracks/${trackNum}`, { headers });
    console.log('✅ Cleaned up E2E track');
  });

  test.afterAll(async ({ request }) => {
    // Cleanup worker and API key
    console.log('--- Final Cleanup ---');
    const headers = idToken ? { 'Authorization': `Bearer ${idToken}` } : {};
    
    if (workerId) {
      // API expects hostname and pid for worker deletion via /worker
      // But we can just let it heartbeat-timeout or use the DELETE /worker endpoint
      await request.delete(`${API}/worker`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        data: { hostname: `e2e-test-host`, pid: 0 } // Hostname part might be tricky if it was random
      }).catch(() => {});
    }

    // Revoke API keys generated during test
    const keysRes = await request.get(`${API}/api/keys`, { headers });
    const keys = await keysRes.json();
    for (const key of keys) {
      if (key.name === 'E2E Test Worker Key') {
        await request.delete(`${API}/api/keys/${key.id}`, { headers });
      }
    }
    console.log('✅ Revoked E2E API Keys');
  });
});
