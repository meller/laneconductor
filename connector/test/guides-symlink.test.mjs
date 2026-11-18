// A leftover project-level `.claude/skills/laneconductor` that is a symlink out of the repository (the old install made
// absolute links into the owner's home directory) must not break get_context: the bundled lane guide serves instead.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { connect } from './helpers/mcp.mjs';
import { makeRepo, commitAll, rm } from './helpers/repo.mjs';

const cleanup = [];
const sessions = [];
after(async () => {
  await Promise.all(sessions.map((s) => s.close().catch(() => {})));
  rm(...cleanup);
});

test('a symlinked skill folder pointing outside the repo: get_context serves the bundled guides and does not fail', async () => {
  const outside = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lc-elsewhere-'));
  fs.mkdirSync(path.join(outside, 'lanes'), { recursive: true });
  fs.writeFileSync(path.join(outside, 'lanes', 'plan.md'), '# a plan guide from another checkout\n');
  const dir = makeRepo();
  cleanup.push(dir, outside);
  fs.mkdirSync(path.join(dir, '.claude', 'skills'), { recursive: true });
  fs.symlinkSync(outside, path.join(dir, '.claude', 'skills', 'laneconductor'));
  commitAll(dir, 'fixture: leftover symlink');

  const s = await connect(dir);
  sessions.push(s);
  const manifest = await s.call('get_context');
  assert.equal(manifest.env.ok, true);
  assert.ok(manifest.env.data.lane_guides.every((g) => g.source === 'bundled'), 'every guide is the bundled one');
  const lane = await s.call('get_context', { lane: 'plan' });
  assert.equal(lane.env.ok, true);
  assert.match(lane.env.data.lane_guide.source, /^bundled@/);
  assert.ok(!lane.env.data.lane_guide.advice.includes('another checkout'), 'the outside file is never read');
});
