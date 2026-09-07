// Track 10069 Phase 1 (REQ-13, AC-11): `lc state --json` — local-fs mode.
// Run: node --test conductor/tests/track-10069-lc-state-cli.test.mjs

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const LC = join(ROOT, 'bin/lc.mjs');
const REPO = join(ROOT, '.test-tmp-track-10069-lc-state');

function lc(argv) {
  return execFileSync('node', [LC, ...argv], { cwd: REPO, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

function setupProject() {
  rmSync(REPO, { recursive: true, force: true });
  mkdirSync(join(REPO, 'conductor/tracks/1-first'), { recursive: true });
  mkdirSync(join(REPO, 'conductor/tracks/2-second'), { recursive: true });
  writeFileSync(join(REPO, '.laneconductor.json'), JSON.stringify({
    mode: 'local-fs',
    project: { name: 'lc-state-test', repo_path: REPO, primary: { cli: 'claude' } },
    collectors: [],
  }, null, 2));
  writeFileSync(join(REPO, 'conductor/tracks/1-first/index.md'), '# Track 1\n\n**Lane**: implement\n**Lane Status**: running\n');
  writeFileSync(join(REPO, 'conductor/tracks/2-second/index.md'), '# Track 2\n\n**Lane**: done\n**Lane Status**: success\n');
}

after(() => rmSync(REPO, { recursive: true, force: true }));

test('TC-1.8: lc state --json prints parseable JSON whose track counts match a direct index.md read', () => {
  setupProject();
  const out = lc(['state', '--json']);
  const parsed = JSON.parse(out);

  assert.equal(parsed.projects.length, 1);
  const project = parsed.projects[0];
  assert.deepEqual(project.tracksByLane, { implement: 1, done: 1 });
  assert.ok(Array.isArray(parsed.gaps));
  assert.ok(parsed.generatedAt);
});

test('AC-18/D4: on an instance with zero tracks, no-tracks gap is advisory', () => {
  rmSync(REPO, { recursive: true, force: true });
  mkdirSync(join(REPO, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(REPO, '.laneconductor.json'), JSON.stringify({
    mode: 'local-fs',
    project: { name: 'empty-test', repo_path: REPO, primary: { cli: 'claude' } },
    collectors: [],
  }, null, 2));
  const out = lc(['state', '--json']);
  const parsed = JSON.parse(out);
  const noTracks = parsed.gaps.find(g => g.id === 'no-tracks');
  assert.ok(noTracks);
  assert.equal(noTracks.severity, 'advisory');
});
