#!/usr/bin/env node
// conductor/tests/remote-sync-prefixed-track-folders.test.mjs
//
// Live report (2026-10-08, otralingo): `lc worker sync` logged
// "[remote-sync] Track folder not found for 1126" (and 1127-1137) although
// conductor/tracks/AM-1126-arcade-engine-parrilla/ exists and
// `lc track-dir 1126` resolves it. conductor/remote-sync.mjs carried its own
// legacy folder lookup (bare `NNN-slug` only) instead of the canonical
// resolver (conductor/services/track-folder-fs.mjs, Track 10040 REQ-15 /
// 10063), so every INITIALS-NNN-slug track was silently skipped in the
// DB->file pass.
//
// This runs the real remote-sync.mjs script end to end against the mock
// collector, in a throwaway project dir — never against a real project,
// because a successful remote-sync rewrites conductor/tracks-metadata.json
// and PATCHes the collector.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REMOTE_SYNC = join(__dirname, '..', 'remote-sync.mjs');

function startMockCollector() {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [join(__dirname, 'mock-collector.mjs')], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('mock-collector startup timeout')); }, 5000);
    proc.stdout.on('data', d => {
      out += d.toString();
      const m = out.match(/MOCK_COLLECTOR_PORT=(\d+)/);
      if (m) { clearTimeout(timer); resolve({ proc, port: parseInt(m[1]) }); }
    });
    proc.on('error', reject);
  });
}

async function seedTrack(port, track_number) {
  const r = await fetch(`http://127.0.0.1:${port}/track`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ track_number, lane_status: 'implement', lane_action_status: 'running', progress_percent: 40 }),
  });
  assert.equal(r.status, 200);
}

function writeTrack(projectDir, folderName) {
  const dir = join(projectDir, 'conductor', 'tracks', folderName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.md'), `# Track\n\n**Lane**: plan\n**Lane Status**: queue\n**Progress**: 0%\n**Phase**: New\n`, 'utf8');
}

describe('remote-sync resolves track folders via the canonical resolver', () => {
  let mock;
  let projectDir;
  let output;
  let status;

  before(async () => {
    mock = await startMockCollector();
    projectDir = mkdtempSync(join(tmpdir(), 'lc-remote-sync-prefixed-'));
    writeFileSync(
      join(projectDir, '.laneconductor.json'),
      JSON.stringify({ mode: 'local-api', project: { id: 1, name: 'prefixed-folders' }, collectors: [{ url: `http://127.0.0.1:${mock.port}` }] }),
      'utf8',
    );
    // otralingo's real naming convention, plus a legacy bare folder as a control.
    writeTrack(projectDir, 'AM-1126-arcade-engine-parrilla');
    writeTrack(projectDir, '500-legacy-bare-slug');
    for (const n of ['1126', '500', '9999']) await seedTrack(mock.port, n); // 9999 has no folder on disk

    const res = spawnSync('node', [REMOTE_SYNC], { cwd: projectDir, encoding: 'utf8', timeout: 20000 });
    status = res.status;
    output = `${res.stdout}\n${res.stderr}`;
  });

  after(() => {
    if (mock?.proc) mock.proc.kill('SIGKILL');
    if (projectDir) rmSync(projectDir, { recursive: true, force: true });
  });

  it('exits cleanly', () => {
    assert.equal(status, 0, output);
  });

  it('finds an INITIALS-NNN-slug folder (AM-1126-arcade-engine-parrilla) instead of reporting it missing', () => {
    assert.doesNotMatch(output, /Track folder not found for 1126/, output);
    assert.match(output, /Updated track 1126/, output);
  });

  it('still finds a legacy bare NNN-slug folder', () => {
    assert.doesNotMatch(output, /Track folder not found for 500/, output);
    assert.match(output, /Updated track 500/, output);
  });

  it('still reports a track with genuinely no folder as not found (negative control)', () => {
    assert.match(output, /Track folder not found for 9999/, output);
  });
});
