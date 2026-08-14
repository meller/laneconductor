#!/usr/bin/env node
// conductor/tests/conv-sync-multi-worker-race.test.mjs
//
// Live-reproduced twice in one session (aitutor track 182, 2026-08-14):
// every worker of a project watches the SAME conductor/tracks directory
// (chokidar, ignoreInitial: false), so ONE conversation.md write fires
// syncConversation concurrently in N processes, all racing on the same
// .conv-cursor with no lock:
//   - Three workers each independently parsed the same new turn and
//     POSTed it — three duplicate track_comments rows, same millisecond.
//   - A concurrent cycle read a cursor position that split a multi-line
//     reply mid-body; the fragment matched no known comment format, and
//     the cursor still advanced past it unconditionally — the reply was
//     silently dropped, never reaching track_comments at all.
//
// Fix: a per-track lockfile serializes syncConversation across processes.
// This test spawns TWO real worker processes sharing ONE project
// directory (the actual shape of the incident), appends a new turn once,
// and asserts: exactly one track_comments row for it (no duplicate), and
// its body is the FULL text (nothing dropped as unparsed).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const TMP = join(ROOT, '.test-tmp-conv-sync-race');
const TRACK_DIR = join(TMP, 'conductor/tracks/091-race-track');

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

async function getState(port) {
  const r = await fetch(`http://127.0.0.1:${port}/_state`);
  return r.json();
}

function startWorker(workerNumber) {
  const args = [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only'];
  if (workerNumber !== 1) args.push('--worker-number', String(workerNumber));
  const proc = spawn('node', args, {
    cwd: TMP,
    env: { ...process.env, LC_SKIP_GIT_LOCK: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  return proc;
}

function setupProject(collectorPort) {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TRACK_DIR, { recursive: true });
  writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify({
    mode: 'local-api',
    project: { name: 'conv-race-test', id: 1, repo_path: TMP, primary: { cli: 'mock', model: 'mock' } },
    collectors: [{ url: `http://127.0.0.1:${collectorPort}`, token: null }],
    ui: { port: 8090 },
  }, null, 2));
  writeFileSync(join(TMP, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 }, defaults: { parallel_limit: 3, max_retries: 1 },
  }, null, 2));
  writeFileSync(join(TRACK_DIR, 'index.md'),
    '# Track 091: Race Track\n\n**Lane**: implement\n**Lane Status**: queue\n**Progress**: 0%\n');
  writeFileSync(join(TRACK_DIR, 'conversation.md'), '');
}

describe('conv-sync: concurrent workers watching one conversation.md do not duplicate or drop a turn', () => {
  let collectorProc, collectorPort, w1, w2, w3;

  before(async () => {
    const c = await startMockCollector();
    collectorProc = c.proc;
    collectorPort = c.port;
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });
    setupProject(collectorPort);

    // Three, matching the real incident (aitutor ran three workers in one
    // directory) — two workers can accidentally avoid the race by luck of
    // scheduling; three makes it reliably reproducible.
    w1 = startWorker(1);
    w2 = startWorker(2);
    w3 = startWorker(3);

    await poll(async () => {
      const s = await getState(collectorPort);
      return s.workers.length >= 3 ? s : null;
    }, { label: 'all three workers registered' });

    // Let each worker's initial chokidar scan (ignoreInitial: false) settle
    // and write its own first cursor before we introduce genuinely new
    // content — otherwise the "race" would just be three workers doing
    // their normal, harmless startup scan of the same (empty) file.
    await sleep(1500);
  });

  after(() => {
    w1?.kill(); w2?.kill(); w3?.kill();
    collectorProc?.kill();
    rmSync(TMP, { recursive: true, force: true });
  });

  it('a single new multi-line turn produces exactly one, complete track_comments row', async () => {
    const body = [
      'Paragraph one of a genuinely long reply, long enough that a cursor',
      'landing mid-body during a race would produce a fragment that fails',
      'to match the turn format at all.',
      '',
      'Paragraph two, after a blank line, to also exercise the blank-line',
      'continuation case from the Protocol doc.',
    ].join('\n');
    const quoted = body.split('\n').map(l => l ? `> ${l}` : '>').join('\n');

    // One single write — the real trigger. All three workers' chokidar
    // watchers fire off this SAME filesystem event.
    appendFileSync(join(TRACK_DIR, 'conversation.md'), `> **human**: ${quoted.slice(2)}\n`, 'utf8');

    await poll(async () => {
      const s = await getState(collectorPort);
      return s.comments.some(c => c.track_number === '091') ? s : null;
    }, { timeout: 20000, label: 'the turn reaches track_comments' });

    // Give any would-be duplicate racer a full extra debounce+lock-retry
    // cycle to also land, if the lock isn't actually working.
    await sleep(2000);

    const s = await getState(collectorPort);
    const rows = s.comments.filter(c => c.track_number === '091');
    assert.equal(rows.length, 1,
      `expected exactly one track_comments row for this turn, got ${rows.length} — duplicates mean the lock did not serialize the racing workers`);
    assert.equal(rows[0].body.trim(), body,
      'the synced body must be the FULL original text — any mismatch means a concurrent cycle read a cursor mid-body and either truncated or split it');
  });
});
