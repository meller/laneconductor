// conductor/tests/track-10084-sync-meta-defaults-e2e.test.mjs
// Track 10084 Phase 2: real worker process, confirming
// laneconductor.sync.mjs's config-cascade wiring actually resolves
// project.primary.cli/.model through the meta-defaults tier (REQ-2), per
// spec.md's TC-2.1/TC-2.2/TC-2.3.
//
// Deliberately places its fixture directory under os.tmpdir(), NOT under
// this repo's own ROOT — a fixture nested inside a track worktree with no
// own `git init` gets silently redirected by resolveConfigRoot to read
// config from the REAL PRIMARY checkout instead of the fixture (see
// track 10082's documented hazard; track-1111-model-precedence.test.mjs's
// `.test-tmp-*` fixture hits exactly this). os.tmpdir() is never inside any
// git repository, so resolvePrimaryRepoRoot() throws and configRoot
// correctly falls back to the fixture's own cwd.
//
// Also uses LC_META_DEFAULTS_PATH (this track's own new override seam) to
// point at a fixture file instead of the real, machine-global meta project
// — avoids ever touching real $HOME state.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

let TMP;

function setupFixture({ projectPrimary, metaPrimary, inheritMetaDefaults } = {}) {
  TMP = mkdtempSync(join(tmpdir(), 'lc-10084-e2e-'));
  mkdirSync(join(TMP, 'conductor/tracks'), { recursive: true });

  const projectConfig = {
    mode: 'local-fs',
    project: {
      name: 'test-project-10084', id: 1, repo_path: TMP,
      ...(projectPrimary ? { primary: projectPrimary } : {}),
      ...(inheritMetaDefaults !== undefined ? { inherit_meta_defaults: inheritMetaDefaults } : {}),
    },
    collectors: [],
    ui: { port: 8090 },
  };
  writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify(projectConfig, null, 2));

  const metaDefaultsPath = join(TMP, 'meta-defaults.json');
  writeFileSync(metaDefaultsPath, JSON.stringify({
    project: { primary: metaPrimary || {} },
  }, null, 2));

  return metaDefaultsPath;
}

function startWorker(metaDefaultsPath) {
  return spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs')], {
    cwd: TMP,
    env: {
      ...process.env,
      LC_META_DEFAULTS_PATH: metaDefaultsPath,
      LC_SKIP_WORKER_LOCK: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function captureConfigLogLine(metaDefaultsPath) {
  const worker = startWorker(metaDefaultsPath);
  let output = '';
  worker.stdout.on('data', d => { output += d.toString(); });
  worker.stderr.on('data', d => { output += d.toString(); });
  try {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const match = output.match(/\[config\] mode "[^"]*" with primary ([^\s/]+)(?:\/(\S+))?/);
      if (match) return { cli: match[1], model: match[2] === '(default' ? null : match[2] };
      await new Promise(r => setTimeout(r, 200));
    }
    throw new Error(`config log line not seen within timeout. Output so far:\n${output}`);
  } finally {
    worker.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 300));
  }
}

after(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

test('TC-2.1: project with no primary.cli of its own inherits the meta default', async () => {
  const metaDefaultsPath = setupFixture({ metaPrimary: { cli: 'claude' } });
  const { cli } = await captureConfigLogLine(metaDefaultsPath);
  assert.equal(cli, 'claude');
});

test('TC-2.2: project\'s own primary.cli wins over the meta default', async () => {
  const metaDefaultsPath = setupFixture({
    projectPrimary: { cli: 'antigravity' },
    metaPrimary: { cli: 'claude' },
  });
  const { cli } = await captureConfigLogLine(metaDefaultsPath);
  assert.equal(cli, 'antigravity');
});

test('TC-2.3: inherit_meta_defaults: false skips the meta tier even when it has a (different) value', async () => {
  // Meta default is deliberately NOT 'claude' (the hardcoded fallback) so a
  // bug that ignored the opt-out flag would be caught, not accidentally pass.
  const metaDefaultsPath = setupFixture({
    metaPrimary: { cli: 'antigravity' },
    inheritMetaDefaults: false,
  });
  const { cli } = await captureConfigLogLine(metaDefaultsPath);
  assert.equal(cli, 'claude'); // hardcoded fallback, not the meta tier's 'antigravity'
});
