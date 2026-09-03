#!/usr/bin/env node
// conductor/tests/cloud-route-parity.test.mjs
// Track 10053: every collector endpoint conductor/laneconductor.sync.mjs calls
// must exist in cloud/functions/index.js.
//
// Track 10052 made API paths reach the `api` function. This suite covers what
// happens next: the function has to actually serve them. The worker's call list
// is derived from the worker source (conductor/services/collector-route-parity.mjs),
// so a future call to an unported route fails here instead of in production —
// which is the failure mode that produced this track.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { extractExpressRouteEntries } from '../services/firebase-rewrites.mjs';
import {
  normalizePathLiteral,
  extractWorkerCalls,
  expressRouteMatchesPath,
  findUnservedCalls,
  formatUnserved,
} from '../services/collector-route-parity.mjs';
import { CLAIMABLE_LANES } from '../constants.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const workerSource = readFileSync(join(repoRoot, 'conductor/laneconductor.sync.mjs'), 'utf8');
const cloudSource = readFileSync(join(repoRoot, 'cloud/functions/index.js'), 'utf8');
const localSource = readFileSync(join(repoRoot, 'ui/server/index.mjs'), 'utf8');

const workerCalls = extractWorkerCalls(workerSource);
const cloudRoutes = extractExpressRouteEntries(cloudSource);
const localRoutes = extractExpressRouteEntries(localSource);

// ── TC-1: the extractor itself ────────────────────────────────────────────────
// A silently-empty extraction would make every assertion below vacuous, so the
// extractor is asserted before it is trusted.

describe('TC-1: worker call extraction', () => {
  it('finds a plausible number of collector calls', () => {
    assert.ok(
      workerCalls.length >= 25,
      `expected >=25 worker collector calls, extracted ${workerCalls.length}`,
    );
  });

  it('contains every route family named in spec.md', () => {
    const expected = [
      'GET /projects/1/workflow',
      'POST /conductor-files',
      'GET /track/1',
      'POST /track/1/lock',
      'POST /track/1/unlock',
      'POST /track/1/prespawn-block',
      'POST /track/1/prespawn-block/reset',
      'GET /track/1/session',
      'POST /tracks/claim-queue',
      'GET /worker/1/dispatch',
      'GET /worker/1/dispatch/claimed',
      'PATCH /worker-dispatch/1',
      'GET /api/projects/1/claimable-tracks',
    ];
    const actual = new Set(workerCalls.map((c) => `${c.method} ${c.path}`));
    const missing = expected.filter((e) => !actual.has(e));
    assert.deepEqual(missing, [], `extractor missed:\n  ${missing.join('\n  ')}`);
  });

  it('excludes non-collector strings and resolves interpolations', () => {
    for (const { path } of workerCalls) {
      assert.ok(path.startsWith('/'), `${path} should be an absolute API path`);
      assert.ok(!path.includes('${'), `${path} still contains an interpolation`);
      assert.ok(!path.includes('?'), `${path} still contains a query string`);
    }
  });

  it('normalizePathLiteral drops the query string and fills interpolations', () => {
    assert.equal(
      normalizePathLiteral('/track/${trackNumber}/prespawn-block?project_id=${projectId}'),
      '/track/1/prespawn-block',
    );
    assert.equal(normalizePathLiteral('/conductor-files'), '/conductor-files');
  });
});

// ── TC-2: the route matcher ───────────────────────────────────────────────────
// Equal segment counts is the load-bearing rule: without it `/worker/register`
// matches `/worker/1/dispatch` and the whole suite passes while the dispatch
// inbox is missing.

describe('TC-2: express route matching', () => {
  it(':param matches exactly one segment', () => {
    assert.equal(expressRouteMatchesPath('/track/:num', '/track/10053'), true);
    assert.equal(expressRouteMatchesPath('/track/:num', '/track/10053/lock'), false);
    assert.equal(expressRouteMatchesPath('/track/:num', '/track'), false);
  });

  it('distinguishes a route from its own sub-path', () => {
    assert.equal(
      expressRouteMatchesPath('/track/:num/prespawn-block', '/track/1/prespawn-block'),
      true,
    );
    assert.equal(
      expressRouteMatchesPath('/track/:num/prespawn-block', '/track/1/prespawn-block/reset'),
      false,
    );
  });

  it('does not let a shorter literal route swallow a longer path', () => {
    assert.equal(expressRouteMatchesPath('/worker/register', '/worker/1/dispatch'), false);
    assert.equal(expressRouteMatchesPath('/worker', '/worker/register'), false);
  });

  it('matches multi-param routes', () => {
    assert.equal(
      expressRouteMatchesPath('/api/projects/:id/tracks/:num', '/api/projects/3/tracks/1010'),
      true,
    );
  });
});

// ── Control: the local collector serves everything the worker calls ───────────
// If this ever fails, the extractor or the matcher is wrong — not the cloud
// function. It keeps a false positive in the tooling from being read as a
// cloud gap.

describe('control: the local collector serves every worker call', () => {
  it('ui/server/index.mjs has no unserved worker calls', () => {
    const unserved = findUnservedCalls(workerCalls, localRoutes);
    assert.deepEqual(
      unserved,
      [],
      `the local server is the reference implementation — an unserved call here means\n` +
        `the extractor/matcher is wrong, not that the route is missing:\n  ${formatUnserved(unserved)}`,
    );
  });
});

// ── TC-3 / TC-4: the actual parity check ──────────────────────────────────────

describe('TC-4: the cloud function serves every worker call', () => {
  it('found a plausible number of cloud routes', () => {
    assert.ok(cloudRoutes.length > 40, `expected >40 cloud routes, got ${cloudRoutes.length}`);
  });

  it('cloud/functions/index.js has no unserved worker calls', () => {
    const unserved = findUnservedCalls(workerCalls, cloudRoutes);
    assert.deepEqual(
      unserved,
      [],
      `A worker in remote-api mode calls these and gets 404 — port them to\n` +
        `cloud/functions/index.js (do not allowlist them):\n  ${formatUnserved(unserved)}`,
    );
  });
});

// ── TC-10: CLAIMABLE_LANES parity ─────────────────────────────────────────────
// conductor/constants.mjs is ESM; cloud/functions/ is CommonJS, so the cloud
// copy cannot import it. This asserts the copy stays in step — adding a lane to
// constants.mjs and not to the cloud function is exactly the drift that made
// `done` silently unclaimable after track 10035 (REQ-8).

describe('TC-10: CLAIMABLE_LANES parity between constants.mjs and the cloud function', () => {
  it('the cloud function declares CLAIMABLE_LANES', () => {
    assert.match(
      cloudSource,
      /const CLAIMABLE_LANES\s*=\s*\[/,
      'cloud/functions/index.js must declare CLAIMABLE_LANES for the claim query',
    );
  });

  it('the cloud copy equals conductor/constants.mjs', () => {
    const m = cloudSource.match(/const CLAIMABLE_LANES\s*=\s*\[([^\]]*)\]/);
    assert.ok(m, 'could not read the cloud CLAIMABLE_LANES literal');
    const cloudLanes = m[1]
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
    assert.deepEqual(
      cloudLanes,
      CLAIMABLE_LANES,
      'cloud CLAIMABLE_LANES has drifted from conductor/constants.mjs',
    );
  });
});
