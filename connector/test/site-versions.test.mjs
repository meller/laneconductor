// The landing page's "Latest versions" line is filled from docs/plugin-versions.json when the page opens (so a release needs no site deploy). This pins the wiring:
// the line has a placeholder for every plugin, starts hidden, reads the generated file from the repository, and that file equals the plugin manifests.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const page = fs.readFileSync(path.join(root, 'landing', 'index.html'), 'utf8');
const placeholders = [...page.matchAll(/<code data-plugin="([a-z-]+)">([^<]*)<\/code>/g)].map((m) => m[1]);
const manifests = fs.readdirSync(path.join(root, 'plugins'))
  .map((d) => path.join(root, 'plugins', d, '.claude-plugin', 'plugin.json'))
  .filter((f) => fs.existsSync(f))
  .map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));

test('landing page: the Latest versions line starts hidden, has a placeholder for every plugin and carries no hard-coded version number', () => {
  assert.ok(manifests.length >= 8, 'the plugin manifests were found');
  assert.match(page, /<p class="hero-install-note" id="latest-versions" hidden>/);
  assert.deepEqual([...placeholders].sort(), manifests.map((m) => m.name).sort(), 'one placeholder per plugin, none for a plugin that does not exist');
  for (const m of page.matchAll(/<code data-plugin="[a-z-]+">([^<]*)<\/code>/g)) assert.ok(!/\d/.test(m[1]), `a placeholder holds no number: ${m[1]}`);
});

test('landing page: the line is filled from the generated versions file of the repository, only with plain version numbers, and a failed read leaves it hidden', () => {
  assert.ok(page.includes("fetch('https://raw.githubusercontent.com/meller/laneconductor/main/docs/plugin-versions.json'"));
  assert.ok(/\^\[0-9\]\+\(\\\.\[0-9\]\+\)\*\$/.test(page), 'only digits and dots are written into the page');
  assert.ok(page.includes('textContent = x') && !/innerHTML\s*=\s*x/.test(page), 'text, never markup');
  assert.ok(page.includes('.catch(function () { /* the line stays hidden */ })'));
});

test('docs/plugin-versions.json is every plugin at its manifest version (generated)', () => {
  const file = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'plugin-versions.json'), 'utf8'));
  assert.deepEqual(file.versions, Object.fromEntries(manifests.map((m) => [m.name, m.version]).sort(([a], [b]) => a.localeCompare(b))));
});
