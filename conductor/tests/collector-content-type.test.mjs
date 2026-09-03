#!/usr/bin/env node
// conductor/tests/collector-content-type.test.mjs
// Track 10052 Phase 3: the collector HTTP client must report a misrouted
// request as a misroute, not as a JSON syntax error.
//
// Before this, only get() guarded the response content type. A Firebase
// Hosting rewrite miss returns the SPA's index.html with HTTP 200, so
// post/patch/del passed the `r.ok` check and then blew up inside r.json() as
// "SyntaxError: Unexpected token '<'" — a message that names neither the URL
// nor the fact that a web page came back. That cost real debugging time.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseJsonResponse } from '../services/json-response.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const SPA_HTML = '<!doctype html>\n<html lang="en">\n<head><title>LaneConductor</title></head>\n<body><div id="root"></div></body>\n</html>';

/** A stand-in for Hosting serving the SPA fallback on a misrouted API path. */
let server;
let baseUrl;

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url.startsWith('/spa-fallback')) {
      // Exactly what the misroute looked like in production: 200 + text/html.
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(SPA_HTML);
      return;
    }
    if (req.url.startsWith('/no-content-type')) {
      res.writeHead(200);
      res.end(SPA_HTML);
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, method: req.method }));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

/** Mirrors exactly what get/post/patch/del do after the `r.ok` check. */
async function requestJson(method, path) {
  const url = `${baseUrl}${path}`;
  const init = { method };
  if (method !== 'GET' && method !== 'DELETE') {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify({ hello: 'world' });
  }
  const response = await fetch(url, init);
  return parseJsonResponse(response, url);
}

describe('every verb rejects an SPA fallback legibly', () => {
  // TC-14 (POST), TC-15 (PATCH), TC-16 (DELETE), plus GET for completeness.
  for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
    it(`TC-14/15/16: ${method} against a 200 text/html response throws a named error`, async () => {
      await assert.rejects(
        () => requestJson(method, '/spa-fallback'),
        (err) => {
          assert.ok(
            err.message.includes('/spa-fallback'),
            `error must name the URL, got: ${err.message}`,
          );
          assert.ok(
            err.message.includes('text/html'),
            `error must name the received content type, got: ${err.message}`,
          );
          assert.ok(
            !/Unexpected token/i.test(err.message),
            `error must not be a raw JSON syntax error, got: ${err.message}`,
          );
          return true;
        },
      );
    });
  }

  it('mentions the likely cause so the next misroute is self-diagnosing', async () => {
    await assert.rejects(
      () => requestJson('POST', '/spa-fallback'),
      (err) => /rewrite|misrouted/i.test(err.message),
    );
  });

  it('a response with no content-type at all is also rejected', async () => {
    await assert.rejects(
      () => requestJson('POST', '/no-content-type'),
      (err) => err.message.includes('Expected JSON'),
    );
  });
});

describe('valid JSON still passes through unchanged', () => {
  // TC-18 — the guard must not break the happy path for any verb.
  for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
    it(`TC-18: ${method} against application/json returns the parsed body`, async () => {
      const body = await requestJson(method, '/ok');
      assert.deepEqual(body, { ok: true, method });
    });
  }
});

describe('the collector client is actually wired to the guard', () => {
  // TC-17 + structural regression guard. The helper is worthless if a verb
  // quietly goes back to calling r.json() directly.
  const source = readFileSync(join(repoRoot, 'conductor/laneconductor.sync.mjs'), 'utf8');

  it('imports the shared guard', () => {
    assert.match(source, /import \{ parseJsonResponse \} from '\.\/services\/json-response\.mjs'/);
  });

  it('TC-17: all four verbs route their body parse through parseJsonResponse', () => {
    const clientSection = source.slice(
      source.indexOf('// ── Collector HTTP client'),
      source.indexOf('Execute Integration Hooks'),
    );
    assert.ok(clientSection.length > 0, 'could not locate the collector HTTP client section');

    const guarded = clientSection.match(/return parseJsonResponse\(r, url\);/g) || [];
    assert.equal(
      guarded.length,
      4,
      `expected get/post/patch/del to all use the guard, found ${guarded.length}`,
    );
  });

  it('no verb calls r.json() directly any more', () => {
    const clientSection = source.slice(
      source.indexOf('// ── Collector HTTP client'),
      source.indexOf('Execute Integration Hooks'),
    );
    const bare = clientSection.match(/return r\.json\(\);/g) || [];
    assert.deepEqual(bare, [], 'a verb regressed to an unguarded r.json()');
  });
});
