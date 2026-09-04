// conductor/services/collector-manifest.mjs
// Track 10061: the collector handshake. Neither server implementation ever
// told a worker what it actually serves, so drift between the worker's
// expectations and a given deployment (stale cloud deploy, missing route
// family — tracks 10052/10053) was silent until a human noticed something
// weird and went digging.
//
// D1 (spec.md): the manifest is derived at request time from each server's
// own live Express router (`buildRouteManifest`), not a hand-kept list. A
// hand-kept list is exactly what let track 10052's WORKER_PATHS silently
// omit `/conductor-files`. This module is the canonical ESM source; Firebase
// deploys `cloud/functions/` standalone (CommonJS, cannot `require` anything
// under `conductor/`), so it is vendored via
// `conductor/scripts/vendor-collector-manifest.mjs` into
// `cloud/functions/collector-manifest.js` — see that script and
// `conductor/tests/track-10061-collector-manifest.test.mjs`'s vendor-freshness
// check (D4).
//
// REQ-2: `compareManifest` never throws. A worker whose collector handshake
// fails, times out, or answers with garbage must still register and run —
// "warn and continue degraded" is the product decision (spec.md), not a
// suggestion.

/**
 * Bumped by hand ONLY when the wire contract changes in a way the route
 * manifest itself cannot express — e.g. a route keeps its name and method
 * but its request/response *shape* changes incompatibly. Do NOT bump this
 * for adding/removing/renaming a route; the route manifest (this module's
 * `buildRouteManifest`) already reports that precisely, and duplicating it
 * here would just be a second hand-kept list under a different name (see
 * D1). A version integer nobody knows when to bump is worse than none, so
 * keep its meaning this narrow.
 */
export const COLLECTOR_API_VERSION = 1;

/**
 * Does an Express route pattern match a concrete request path? Deliberately
 * a local copy of `expressRouteMatchesPath`
 * (`conductor/services/collector-route-parity.mjs`), not an import of it:
 * this module is vendored whole into `cloud/functions/` (D4), and importing
 * a second local module would mean vendoring that one too, and everything
 * *it* imports, growing the vendored surface for no benefit — this
 * predicate is ~10 lines of pure logic, cheap to duplicate, unlike the
 * route lists D1 is actually about.
 *
 * @param {string} route e.g. "/track/:num/lock"
 * @param {string} path  e.g. "/track/1/lock"
 */
function routeMatchesPath(route, path) {
  const routeSegments = route.split('/');
  const pathSegments = path.split('/');
  if (routeSegments.length !== pathSegments.length) return false;
  return routeSegments.every((segment, i) =>
    segment.startsWith(':') ? pathSegments[i].length > 0 : segment === pathSegments[i],
  );
}

/**
 * Reconstruct the literal mount prefix of an `app.use(prefix, router)`
 * layer from Express 4's compiled `layer.regexp`. Express does not keep the
 * original string around, only the regexp it compiled from it — this is the
 * same regexp-unpicking trick `express-list-endpoints` and similar tooling
 * use. Only handles a literal (non-`:param`) mount prefix, which is the only
 * shape any server in this repo actually uses (`app.use('/auth', ...)`,
 * `app.use('/api', ...)`).
 *
 * Returns '' (not throwing) for a prefix this can't confidently reconstruct
 * — better to under-report a manifest than to fabricate a wrong route.
 *
 * @param {*} layer an Express 4 router-mount layer
 * @returns {string}
 */
function extractMountPrefix(layer) {
  if (!layer?.regexp) return '';
  if (layer.regexp.fast_slash) return '';
  try {
    const source = layer.regexp
      .toString()
      .replace(/^\/\^\\?/, '')
      .replace(/\\\/\?\(\?=\\\/\|\$\)\/i?$/, '')
      .replace(/\\\//g, '/');
    return source.startsWith('/') ? source : '';
  } catch {
    return '';
  }
}

/**
 * Derive every `{method, route}` this Express 4 app actually serves, by
 * walking its live router stack — including routes registered on a mounted
 * sub-router (`app.use('/auth', authRouter)`), which the older
 * `extractExpressRouteEntries` static-regex extractor
 * (`conductor/services/firebase-rewrites.mjs`) cannot see (spec D1). Never
 * throws — a stack entry this can't interpret is skipped, not fatal.
 *
 * @param {import('express').Express} app
 * @returns {{method: string, route: string}[]}
 */
export function buildRouteManifest(app) {
  const seen = new Map();

  const walk = (stack, prefix) => {
    if (!Array.isArray(stack)) return;
    for (const layer of stack) {
      try {
        if (layer.route) {
          const routePath = prefix + layer.route.path;
          const methods = Object.keys(layer.route.methods || {}).filter(
            (m) => m !== '_all' && layer.route.methods[m],
          );
          for (const method of methods) {
            const upper = method.toUpperCase();
            seen.set(`${upper} ${routePath}`, { method: upper, route: routePath });
          }
        } else if (layer.name === 'router' && layer.handle?.stack) {
          walk(layer.handle.stack, prefix + extractMountPrefix(layer));
        }
      } catch {
        // Skip anything this layer shape can't be interpreted as — an
        // under-reported manifest is a gap the handshake surfaces as
        // 'missing-routes'; a thrown error here would take the whole
        // /health route down instead.
      }
    }
  };

  walk(app?._router?.stack, '');

  return [...seen.values()].sort(
    (a, b) => a.route.localeCompare(b.route) || a.method.localeCompare(b.method),
  );
}

/** Render manifest entries as sorted, deduped `"METHOD /route"` strings. */
export function formatManifestRoutes(entries) {
  return [...new Set((entries || []).map((e) => `${e.method.toUpperCase()} ${e.route}`))].sort();
}

/**
 * Compare what this worker calls (and its own `COLLECTOR_API_VERSION`)
 * against a collector's `/health` response. REQ-2: never throws — a
 * malformed, empty, or absent manifest yields `severity: 'unknown'`, and
 * `compatible` is always `true`. This function only ever informs; nothing it
 * returns may be used to block registration or a lane action (REQ-16).
 *
 * @param {object} params
 * @param {number} params.workerVersion this worker's own COLLECTOR_API_VERSION
 * @param {{method: string, path: string}[]} params.workerCalls from extractWorkerCalls()
 * @param {*} params.manifest the parsed body of GET /health, or null/malformed
 * @returns {{compatible: boolean, severity: 'ok'|'version-drift'|'missing-routes'|'unknown', apiVersionDelta: number|null, missingRoutes: string[], reason: string|null}}
 */
export function compareManifest({ workerVersion, workerCalls, manifest }) {
  try {
    if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.routes)) {
      return {
        compatible: true,
        severity: 'unknown',
        apiVersionDelta: null,
        missingRoutes: [],
        reason: 'no usable manifest from collector /health',
      };
    }

    const routeEntries = manifest.routes
      .filter((r) => typeof r === 'string' && r.includes(' '))
      .map((r) => {
        const i = r.indexOf(' ');
        return { method: r.slice(0, i), route: r.slice(i + 1) };
      });

    const calls = Array.isArray(workerCalls) ? workerCalls : [];
    const missingRoutes = calls
      .filter(
        (call) =>
          !routeEntries.some(
            (entry) => entry.method === call.method && routeMatchesPath(entry.route, call.path),
          ),
      )
      .map((c) => `${c.method} ${c.path}`);

    const collectorVersion = Number.isInteger(manifest.api_version) ? manifest.api_version : null;
    const apiVersionDelta =
      Number.isInteger(workerVersion) && collectorVersion !== null ? collectorVersion - workerVersion : null;

    if (missingRoutes.length > 0) {
      return {
        compatible: true,
        severity: 'missing-routes',
        apiVersionDelta,
        missingRoutes,
        reason: `collector does not serve ${missingRoutes.length} route(s) this worker calls`,
      };
    }

    if (apiVersionDelta !== null && apiVersionDelta < 0) {
      return {
        compatible: true,
        severity: 'version-drift',
        apiVersionDelta,
        missingRoutes: [],
        reason: `collector reports api_version ${collectorVersion}, worker expects ${workerVersion}`,
      };
    }

    return { compatible: true, severity: 'ok', apiVersionDelta, missingRoutes: [], reason: null };
  } catch (err) {
    return {
      compatible: true,
      severity: 'unknown',
      apiVersionDelta: null,
      missingRoutes: [],
      reason: `handshake comparison failed: ${err.message}`,
    };
  }
}
