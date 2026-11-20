// Track AM-10149 task 2.4: the site serves a real sitemap.xml and robots.txt. Firebase Hosting serves a file in landing/ before the catch-all rewrite, so the files themselves are the fix.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const landing = path.resolve(import.meta.dirname, '..', '..', 'landing');
const read = (f) => fs.readFileSync(path.join(landing, f), 'utf8');

test('landing: sitemap.xml lists only pages that exist, on the real host, and robots.txt allows crawling and points at it', () => {
  const sitemap = read('sitemap.xml');
  assert.match(sitemap, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.ok(locs.length >= 2);
  for (const loc of locs) {
    const u = new URL(loc);
    assert.equal(u.origin, 'https://laneconductor.com', `${loc}: the real host`);
    const file = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
    assert.ok(fs.existsSync(path.join(landing, file)), `${loc} is a page of the site (${file})`);
  }
  const robots = read('robots.txt');
  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Allow: \/$/m);
  assert.ok(!/^Disallow:\s*\/\s*$/m.test(robots), 'the whole site is not blocked');
  assert.match(robots, /^Sitemap: https:\/\/laneconductor\.com\/sitemap\.xml$/m);
});

test('landing: the hosting config ignores neither file (they must be served, ahead of the catch-all rewrite)', () => {
  const cfg = JSON.parse(read('firebase.json')).hosting;
  const ignore = cfg.ignore.join('|');
  assert.ok(!/sitemap|robots/.test(ignore));
  assert.deepEqual(cfg.rewrites.map((r) => r.source), ['**'], 'the catch-all is the only rewrite: files are served before it');
});
