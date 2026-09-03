// conductor/services/collector-route-parity.mjs
// Track 10053: does every collector endpoint the sync worker calls actually
// exist in the cloud function?
//
// Track 10052 fixed Hosting's rewrite globs, so API paths now *reach* the `api`
// function. That exposed the next layer of the same class of bug: the function
// doesn't implement most of what the worker calls. Reaching a function that
// 404s is not better than not reaching it.
//
// The check has to derive the worker's call list from the worker's own source,
// not from a list maintained by hand. A hand-kept list is exactly what let this
// gap ship — `conductor/tests/firebase-rewrites.test.mjs`'s WORKER_PATHS was
// hand-written and silently missing `/conductor-files`, so its suite was green
// while that path was unreachable.
//
// Scope: `conductor/laneconductor.sync.mjs` is the only file that speaks to a
// collector (verified — the sole other `fetch()` under conductor/services/ is
// jira-auth.mjs, which talks to Jira). If that changes, add the file here.

/**
 * Path-position literals in the worker's HTTP helpers. Their signatures are
 * `get|post|patch|del(collectorUrl, token, path, ...)` — path is the third
 * argument, after two plain identifiers — and
 * `postToCollectors|patchCollectors(path, body)`, where it is the first.
 *
 * Anchoring on the call site (rather than scanning for anything that looks
 * path-shaped) is what keeps documentation paths in comments and unrelated
 * filesystem strings out of the result.
 */
const HELPER_METHODS = { get: 'GET', post: 'POST', patch: 'PATCH', del: 'DELETE' };
const FANOUT_METHODS = { postToCollectors: 'POST', patchCollectors: 'PATCH' };

const THIRD_ARG_CALL =
  /\b(get|post|patch|del)\s*\(\s*[A-Za-z_$][\w$.]*\s*,\s*[A-Za-z_$][\w$.]*\s*,\s*(['"`])(\/[^'"`]*)\2/g;
const FIRST_ARG_CALL =
  /\b(postToCollectors|patchCollectors)\s*\(\s*(['"`])(\/[^'"`]*)\2/g;

/**
 * Turn a path literal as written in the worker into a concrete request path:
 * drop any query string, and substitute every `${...}` interpolation with a
 * placeholder segment. The substituted value only has to be *a* segment — the
 * matcher below compares structurally, so `1` stands in for a track number, a
 * project id, or a worker id equally well.
 *
 * @param {string} literal e.g. "/track/${trackNumber}/lock"
 * @returns {string} e.g. "/track/1/lock"
 */
export function normalizePathLiteral(literal) {
  const [pathOnly] = literal.split('?');
  return pathOnly.replace(/\$\{[^}]*\}/g, '1');
}

/**
 * Every collector endpoint the worker calls, as `{method, path}`, deduped and
 * sorted. Method matters: `/track/:num/session` is called with all three of
 * GET, POST and DELETE, and porting one verb must not read as porting the
 * family.
 *
 * @param {string} workerSource contents of conductor/laneconductor.sync.mjs
 * @returns {{method: string, path: string}[]}
 */
export function extractWorkerCalls(workerSource) {
  const seen = new Map();

  const collect = (re, methodTable, methodGroup, literalGroup) => {
    let m;
    while ((m = re.exec(workerSource)) !== null) {
      const method = methodTable[m[methodGroup]];
      const path = normalizePathLiteral(m[literalGroup]);
      seen.set(`${method} ${path}`, { method, path });
    }
  };

  collect(new RegExp(THIRD_ARG_CALL), HELPER_METHODS, 1, 3);
  collect(new RegExp(FIRST_ARG_CALL), FANOUT_METHODS, 1, 3);

  return [...seen.values()].sort(
    (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
  );
}

/**
 * Does an Express route pattern match a concrete request path? Segment-wise:
 * a `:param` segment matches exactly one segment of anything, a literal
 * segment must match exactly, and the segment counts must be equal.
 *
 * Equal segment counts is the part that matters. Without it `/worker/register`
 * would "match" `/worker/1/dispatch`, and the whole check would pass while the
 * dispatch inbox stayed missing.
 *
 * @param {string} route e.g. "/track/:num/lock"
 * @param {string} path  e.g. "/track/1/lock"
 */
export function expressRouteMatchesPath(route, path) {
  const routeSegments = route.split('/');
  const pathSegments = path.split('/');
  if (routeSegments.length !== pathSegments.length) return false;
  return routeSegments.every((segment, i) =>
    segment.startsWith(':') ? pathSegments[i].length > 0 : segment === pathSegments[i],
  );
}

/**
 * The worker calls that no route in `routeEntries` serves.
 *
 * @param {{method: string, path: string}[]} workerCalls from extractWorkerCalls
 * @param {{method: string, route: string}[]} routeEntries from extractExpressRouteEntries
 * @returns {{method: string, path: string}[]} unserved calls, in input order
 */
export function findUnservedCalls(workerCalls, routeEntries) {
  return workerCalls.filter(
    (call) =>
      !routeEntries.some(
        (entry) =>
          entry.method === call.method && expressRouteMatchesPath(entry.route, call.path),
      ),
  );
}

/** Render unserved calls for an assertion message. */
export function formatUnserved(unserved) {
  return unserved.map((c) => `${c.method} ${c.path}`).join('\n  ');
}
