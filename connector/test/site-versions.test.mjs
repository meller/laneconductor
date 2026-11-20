// The "Latest versions" line on the landing page must name the version each plugin manifest really has, so it cannot drift after a release.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const page = fs.readFileSync(path.join(root, 'landing', 'index.html'), 'utf8');
const shown = new Map([...page.matchAll(/<code data-plugin="([a-z-]+)">([0-9.]+)<\/code>/g)].map((m) => [m[1], m[2]]));
const manifests = fs.readdirSync(path.join(root, 'plugins'))
  .map((d) => path.join(root, 'plugins', d, '.claude-plugin', 'plugin.json'))
  .filter((f) => fs.existsSync(f))
  .map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));

test('landing page: the Latest versions line lists every plugin at its manifest version', () => {
  assert.ok(manifests.length >= 8, 'the plugin manifests were found');
  for (const m of manifests) assert.equal(shown.get(m.name), m.version, `${m.name}: the page says ${shown.get(m.name)}, the manifest says ${m.version}`);
  assert.equal(shown.size, manifests.length, 'the page names no plugin that does not exist');
});
