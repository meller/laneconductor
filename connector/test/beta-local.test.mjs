// Phase 6, the scriptable parts of the local beta scenarios (test.md B-c, B-d, B-e), run against
// throwaway repos in os.tmpdir() through the real stdio server. The scenarios that need a real
// Claude session (B-a, B-f), the scratch project and beta_start stay HUMAN steps.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { Client } from '@modelcontextprotocol/client';
import { connect, BIN } from './helpers/mcp.mjs';
import { makeRepo, git, readFile, addRemote, rm } from './helpers/repo.mjs';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const cleanup = [];
const sessions = [];
after(async () => {
  await Promise.all(sessions.map((s) => s.close().catch(() => {})));
  rm(...cleanup);
});
const fixture = () => {
  const dir = makeRepo({ files: { 'conductor/product.md': '# Product\n\nA scratch project.\n' } });
  cleanup.push(dir);
  return dir;
};
const open = async (dir, opts) => {
  const s = await connect(dir, opts);
  sessions.push(s);
  return s;
};
const remoteHead = (bare) => execFileSync('git', ['--git-dir', bare, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();

// B-c (local half)
test('B-c: two local state commits that were never pushed make a read say possibly_stale with unpushed_local_commits', async () => {
  const dir = fixture();
  const bare = addRemote(dir);
  cleanup.push(bare);
  const pushed = remoteHead(bare);
  const s = await open(dir);
  const clean = await s.call('list_tracks');
  assert.ok(!clean.env.provenance.stale_reasons.includes('unpushed_local_commits'));

  const c = await s.call('create_track', { title: 'Report export', problem: 'Export the report as CSV.' });
  const u = await s.call('update_track', { track: c.env.data.track.id, base: c.env.data.base, files: { plan: '# Plan\n\n1. do it\n' } });
  assert.equal(u.isError, false, u.text);

  const other = await open(dir); // a second, fresh session reading the same checkout
  const r = await other.call('get_track', { track: c.env.data.track.id });
  const p = r.env.provenance;
  assert.equal(p.freshness, 'possibly_stale');
  assert.ok(p.stale_reasons.includes('unpushed_local_commits'));
  assert.equal(p.upstream.ahead, 2);
  assert.equal(p.upstream.behind, 0);
  assert.match(r.text.split('\n')[0], /ahead 2, behind 0/);
  assert.match(r.text.split('\n')[0], /Freshness: possibly_stale \(.*unpushed_local_commits/);
  assert.equal(p.commit, git(dir, 'rev-parse', 'HEAD'));
  assert.equal(remoteHead(bare), pushed, 'the connector pushed nothing');
});

// B-d (local half)
test('B-d: two sessions edit plan.md from the same base; the second gets CONFLICT and the file holds the first edit byte for byte', async () => {
  const dir = fixture();
  const a = await open(dir);
  const b = await open(dir);
  const c = await a.call('create_track', { title: 'Shared plan', problem: 'Two writers.' });
  const track = c.env.data.track;
  const ra = await a.call('get_track', { track: track.id });
  const rb = await b.call('get_track', { track: track.id });
  assert.deepEqual(ra.env.data.base.files, rb.env.data.base.files);
  const FIRST = '# Plan\n\nfirst writer: café, tabs\tand trailing spaces  \n';
  const w1 = await a.call('update_track', { track: track.id, base: ra.env.data.base, files: { plan: FIRST } });
  assert.equal(w1.isError, false, w1.text);
  const w2 = await b.call('update_track', { track: track.id, base: rb.env.data.base, files: { plan: '# Plan\n\nsecond writer\n' } });
  assert.equal(w2.isError, true);
  assert.equal(w2.env.error.code, 'CONFLICT');
  assert.equal(w2.env.error.details[0].file, 'plan');
  const rel = `conductor/tracks/${track.folder}/plan.md`;
  assert.equal(readFile(dir, rel), FIRST);
  assert.equal(git(dir, 'show', `HEAD:${rel}`), FIRST.trimEnd());
  assert.equal(execFileSync('git', ['-C', dir, 'show', `HEAD:${rel}`]).toString('utf8'), FIRST, 'byte for byte');
});

test('B-d: simultaneous writers from one base, repeated: exactly one wins every round and the file is the winner\'s', async () => {
  const dir = fixture();
  const a = await open(dir);
  const b = await open(dir);
  const c = await a.call('create_track', { title: 'Race plan', problem: 'Race.' });
  const track = c.env.data.track;
  const rel = `conductor/tracks/${track.folder}/plan.md`;
  for (let i = 0; i < 5; i++) {
    const base = (await a.call('get_track', { track: track.id })).env.data.base;
    const [ra, rb] = await Promise.all([
      a.call('update_track', { track: track.id, base, files: { plan: `round ${i} from A\n` } }),
      b.call('update_track', { track: track.id, base, files: { plan: `round ${i} from B\n` } }),
    ]);
    const winners = [ra, rb].filter((r) => !r.isError);
    const losers = [ra, rb].filter((r) => r.isError);
    assert.equal(winners.length, 1, `round ${i}`);
    assert.equal(losers[0].env.error.code, 'CONFLICT');
    assert.equal(readFile(dir, rel), ra.isError ? `round ${i} from B\n` : `round ${i} from A\n`);
  }
});

// B-e
test('B-e: the whole local flow works with no database and no daemon: unreachable Postgres settings, no sockets, no DB or network code in the connector', async () => {
  const dir = fixture();
  const noDb = { PGHOST: '127.0.0.1', PGPORT: '1', PGCONNECT_TIMEOUT: '1', DATABASE_URL: 'postgres://nobody:none@127.0.0.1:1/none', LANECONDUCTOR_DB_URL: 'postgres://nobody:none@127.0.0.1:1/none', HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1' };
  const transport = new StdioClientTransport({ command: process.execPath, args: [BIN, '--repo', dir], env: { ...process.env, ...noDb }, stderr: 'pipe' });
  const client = new Client({ name: 'b-e', version: '0.0.0' });
  await client.connect(transport);
  const call = async (name, args) => (await client.callTool({ name, arguments: args })).structuredContent;
  try {
    const c = await call('create_track', { title: 'No database', problem: 'Runs on files.' });
    assert.equal(c.ok, true, JSON.stringify(c.error));
    const u = await call('update_track', { track: c.data.track.id, base: c.data.base, markers: { 'Lane Status': 'running' } });
    assert.equal(u.ok, true);
    assert.equal((await call('append_conversation', { track: c.data.track.id, author: 'claude', body: 'hello' })).ok, true);
    assert.equal((await call('list_tracks', {})).ok, true);
    assert.equal((await call('get_context', { lane: 'plan' })).ok, true);
    assert.equal((await call('health_report', {})).ok, true);
    // the server process holds no sockets besides its stdio (fds 0-2), so there is no DB or network connection
    const pid = transport.pid;
    const sockets = fs.readdirSync(`/proc/${pid}/fd`).filter((fd) => Number(fd) > 2).filter((fd) => fs.readlinkSync(`/proc/${pid}/fd/${fd}`).startsWith('socket:'));
    assert.deepEqual(sockets, []);
    // and none of its children is a sync daemon or a worker
    const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
    assert.doesNotMatch(cmdline, /laneconductor\.sync/);
  } finally {
    await client.close().catch(() => {});
  }
  const files = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : files.push(path.join(d, e.name))));
  walk(SRC);
  for (const f of files) {
    // board-page.html is a static asset the server never executes: it runs in the viewer's browser and fetches its own board.json.
    if (f.endsWith('.html')) continue;
    const text = fs.readFileSync(f, 'utf8');
    const rel = path.relative(SRC, f);
    assert.doesNotMatch(text, /from '(pg|postgres|node:net|node:http|node:https|node:dns|node:tls)'|laneconductor\.sync|\bfetch\(/, `${rel} must not touch a database or the network`);
  }
});
