// conductor/services/firebase-rewrites.mjs
// Track 10052: a minimal model of Firebase Hosting's rewrite glob dialect, so
// `firebase.json`'s routing can be asserted offline instead of discovered in
// production.
//
// The one rule that matters, and the one this project got wrong:
//
//   `**` is a cross-segment globstar ONLY when it is a whole path segment
//   (`/api/**`). Glued to a prefix (`/api**`) it degrades to single-`*`
//   semantics and matches WITHIN one segment only.
//
// That is not a guess. It was confirmed live against production on 2026-09-03
// (see this track's spec.md); the decisive observations, which
// `firebase-rewrites.test.mjs` encodes as tests:
//
//   /api**  vs /apifoo      → MATCH   (Express replied "Cannot GET /apifoo")
//   /api**  vs /api/health  → NO MATCH (Hosting served the SPA index.html)
//
// Scope note: this models the REWRITE table only. Real Hosting serves a
// matching static file before consulting rewrites, so a path like
// `/assets/app.js` never reaches this logic in production even though the
// SPA catch-all would match it here. Don't assert on static asset paths.

/** Characters that must be escaped when a glob literal becomes a regex. */
function escapeRegexLiteral(ch) {
  return /[.*+?^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
}

/**
 * Is the `**` starting at `i` a whole path segment (i.e. a real globstar),
 * rather than one glued to a prefix?
 */
function isWholeSegmentGlobstar(pattern, i) {
  const prevIsBoundary = i === 0 || pattern[i - 1] === '/';
  const next = pattern[i + 2];
  const nextIsBoundary = next === undefined || next === '/';
  return prevIsBoundary && nextIsBoundary;
}

/**
 * Compile a Firebase Hosting rewrite `source` glob to an anchored RegExp.
 */
export function globToRegExp(pattern) {
  let re = '';
  let i = 0;

  while (i < pattern.length) {
    const ch = pattern[i];

    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        // `/api/**` → the preceding '/' is already emitted, so '.*' correctly
        // requires at least the slash and excludes the bare '/api'.
        // A glued `/api**` degrades to '[^/]*' — the bug this module exists for.
        re += isWholeSegmentGlobstar(pattern, i) ? '.*' : '[^/]*';
        i += 2;
      } else {
        re += '[^/]*';
        i += 1;
      }
      continue;
    }

    re += escapeRegexLiteral(ch);
    i += 1;
  }

  return new RegExp(`^${re}$`);
}

/** Does `path` match a single rewrite `source` glob? */
export function matchesGlob(pattern, path) {
  return globToRegExp(pattern).test(path);
}

/**
 * Resolve `path` against an ordered rewrite list, first match wins (Hosting's
 * documented behaviour). Returns the matched rewrite entry, or null.
 */
export function resolveRewrite(rewrites, path) {
  for (const rewrite of rewrites) {
    if (matchesGlob(rewrite.source, path)) return rewrite;
  }
  return null;
}

/**
 * True if `source` contains a `**` that is NOT a whole segment — the defective
 * shape (`/api**`) that silently matches only within one path segment.
 */
export function hasGluedGlobstar(source) {
  for (let i = 0; i < source.length - 1; i += 1) {
    if (source[i] === '*' && source[i + 1] === '*') {
      if (!isWholeSegmentGlobstar(source, i)) return true;
      i += 1;
    }
  }
  return false;
}

/**
 * Extract the Express route paths registered in the cloud function's source.
 * Used to assert that every route the function actually serves is reachable
 * through Hosting — so a newly added route with an uncovered prefix fails the
 * suite instead of 404ing in production.
 */
export function extractExpressRoutes(source) {
  const routes = new Set();
  const re = /\bapp\.(?:get|post|put|patch|delete)\(\s*['"`](\/[^'"`]*)['"`]/g;
  let m;
  while ((m = re.exec(source)) !== null) routes.add(m[1]);
  return [...routes];
}

/** Turn an Express route pattern into a concrete request path. */
export function concreteExamplePath(route) {
  return route.replace(/:([A-Za-z0-9_]+)/g, (_, name) => (name === 'format' ? 'jira' : '1'));
}
