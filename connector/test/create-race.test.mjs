// REQ-15 / TC-2.7: number allocation under races, in-process (a wrapper around the real LocalGitStore).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { LocalGitStore } from '../src/store-local.mjs';
import { createContext } from '../src/server.mjs';
import { runTool } from '../src/envelope.mjs';
import { createTrack } from '../src/tools/create-track.mjs';
import { TOOLS } from '../src/tools/index.mjs';
import { makeRepo, writeFile, rm, INDEX } from './helpers/repo.mjs';
import { connect } from './helpers/mcp.mjs';

const cleanup = [];
after(() => rm(...cleanup));

test('a folder that appears with the chosen number mid-allocation causes a retry to the next number', async () => {
  const dir = makeRepo();
  cleanup.push(dir);
  const real = new LocalGitStore({ repo: dir });
  let sabotaged = false;
  // First commit attempt: someone else creates XX-1-race (same number AND slug) just before our write.
  const store = Object.create(real, {
    transaction: {
      value: (fn) => real.transaction((tx) => fn({
        ...tx,
        commitFiles: async (req) => {
          if (!sabotaged) {
            sabotaged = true;
            for (const c of req.changes) writeFile(dir, c.path, 'someone else was here\n');
          }
          return tx.commitFiles(req);
        },
      })),
    },
  });
  const ctx = createContext({ stores: [store], version: 'test' });
  const r = await runTool(createTrack, ctx, { title: 'Race', problem: 'p' });
  assert.equal(r.isError, undefined, r.content[0].text);
  assert.equal(sabotaged, true);
  assert.equal(r.structuredContent.data.track.folder, 'XX-2-race', 'retried to the next number');
});

test('three lost races give NUMBER_COLLISION', async () => {
  const dir = makeRepo();
  cleanup.push(dir);
  const real = new LocalGitStore({ repo: dir });
  const store = Object.create(real, {
    transaction: { value: (fn) => real.transaction((tx) => fn({ ...tx, commitFiles: async () => ({ ok: false, conflict: [{ path: 'x', expected: null, actual: 'abc' }] }) })) },
  });
  const r = await runTool(createTrack, createContext({ stores: [store], version: 'test' }), { title: 'Never', problem: 'p' });
  assert.equal(r.isError, true);
  assert.equal(r.structuredContent.error.code, 'NUMBER_COLLISION');
});

test('upstream folders count toward the next number', async () => {
  const dir = makeRepo();
  cleanup.push(dir);
  const real = new LocalGitStore({ repo: dir });
  const store = Object.create(real, {
    transaction: { value: (fn) => real.transaction((tx) => fn({ ...tx, upstreamDirs: async () => ['AM-40-remote-only'] })) },
  });
  const r = await runTool(createTrack, createContext({ stores: [store], version: 'test' }), { title: 'After remote', problem: 'p' });
  assert.equal(r.structuredContent.data.track.folder, 'XX-41-after-remote');
});

test('two server processes creating tracks at the same time get distinct numbers, all committed', async () => {
  const dir = makeRepo();
  cleanup.push(dir);
  writeFile(dir, 'conductor/tracks/AM-10-seed/index.md', INDEX(10, 'Seed'));
  const a = await connect(dir);
  const b = await connect(dir);
  try {
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => (i % 2 ? a : b).call('create_track', { title: `Parallel ${i}`, problem: 'p' })),
    );
    for (const r of results) assert.equal(r.isError, false, r.text);
    const nums = results.map((r) => r.env.data.track.number).sort((x, y) => x - y);
    assert.deepEqual(nums, [11, 12, 13, 14, 15, 16]);
  } finally {
    await a.close();
    await b.close();
  }
});

test('tools export is the v0 set and handlers carry no SDK imports', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'src');
  assert.deepEqual(TOOLS.map((t) => t.name), ['list_tracks', 'get_track', 'get_context', 'health_report', 'create_track', 'update_track', 'append_conversation', 'report_outcome', 'help']);
  for (const f of [...fs.readdirSync(path.join(dir, 'tools')).map((n) => path.join('tools', n)), 'envelope.mjs', 'provenance.mjs', 'store-local.mjs']) {
    assert.doesNotMatch(fs.readFileSync(path.join(dir, f), 'utf8'), /@modelcontextprotocol/, `${f} must stay SDK-agnostic`);
  }
});
