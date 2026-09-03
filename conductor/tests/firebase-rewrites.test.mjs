#!/usr/bin/env node
// conductor/tests/firebase-rewrites.test.mjs
// Track 10052 Phase 1: offline regression suite for firebase.json's hosting
// rewrites. The production bug was that `/api**` matches only within a single
// path segment, so every multi-segment API path fell through to the SPA
// catch-all and returned 200 text/html. Nothing in the repo asserted routing,
// so it shipped silently. This suite makes it reproducible in <1s, no network.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  matchesGlob,
  resolveRewrite,
  hasGluedGlobstar,
  extractExpressRoutes,
  concreteExamplePath,
} from '../services/firebase-rewrites.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const firebaseConfig = JSON.parse(readFileSync(join(repoRoot, 'firebase.json'), 'utf8'));
const cloudFunctionSource = readFileSync(join(repoRoot, 'cloud/functions/index.js'), 'utf8');

const targets = firebaseConfig.hosting;
const targetNames = targets.map((t) => t.target);

/** Every collector path conductor/laneconductor.sync.mjs calls (spec.md). */
const WORKER_PATHS = [
  '/api/projects/1/claimable-tracks',
  '/api/projects/1/tracks',
  '/api/workers',
  // Track 10053: this list was hand-written and silently missing
  // /conductor-files, so this suite stayed green while that path had no
  // rewrite at all and fell through to the SPA. The derived-from-source check
  // in cloud-route-parity.test.mjs exists because of exactly this.
  '/conductor-files',
  '/file-sync/claim',
  '/file-sync/42',
  '/project/ensure',
  '/projects/1/workflow',
  '/provider-status',
  '/track',
  '/track/10052',
  '/track/10052/action',
  '/track/10052/lock',
  '/track/10052/unlock',
  '/track/10052/session',
  '/track/10052/retry-count',
  '/track/10052/prespawn-block',
  '/track/10052/prespawn-block/reset',
  '/tracks/claim-queue',
  '/tracks/heartbeat',
  '/tracks/stale',
  '/tracks/reset-stuck-actions',
  '/worker',
  '/worker/register',
  '/worker/heartbeat',
  '/worker/7/dispatch',
  '/worker/7/dispatch/claimed',
  '/worker-dispatch/7',
];

/** Client-side routes that must keep resolving to the SPA, not the function. */
const SPA_PATHS = ['/', '/board', '/settings/profile', '/inbox'];

const rewritesFor = (name) => targets.find((t) => t.target === name).rewrites;
const routesToFunction = (name, path) => resolveRewrite(rewritesFor(name), path)?.function === 'api';
const routesToSpa = (name, path) => resolveRewrite(rewritesFor(name), path)?.destination === '/index.html';

// ── The glob dialect itself ───────────────────────────────────────────────────
// TC-1..TC-4. These encode behaviour OBSERVED live in production, not assumed.
// If any of these four break, the model no longer describes Firebase and every
// other assertion in this file is worthless.

describe('Firebase glob dialect (verified against production 2026-09-03)', () => {
  it('TC-1: /api** matches /apifoo — glued ** behaves as single-segment *', () => {
    // Live: returned Express "Cannot GET /apifoo" → the rewrite matched.
    assert.equal(matchesGlob('/api**', '/apifoo'), true);
  });

  it('TC-2: /api** does NOT match /api/health — this is the entire bug', () => {
    // Live: returned 200 text/html (the SPA) → the rewrite missed.
    assert.equal(matchesGlob('/api**', '/api/health'), false);
  });

  it('TC-2b: /health** matches /health but not /health/foo', () => {
    // Live: /health → 200 JSON; /health/foo → 200 SPA HTML.
    assert.equal(matchesGlob('/health**', '/health'), true);
    assert.equal(matchesGlob('/health**', '/health/foo'), false);
  });

  it('TC-3: /api/** matches nested paths at any depth', () => {
    assert.equal(matchesGlob('/api/**', '/api/health'), true);
    assert.equal(matchesGlob('/api/**', '/api/projects/1/tracks'), true);
  });

  it('TC-4: /api/** does NOT match bare /api — hence the bare entry is required', () => {
    assert.equal(matchesGlob('/api/**', '/api'), false);
    assert.equal(matchesGlob('/api', '/api'), true);
  });

  it('bare ** catch-all matches everything', () => {
    assert.equal(matchesGlob('**', '/'), true);
    assert.equal(matchesGlob('**', '/any/deep/path'), true);
  });

  it('hasGluedGlobstar flags the defective shape and clears the correct one', () => {
    assert.equal(hasGluedGlobstar('/api**'), true);
    assert.equal(hasGluedGlobstar('/provider-status**'), true);
    assert.equal(hasGluedGlobstar('/api/**'), false);
    assert.equal(hasGluedGlobstar('**'), false);
    assert.equal(hasGluedGlobstar('/api'), false);
  });
});

// ── The actual firebase.json ──────────────────────────────────────────────────

describe('firebase.json structure', () => {
  it('defines both the app and landing hosting targets', () => {
    assert.deepEqual([...targetNames].sort(), ['app', 'landing']);
  });

  // TC-10
  it('TC-10: SPA catch-all is present and LAST in every target', () => {
    for (const target of targets) {
      const last = target.rewrites[target.rewrites.length - 1];
      assert.equal(last.source, '**', `target ${target.target}: catch-all must be last`);
      assert.equal(last.destination, '/index.html', `target ${target.target}`);

      const catchAllCount = target.rewrites.filter((r) => r.source === '**').length;
      assert.equal(catchAllCount, 1, `target ${target.target}: exactly one catch-all`);
    }
  });

  // TC-12 — the guard that stops the bug from silently returning.
  it('TC-12: no function rewrite uses the defective glued /<prefix>** shape', () => {
    const defective = [];
    for (const target of targets) {
      for (const rw of target.rewrites) {
        if (rw.function && hasGluedGlobstar(rw.source)) {
          defective.push(`${target.target}: "${rw.source}"`);
        }
      }
    }
    assert.deepEqual(
      defective,
      [],
      `Glued "**" matches only within one path segment. Use "/prefix" + "/prefix/**".\n` +
        `Defective entries:\n  ${defective.join('\n  ')}`,
    );
  });
});

// ── Reachability: the worker's real paths ─────────────────────────────────────
// TC-6..TC-9

for (const targetName of ['app', 'landing']) {
  describe(`worker collector paths reach the api function — target "${targetName}"`, () => {
    // TC-6 / TC-7
    it(`TC-6/7: all ${WORKER_PATHS.length} worker paths route to the function`, () => {
      const unreachable = WORKER_PATHS.filter((p) => !routesToFunction(targetName, p));
      assert.deepEqual(
        unreachable,
        [],
        `These fall through to the SPA catch-all and return 200 text/html:\n  ${unreachable.join('\n  ')}`,
      );
    });

    // TC-8 — guards REQ-2. A corrected "/project/**" would NOT cover this.
    it('TC-8: /projects/1/workflow routes to the function (plural prefix)', () => {
      assert.equal(routesToFunction(targetName, '/projects/1/workflow'), true);
    });

    // TC-9 — guards REQ-2. "/worker/**" would NOT cover this.
    it('TC-9: /worker-dispatch/7 routes to the function', () => {
      assert.equal(routesToFunction(targetName, '/worker-dispatch/7'), true);
    });

    it('bare single-segment paths that already worked still work', () => {
      for (const p of ['/health', '/heartbeat', '/log', '/provider-status', '/track', '/worker']) {
        assert.equal(routesToFunction(targetName, p), true, `${p} must reach the function`);
      }
    });
  });
}

// ── Reachability: every route the cloud function actually registers ───────────
// Self-maintaining: a new route with an uncovered prefix fails here rather than
// 404ing in production.

describe('every registered cloud function route is reachable through Hosting', () => {
  const routes = extractExpressRoutes(cloudFunctionSource);

  it('found a plausible number of routes to check', () => {
    assert.ok(routes.length > 40, `expected >40 routes, extracted ${routes.length}`);
  });

  for (const targetName of ['app', 'landing']) {
    it(`target "${targetName}": all ${routes.length} routes route to the function`, () => {
      const unreachable = routes
        .map((r) => ({ route: r, path: concreteExamplePath(r) }))
        .filter(({ path }) => !routesToFunction(targetName, path))
        .map(({ route, path }) => `${route}  (e.g. ${path})`);

      assert.deepEqual(
        unreachable,
        [],
        `Registered routes unreachable through Hosting:\n  ${unreachable.join('\n  ')}`,
      );
    });
  }
});

// ── The SPA must survive the fix ──────────────────────────────────────────────
// TC-11 — guards against over-broad globs trading one bug for another.

describe('SPA routing is preserved', () => {
  for (const targetName of ['app', 'landing']) {
    it(`TC-11: target "${targetName}" serves client-side routes from /index.html`, () => {
      const hijacked = SPA_PATHS.filter((p) => !routesToSpa(targetName, p));
      assert.deepEqual(
        hijacked,
        [],
        `These must serve the SPA but were captured by a function rewrite:\n  ${hijacked.join('\n  ')}`,
      );
    });
  }
});
