// conductor/services/json-response.mjs
// Track 10052 Phase 3: one shared JSON content-type guard for the collector
// HTTP client.
//
// Why this exists. Hosting misroutes do not look like failures. When
// firebase.json's rewrites missed a path, Hosting served the SPA's index.html
// with HTTP 200, so `r.ok` was true and the request "succeeded". `get()` had a
// content-type guard and reported it legibly; post/patch/del did not, so the
// failure only surfaced from `r.json()` as:
//
//     SyntaxError: Unexpected token '<', "<!doctype "... is not valid JSON
//
// which blames JSON parsing and says nothing about the URL or the fact that a
// web server answered with a web page. That is a large part of why the rewrite
// bug survived to production. Routing all four verbs through this helper means
// the next misroute names itself.

/**
 * Parse a fetch Response as JSON, failing loudly (and legibly) when the server
 * answered with something else — typically an SPA fallback from a misrouted
 * hosting rewrite.
 *
 * @param {Response} response  the fetch Response
 * @param {string}   url       full request URL, included in the error message
 * @returns {Promise<any>}     the parsed JSON body
 * @throws {Error} naming the URL, the received content type, and a body excerpt
 */
export async function parseJsonResponse(response, url) {
  const contentType = response.headers.get('content-type') || '(none)';

  if (!contentType.includes('application/json')) {
    const text = await response.text();
    throw new Error(
      `Expected JSON from ${url}, got ${contentType} (HTTP ${response.status}). ` +
        `This usually means the request was misrouted — e.g. a Firebase Hosting ` +
        `rewrite missed the path and served the SPA instead of the api function. ` +
        `Body starts: ${text.substring(0, 100)}`,
    );
  }

  return response.json();
}
