#!/usr/bin/env node
// conductor/tests/track-10036-tracks-metadata-cache.test.mjs
//
// Track 10036: `tracksMetadata` (laneconductor.sync.mjs) used to have only
// one reload path — an assignment inside the API-mode branch of the
// auto-launch setInterval — reached only when a worker was simultaneously
// NOT sync-only, NOT local-fs, below its parallel limit, and its
// pullWorkflow() call succeeded. Any one of those conditions stranded a
// long-lived worker's cache forever: a track created (or its metadata entry
// written) after the worker started would never resolve.
//
// This suite spawns a real worker against a throwaway repo and drives it
// through `conductor/tracks/file_sync_queue.md`'s track-create path
// (`handleTrackCreate`), which is the most directly affected consumer:
// on a stale cache miss it doesn't just fail to resolve, it actively
// scaffolds a DUPLICATE folder next to the real one — the exact live
// incident spec.md documents from track 10035.
//
// The worker in every test here runs `--sync-only`. That is deliberate,
// not incidental: `--sync-only` is the one condition that makes the OLD
// interval-based reload categorically unreachable (see :7419's early
// `return` before the reload line, now :7474) — so any test in this file
// passing is proof the *watch* is doing the work, not the interval.
//
// `loadTracksMetadata`, `getTrackMetadata`, and `resolveTrackFolder` are all
// module-private (laneconductor.sync.mjs exports only
// `normalizeAuthorForComment`), and importing the module boots the entire
// worker — so none of this can be a unit test. Every case here follows
// conductor/tests/track-1119-resolve-track-folder-quarantine.test.mjs's
// pattern: spawn the real worker, drive it through real file changes,
// assert on real on-disk/log side effects.
//
// Run: node --test conductor/tests/track-10036-tracks-metadata-cache.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const TMP = join(ROOT, '.test-tmp-track-10036-tracks-metadata-cache');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function poll(fn, { timeout = 15000, interval = 200, label = '' } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result;
    await sleep(interval);
  }
  throw new Error(`poll timeout (${timeout}ms)${label ? ': ' + label : ''}`);
}

function startMockCollector() {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [join(__dirname, 'mock-collector.mjs')], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    proc.stdout.on('data', d => {
      out += d.toString();
      const m = out.match(/MOCK_COLLECTOR_PORT=(\d+)/);
      if (m) resolve({ proc, port: parseInt(m[1]) });
    });
    proc.stderr.on('data', d => process.stderr.write(`[mock-collector] ${d}`));
    proc.on('error', reject);
    setTimeout(() => reject(new Error('mock-collector startup timeout')), 5000);
  });
}

// Track 1102 F12's outage-simulation endpoint. Used here to suppress the
// worker's OWN `conductor/tracks` folder watch from independently healing
// the cache via syncTrack() -> updateTrackMetadata() when a real folder is
// created — that channel is real and legitimate, but it is NOT the fix
// under test, and left uncontrolled it silently makes the metadata-watch
// scenario pass or fail for the wrong reason (see the seedRealFolderDuringOutage
// comment below for the full explanation).
async function setFailAllWrites(port, durationMs) {
  await fetch(`http://127.0.0.1:${port}/_set-fail-all-writes`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ durationMs }),
  });
}

function setupProject(collectorPort) {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  execSync('git init -q', { cwd: TMP });
  writeFileSync(join(TMP, '.gitignore'), [
    '.conductor/',
    'conductor/logs/',
    '*.log',
    'conductor/tracks-metadata.json',
    'conductor/tracks/**/conversation.md',
    'conductor/tracks/**/conversation.json',
    '.conv-cursor',
    '',
  ].join('\n'));

  writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify({
    mode: 'local-api',
    project: { name: 'test-project', id: 1, repo_path: TMP, primary: { cli: 'mock', model: 'mock' } },
    collectors: [{ url: `http://127.0.0.1:${collectorPort}`, token: null }],
    ui: { port: 8090 },
  }, null, 2));

  mkdirSync(join(TMP, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(TMP, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 },
    defaults: { parallel_limit: 2, max_retries: 1, primary_model: 'mock' },
    lanes: { plan: { parallel_limit: 2, max_retries: 1 } },
  }, null, 2));

  // Cache starts genuinely empty — no entries at all — so the worker's
  // one-time startup load (`tracksMetadata = loadTracksMetadata()`) has
  // nothing to find for any track used below.
  writeFileSync(join(TMP, 'conductor/tracks-metadata.json'), JSON.stringify({
    format: '1.0',
    last_checked: new Date().toISOString(),
    tracks: {},
  }, null, 2));

  writeFileSync(join(TMP, 'conductor/tracks/file_sync_queue.md'), [
    '# File Sync Queue',
    '',
    'Last processed: never',
    '',
    '## Track Creation Requests',
    '',
    '## Completed Queue',
    '',
  ].join('\n'));

  execSync('git add -A', { cwd: TMP });
  execSync('git -c user.email=t@t -c user.name=t commit -q -m "seed fixture"', { cwd: TMP });
  execSync('git branch -M main', { cwd: TMP });
}

// Writes a real, prefixed track folder directly to disk — the modern
// (post track-10023) naming convention that structurally can never match
// resolveTrackFolder's bare `${trackNumber}-` scan, so resolving it is
// ONLY possible via the metadata's registered folder_path.
function seedRealFolder(trackNumber, slug, title) {
  const dir = join(TMP, `conductor/tracks/AM-${trackNumber}-${slug}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.md'), [
    `# Track AM-${trackNumber}: ${title}`,
    '',
    '**Lane**: plan',
    '**Lane Status**: queue',
    '**Progress**: 0%',
    '',
    '## Problem',
    `REAL — the actively-worked folder for track ${trackNumber}.`,
    '',
  ].join('\n'));
  return dir;
}

// Simulates `lc new` / another process writing the registered folder_path
// for a track into tracks-metadata.json — the exact race spec.md
// describes: the metadata write can land strictly after this worker's own
// startup load already happened.
function registerInMetadata(trackNumber, folderPath) {
  const metaPath = join(TMP, 'conductor/tracks-metadata.json');
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  meta.tracks[trackNumber] = {
    folder_path: folderPath,
    last_file_update: new Date().toISOString(),
    synced: true,
  };
  meta.last_checked = new Date().toISOString();
  writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
}

// Enqueues a track-create entry into file_sync_queue.md, in the exact
// format parseFileSyncQueue()/handleTrackCreate() expect — this is what
// forces resolveTrackFolder(tracksDir, trackNumber) to run for a given
// track number without needing any CLI dispatch machinery.
function enqueueTrackCreate(trackNumber, title, description = 'test description') {
  const queuePath = join(TMP, 'conductor/tracks/file_sync_queue.md');
  let content = readFileSync(queuePath, 'utf8');
  const entry = [
    `### Track ${trackNumber}: ${title}`,
    '**Status**: pending',
    '**Type**: track-create',
    `**Created**: ${new Date().toISOString()}`,
    `**Title**: ${title}`,
    `**Description**: ${description}`,
    '**Author**: TEST',
    '',
    '',
  ].join('\n');
  const marker = '## Track Creation Requests';
  const idx = content.indexOf(marker);
  content = content.slice(0, idx + marker.length) + '\n\n' + entry + content.slice(idx + marker.length);
  writeFileSync(queuePath, content, 'utf8');
}

function queueEntryStatus(trackNumber) {
  const queuePath = join(TMP, 'conductor/tracks/file_sync_queue.md');
  const content = readFileSync(queuePath, 'utf8');
  const re = new RegExp(`### Track ${trackNumber}:[^\\n]*\\n\\*\\*Status\\*\\*:\\s*([^\\n]+)`);
  const m = content.match(re);
  return m ? m[1].trim() : null;
}

function listTrackFolders(trackNumber) {
  return readdirSync(join(TMP, 'conductor/tracks'), { withFileTypes: true })
    .filter(d => d.isDirectory() && new RegExp(`(^|-)${trackNumber}(-|$)`).test(d.name))
    .map(d => d.name);
}

describe('tracks-metadata.json cache reload (track 10036)', () => {
  let collectorProc, collectorPort, worker, workerLog;

  before(async () => {
    const c = await startMockCollector();
    collectorProc = c.proc; collectorPort = c.port;
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });
    setupProject(collectorPort);

    workerLog = '';
    // --sync-only: see file header — this is the isolating condition that
    // makes the pre-existing interval reload unreachable.
    worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only'], {
      cwd: TMP,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    worker.stdout.on('data', d => { const s = d.toString(); workerLog += s; process.stdout.write(`[worker] ${s}`); });
    worker.stderr.on('data', d => { const s = d.toString(); workerLog += s; process.stderr.write(`[worker] ${s}`); });

    // Wait for the worker to actually be up (registered with the mock
    // collector) before driving any scenario against it.
    await poll(async () => {
      const s = await (await fetch(`http://127.0.0.1:${collectorPort}/_state`)).json();
      return s.workers.length > 0 ? true : null;
    }, { label: 'worker registers' });
  });

  after(() => {
    worker?.kill();
    collectorProc?.kill();
    rmSync(TMP, { recursive: true, force: true });
  });

  it('TC-1.1/1.2/1.3: resolves a track added to metadata after startup, no restart — instead of scaffolding a duplicate folder', async () => {
    const trackNumber = '5001';

    // Critical to isolating the fix: the worker ALSO self-heals its cache
    // whenever it independently observes a track folder appear under
    // `conductor/tracks` (its own always-on chokidar watch calls
    // syncTrack() -> updateTrackMetadata() on every add/change, which
    // mutates the in-memory cache directly). If we let that channel
    // succeed here, this test would pass regardless of whether the new
    // tracks-metadata.json watch does anything — proven by running this
    // suite once with a naive fixture: it passed even with the watch
    // reverted. To isolate the fix, we suppress that channel by making the
    // collector reject writes while the folder is created (its POST
    // /track throws, so syncTrack's updateTrackMetadata call is never
    // reached — see laneconductor.sync.mjs's syncTrack: updateTrackMetadata
    // sits AFTER the postToCollectors call, inside the same try). Only
    // once that channel has definitely failed do we restore writes and
    // register the entry ourselves directly in tracks-metadata.json —
    // simulating an external actor (another process, `lc new` running
    // elsewhere, a DB->file sync) succeeding where this worker's own
    // attempt didn't. That is spec.md's actual documented scenario: the
    // metadata write lands from somewhere this worker's own per-folder
    // sync never captured.
    await setFailAllWrites(collectorPort, 4000);
    const realDir = seedRealFolder(trackNumber, 'real-track', 'Real Track (registered after worker startup)');
    await poll(async () => workerLog.includes('[sync warning] Failed to post to collector') ? true : null, {
      timeout: 5000,
      label: 'worker\'s own folder-sync attempt fails during the simulated outage — if it silently succeeds instead, this test no longer isolates the fix',
    });
    await setFailAllWrites(collectorPort, 0); // restore normal collector behavior

    // Confirm the outage channel genuinely left the cache stale — belt and
    // braces alongside the log assertion above.
    const metaAfterFailedSync = JSON.parse(readFileSync(join(TMP, 'conductor/tracks-metadata.json'), 'utf8'));
    assert.equal(metaAfterFailedSync.tracks[trackNumber], undefined,
      'precondition: the worker\'s own failed sync attempt must not have registered this track');

    // Simulates the metadata write landing from an external actor, after
    // this worker's own attempt already failed — the exact race in
    // spec.md's Root Cause.
    registerInMetadata(trackNumber, `conductor/tracks/AM-${trackNumber}-real-track`);

    // Give the watch's fs event a moment to be observed and processed
    // (chokidar has no fixed settle time here; poll rather than sleep).
    await sleep(500);

    // Now force resolveTrackFolder(tracksDir, trackNumber) to run, via the
    // file_sync_queue track-create path. Pre-fix, the cache would still be
    // stale and this would scaffold a DUPLICATE `5001-*` folder. Post-fix,
    // the watch already refreshed the cache and the worker recognizes the
    // real folder instead.
    enqueueTrackCreate(trackNumber, 'Real Track (registered after worker startup)');

    await poll(async () => queueEntryStatus(trackNumber) === 'processed' ? true : null,
      { timeout: 20000, label: 'track-create entry processed' });

    // AC-2: resolution found the REAL registered folder, not null (a null
    // result is what the old bug's fallback treated as "doesn't exist").
    const folders = listTrackFolders(trackNumber);
    assert.deepEqual(folders, [`AM-${trackNumber}-real-track`],
      `expected only the real folder to exist, got: ${folders.join(', ')} — a second entry here means a duplicate was scaffolded`);

    // The real folder's own content must be untouched (proof nothing
    // clobbered it, and proof the "already exists" branch — not the
    // scaffold branch — is what ran).
    const realContent = readFileSync(join(realDir, 'index.md'), 'utf8');
    assert.match(realContent, /REAL — the actively-worked folder/);

    assert.match(workerLog, new RegExp(`Track ${trackNumber} folder already exists`),
      'worker log must show the "already exists, skipping folder creation" branch, proving resolveTrackFolder found it');
  });

  it('TC-1.5/REQ-4: a malformed write never clobbers a known-good cache, and recovery still works afterward', async () => {
    const trackNumber = '5002';
    seedRealFolder(trackNumber, 'good-cache', 'Good Cache Track');
    registerInMetadata(trackNumber, `conductor/tracks/AM-${trackNumber}-good-cache`);
    await sleep(500);

    // Establish the cache is good for 5002 first (same mechanism as the
    // test above), consuming one file_sync_queue entry.
    enqueueTrackCreate(trackNumber, 'Good Cache Track');
    await poll(async () => queueEntryStatus(trackNumber) === 'processed' ? true : null,
      { timeout: 20000, label: 'baseline track-create processed' });
    assert.deepEqual(listTrackFolders(trackNumber), [`AM-${trackNumber}-good-cache`]);

    // Now corrupt the file mid-flight — chokidar will fire a 'change'
    // event for this write. loadTracksMetadataStrict() must fail to parse
    // it and return null; the watch handler must then decline to
    // reassign `tracksMetadata`, leaving the last-good cache in memory.
    const metaPath = join(TMP, 'conductor/tracks-metadata.json');
    const goodContent = readFileSync(metaPath, 'utf8');
    writeFileSync(metaPath, '{ "format": "1.0", "tracks": { truncated...');
    await sleep(500);

    assert.match(workerLog, /tracks-metadata\.json reload skipped — parse failed/,
      'worker must log that it declined the bad reload, not silently swallow it');

    // A second track-create for track 5002 (re-enqueued) must STILL
    // recognize the existing real folder — proof the in-memory cache
    // survived the corruption instead of being wiped to {}. If it had
    // been wiped, this would scaffold a duplicate `5002-*` folder.
    enqueueTrackCreate(trackNumber, 'Good Cache Track (re-check)');
    await poll(async () => queueEntryStatus(trackNumber) === 'processed' ? true : null,
      { timeout: 20000, label: 're-check track-create processed after corruption' });
    assert.deepEqual(listTrackFolders(trackNumber), [`AM-${trackNumber}-good-cache`],
      'cache must still resolve the known-good track after a malformed write — no wipe, no duplicate');

    // Recovery (TC-1.7): restore valid JSON with an ADDED entry for a
    // fresh track, and confirm normal reload resumes.
    const trackNumber2 = '5003';
    const goodMeta = JSON.parse(goodContent);
    seedRealFolder(trackNumber2, 'after-recovery', 'After Recovery Track');
    goodMeta.tracks[trackNumber2] = {
      folder_path: `conductor/tracks/AM-${trackNumber2}-after-recovery`,
      last_file_update: new Date().toISOString(),
      synced: true,
    };
    writeFileSync(metaPath, JSON.stringify(goodMeta, null, 2), 'utf8');
    await sleep(500);

    enqueueTrackCreate(trackNumber2, 'After Recovery Track');
    await poll(async () => queueEntryStatus(trackNumber2) === 'processed' ? true : null,
      { timeout: 20000, label: 'post-recovery track-create processed' });
    assert.deepEqual(listTrackFolders(trackNumber2), [`AM-${trackNumber2}-after-recovery`],
      'reload must resume normally once a valid write follows the corrupted one');
  });

  it('TC-1.6/REQ-5: saveTracksMetadata writes atomically — no stray temp file left behind', async () => {
    // handleTrackCreate's scaffold-a-new-folder branch (existingDir===null)
    // ends by calling syncTrack(), which calls updateTrackMetadata() ->
    // saveTracksMetadata() for the freshly-created track — a real,
    // worker-driven write path, not a synthetic one.
    const trackNumber = '5004';
    enqueueTrackCreate(trackNumber, 'Brand New Track (worker-scaffolded)');
    await poll(async () => queueEntryStatus(trackNumber) === 'processed' ? true : null,
      { timeout: 20000, label: 'new-track scaffold processed' });

    const tracksMetaDir = join(TMP, 'conductor');
    const stray = readdirSync(tracksMetaDir).filter(f => f.startsWith('tracks-metadata.json.tmp-'));
    assert.deepEqual(stray, [], `no temp file should survive a save — found: ${stray.join(', ')}`);

    const meta = JSON.parse(readFileSync(join(tracksMetaDir, 'tracks-metadata.json'), 'utf8'));
    assert.ok(meta.tracks[trackNumber], 'the new track must actually be registered after the atomic save');
  });
});
