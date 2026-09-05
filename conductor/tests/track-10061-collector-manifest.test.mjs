#!/usr/bin/env node
// conductor/tests/track-10061-collector-manifest.test.mjs
// Track 10061 Phase 1: the shared route-manifest module and both servers'
// GET /health handshake response.
//
// Run: node --test conductor/tests/track-10061-collector-manifest.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import {
  COLLECTOR_API_VERSION,
  buildRouteManifest,
  formatManifestRoutes,
  compareManifest,
} from '../services/collector-manifest.mjs';
import { buildVendoredFile } from '../scripts/vendor-collector-manifest.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');

// createRequire so this ESM test can require() the generated CommonJS file.
function require_cjs(path) {
  return createRequire(import.meta.url)(path);
}

// ── TC-1/TC-2: buildRouteManifest on throwaway apps ────────────────────────────

describe('TC-1: buildRouteManifest — direct routes', () => {
  it('finds exactly the routes registered, method upper-cased', () => {
    const app = express();
    app.get('/a', (req, res) => res.end());
    app.post('/b/:id', (req, res) => res.end());
    const entries = buildRouteManifest(app);
    const formatted = formatManifestRoutes(entries);
    assert.deepEqual(formatted, ['GET /a', 'POST /b/:id']);
  });
});

describe('TC-2: buildRouteManifest — mounted sub-router', () => {
  it('resolves a route registered via app.use(prefix, router)', () => {
    const app = express();
    const sub = express.Router();
    sub.get('/config', (req, res) => res.end());
    app.use('/auth', sub);
    const formatted = formatManifestRoutes(buildRouteManifest(app));
    assert.ok(
      formatted.includes('GET /auth/config'),
      `expected GET /auth/config in manifest, got:\n  ${formatted.join('\n  ')}`,
    );
  });
});

// TC-3 is verified against the same spawned-child server as TC-6/TC-7
// (below), reading buildRouteManifest's output through the real GET /health
// response rather than importing ui/server/index.mjs into this test's own
// process. Importing it directly (even under NODE_ENV=test, which only
// skips server.listen()) pulls in ./logger.mjs's pinorama-transport stream,
// which keeps this process's event loop alive indefinitely — observed live:
// every assertion passed in well under a second, but `node --test` itself
// never exited on its own afterward. A spawned child sidesteps this
// entirely: proc.kill() ends the whole OS process regardless of what
// handles it holds internally.

// ── TC-4/TC-5/TC-5b/TC-5c: compareManifest ──────────────────────────────────────

describe('TC-4: compareManifest — fully covered', () => {
  it('reports ok with no missing routes', () => {
    const manifest = { api_version: 1, routes: ['GET /a', 'POST /b/:id'] };
    const result = compareManifest({
      workerVersion: 1,
      workerCalls: [{ method: 'GET', path: '/a' }],
      manifest,
    });
    assert.equal(result.severity, 'ok');
    assert.deepEqual(result.missingRoutes, []);
    assert.equal(result.compatible, true);
  });
});

describe('TC-5: compareManifest — a worker call the manifest does not serve', () => {
  it('reports missing-routes naming the exact call', () => {
    const manifest = { api_version: 1, routes: ['GET /a'] };
    const result = compareManifest({
      workerVersion: 1,
      workerCalls: [{ method: 'POST', path: '/tracks/claim-queue' }],
      manifest,
    });
    assert.equal(result.severity, 'missing-routes');
    assert.deepEqual(result.missingRoutes, ['POST /tracks/claim-queue']);
    assert.equal(result.compatible, true, 'degraded-continue: missing routes must never mark incompatible');
  });
});

describe('TC-5b: compareManifest — lower collector api_version', () => {
  it('reports version-drift with a negative delta', () => {
    const manifest = { api_version: 1, routes: [] };
    const result = compareManifest({ workerVersion: 2, workerCalls: [], manifest });
    assert.equal(result.severity, 'version-drift');
    assert.equal(result.apiVersionDelta, -1);
    assert.equal(result.compatible, true);
  });
});

describe('TC-5c: compareManifest — malformed/absent manifest never throws', () => {
  for (const [label, manifest] of [
    ['null', null],
    ['empty object', {}],
    ['nonsense routes field', { routes: 'nonsense' }],
  ]) {
    it(`returns severity 'unknown' for ${label}, and never throws`, () => {
      const result = compareManifest({ workerVersion: 1, workerCalls: [{ method: 'GET', path: '/a' }], manifest });
      assert.equal(result.severity, 'unknown');
      assert.equal(result.compatible, true);
    });
  }
});

// ── TC-9: vendor freshness ──────────────────────────────────────────────────────

describe('TC-9: vendored cloud/functions/collector-manifest.js is current', () => {
  it('regenerating in memory matches the checked-in file byte-for-byte', () => {
    const generated = buildVendoredFile();
    const checkedIn = readFileSync(join(repoRoot, 'cloud/functions/collector-manifest.js'), 'utf8');
    assert.equal(
      generated,
      checkedIn,
      'cloud/functions/collector-manifest.js is stale — run: node conductor/scripts/vendor-collector-manifest.mjs',
    );
  });

  it('the vendored file loads as CommonJS and matches the ESM source\'s exports', () => {
    const cjs = require_cjs(join(repoRoot, 'cloud/functions/collector-manifest.js'));
    assert.deepEqual(Object.keys(cjs).sort(), ['COLLECTOR_API_VERSION', 'buildRouteManifest', 'compareManifest', 'formatManifestRoutes']);
    assert.equal(cjs.COLLECTOR_API_VERSION, COLLECTOR_API_VERSION);
  });
});

// ── TC-10: firebase.json predeploy hook ─────────────────────────────────────────

describe('TC-10: firebase.json wires the vendor generator as a predeploy hook', () => {
  it('functions.predeploy invokes vendor-collector-manifest.mjs', () => {
    const firebaseJson = JSON.parse(readFileSync(join(repoRoot, 'firebase.json'), 'utf8'));
    const predeploy = firebaseJson.functions?.predeploy ?? [];
    assert.ok(
      predeploy.some((cmd) => cmd.includes('vendor-collector-manifest.mjs')),
      `expected a predeploy command invoking vendor-collector-manifest.mjs, got: ${JSON.stringify(predeploy)}`,
    );
  });
});

// ── TC-11: every cloud route (including the extended /health) still routes ─────
// through Hosting. Re-derives the same check firebase-rewrites.test.mjs makes,
// scoped to /health, so a health route with an uncovered prefix fails here.

describe('TC-11: /health stays covered by both hosting targets\' rewrite tables', () => {
  it('firebase.json rewrites /health and /health/** for both targets', () => {
    const firebaseJson = JSON.parse(readFileSync(join(repoRoot, 'firebase.json'), 'utf8'));
    for (const site of firebaseJson.hosting) {
      const sources = site.rewrites.map((r) => r.source);
      assert.ok(sources.includes('/health'), `${site.target}: missing "/health" rewrite`);
      assert.ok(sources.includes('/health/**'), `${site.target}: missing "/health/**" rewrite`);
    }
  });
});

// ── TC-6/TC-7: the real local server's GET /health, as an actual HTTP call ─────

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

describe('TC-3/TC-6/TC-7: GET /health against a real, spawned local API server process', () => {
  let proc;
  let port;

  before(async () => {
    port = await getFreePort();
    proc = spawn('node', [join(repoRoot, 'ui/server/index.mjs')], {
      cwd: repoRoot,
      env: { ...process.env, API_PORT: String(port), NODE_ENV: undefined },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise((resolve, reject) => {
      let out = '';
      const onData = (d) => {
        out += d.toString();
        if (out.includes(`Listening on:${port}`)) {
          proc.stdout.off('data', onData);
          resolve();
        }
      };
      proc.stdout.on('data', onData);
      proc.stderr.on('data', (d) => process.stderr.write(`[api-server] ${d}`));
      proc.on('error', reject);
      setTimeout(() => reject(new Error('api server startup timeout')), 15000);
    });
  });

  after(() => {
    if (proc) proc.kill();
  });

  it('TC-6: returns 200 JSON with ok/server/api_version/non-empty routes', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') || '', /application\/json/);
    const body = await r.json();
    assert.equal(body.ok, true);
    assert.equal(body.server, 'local');
    assert.equal(Number.isInteger(body.api_version), true);
    assert.ok(Array.isArray(body.routes) && body.routes.length > 0);
  });

  it('TC-7: succeeds with no Authorization header', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(r.status, 200);
  });

  it('TC-3: reports a plausible number of real routes, every one absolute', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/health`);
    const { routes } = await r.json();
    assert.ok(routes.length >= 100, `expected >=100 entries, got ${routes.length}`);
    for (const entry of routes) {
      const route = entry.slice(entry.indexOf(' ') + 1);
      assert.ok(route.startsWith('/'), `route "${route}" should be absolute`);
    }
  });

  it('TC-3: includes a route mounted via app.use(\'/auth\', authRouter)', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/health`);
    const { routes } = await r.json();
    const authRoutes = routes.filter((r2) => r2.includes('/auth/'));
    assert.ok(
      authRoutes.length > 0,
      `expected at least one /auth/* route from the mounted authRouter, got:\n  ${routes.join('\n  ')}`,
    );
  });
});

// ── TC-8: cloud /health keeps cloud:true (source-level, no live cloud deploy) ──

describe('TC-8: cloud/functions/index.js\'s /health keeps backward-compatible fields', () => {
  it('the route handler returns cloud: true alongside the new fields', () => {
    const cloudSource = readFileSync(join(repoRoot, 'cloud/functions/index.js'), 'utf8');
    const healthBlockMatch = cloudSource.match(/app\.get\('\/health',[\s\S]{0,400}?\}\)\);/);
    assert.ok(healthBlockMatch, 'could not find the /health route handler in cloud/functions/index.js');
    const block = healthBlockMatch[0];
    assert.match(block, /cloud:\s*true/);
    assert.match(block, /api_version:\s*COLLECTOR_API_VERSION/);
    assert.match(block, /routes:\s*formatManifestRoutes/);
  });

  it('local and cloud both derive routes from buildRouteManifest, not a hand-kept list', () => {
    const localSource = readFileSync(join(repoRoot, 'ui/server/index.mjs'), 'utf8');
    const cloudSource = readFileSync(join(repoRoot, 'cloud/functions/index.js'), 'utf8');
    assert.match(localSource, /buildRouteManifest\(app\)/);
    assert.match(cloudSource, /buildRouteManifest\(app\)/);
  });
});
