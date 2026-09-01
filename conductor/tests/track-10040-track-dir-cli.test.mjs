// Track 10040 Phase 3 (REQ-15): `lc track-dir <n>` — a real subprocess
// invocation against a throwaway fixture directory, proving the CLI is
// genuinely read-only (byte-identical dir listing before/after, no
// tracks-metadata.json write) and resolves both naming conventions.

import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const LC_BIN = join(process.cwd(), 'bin', 'lc.mjs');

function makeFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'lc-track-dir-test-'));
  mkdirSync(join(dir, 'conductor', 'tracks'), { recursive: true });
  return dir;
}

function runTrackDir(fixtureDir, args = []) {
  try {
    const out = execFileSync('node', [LC_BIN, 'track-dir', ...args], { cwd: fixtureDir, encoding: 'utf8' });
    return { code: 0, stdout: out.trim() };
  } catch (err) {
    return { code: err.status ?? 1, stdout: (err.stdout || '').trim(), stderr: (err.stderr || '').trim() };
  }
}

// A prefixed folder (AM-NNN-slug) only resolves via tracks-metadata.json's
// registration — the bare `${trackNumber}-` prefix scan structurally can't
// match it (that's the whole reason it's a separate convention). newTrack
// always writes this registration; a fixture must mirror that.
function registerMetadata(dir, trackNumber, folder) {
  writeFileSync(
    join(dir, 'conductor', 'tracks-metadata.json'),
    JSON.stringify({ format: '1.0', tracks: { [trackNumber]: { folder_path: `conductor/tracks/${folder}` } } }),
    'utf8'
  );
}

test('TC-89: resolves a prefixed folder via metadata registration, exit 0', () => {
  const dir = makeFixture();
  try {
    mkdirSync(join(dir, 'conductor', 'tracks', 'AM-10040-slug'));
    registerMetadata(dir, '10040', 'AM-10040-slug');
    const r = runTrackDir(dir, ['10040']);
    assert.equal(r.code, 0);
    assert.equal(r.stdout, join('conductor', 'tracks', 'AM-10040-slug'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('TC-90 (read-only guarantee): a fixture with a would-be-quarantined duplicate is untouched', () => {
  const dir = makeFixture();
  try {
    mkdirSync(join(dir, 'conductor', 'tracks', '10040-slug-a'));
    mkdirSync(join(dir, 'conductor', 'tracks', '10040-slug-b'));
    const before = readdirSync(join(dir, 'conductor', 'tracks')).sort();
    const metadataBefore = existsSync(join(dir, 'conductor', 'tracks-metadata.json'));

    const r = runTrackDir(dir, ['10040']);
    assert.equal(r.code, 0);

    const after = readdirSync(join(dir, 'conductor', 'tracks')).sort();
    assert.deepEqual(after, before, 'directory listing must be byte-identical — nothing renamed');
    assert.equal(existsSync(join(dir, 'conductor', 'tracks-metadata.json')), metadataBefore, 'tracks-metadata.json must not be created/modified by a read-only lookup');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('TC-91: unknown track number — non-zero exit, diagnostic on stderr, nothing on stdout', () => {
  const dir = makeFixture();
  try {
    const r = runTrackDir(dir, ['999999']);
    assert.notEqual(r.code, 0);
    assert.equal(r.stdout, '', 'stdout must never contain something a caller could mistake for a path');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('TC-92: --json output parses and agrees with the plain-text form', () => {
  const dir = makeFixture();
  try {
    mkdirSync(join(dir, 'conductor', 'tracks', 'AM-10040-slug'));
    registerMetadata(dir, '10040', 'AM-10040-slug');
    const plain = runTrackDir(dir, ['10040']);
    const json = runTrackDir(dir, ['10040', '--json']);
    assert.equal(plain.code, 0);
    assert.equal(json.code, 0);
    const parsed = JSON.parse(json.stdout);
    assert.equal(parsed.folder, plain.stdout);
    assert.equal(typeof parsed.matches, 'number');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('legacy-only convention still resolves (unchanged common case)', () => {
  const dir = makeFixture();
  try {
    mkdirSync(join(dir, 'conductor', 'tracks', '10040-legacy-slug'));
    const r = runTrackDir(dir, ['10040']);
    assert.equal(r.code, 0);
    assert.equal(r.stdout, join('conductor', 'tracks', '10040-legacy-slug'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
