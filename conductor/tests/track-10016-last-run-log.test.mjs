#!/usr/bin/env node
// conductor/tests/track-10016-last-run-log.test.mjs
// Track 10016: two static/fast guards that complement the real spawned-worker
// coverage in conductor/tests/track-1102-f9b-log-staging.test.mjs (which
// exercises the actual write/no-stage/no-warning behavior end to end):
//
// TC-1: `workDir` stays hoisted above both the `if (lastRunLog)` and
//       `if (updated)` blocks in spawnCli's exit handler, and isn't
//       redeclared inside either — guards against the original track 1102
//       F9b scoping defect (ReferenceError, swallowed by an empty catch)
//       coming back in a future refactor.
// TC-6: conductor/product.md's file-roles table documents last_run.log as
//       gitignored / not a committed artifact, so the next reader doesn't
//       re-file this same track from a code read alone.
//
// Run: node --test conductor/tests/track-10016-last-run-log.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

describe('Track 10016: last_run.log staging cleanup', () => {
  it('TC-1: workDir is declared once, before both blocks that need it', () => {
    const src = readFileSync(join(ROOT, 'conductor/laneconductor.sync.mjs'), 'utf8');

    // Isolate spawnCli's exit-handler region by anchoring on the two
    // adjacent landmarks: the Last Run marker update (just above the
    // hoist) and the "5. Write changes and commit to git" block (just
    // below it, inside `if (updated)`).
    const lastRunAnchor = src.indexOf("**Last Run**: ${runBy}`);\n          }\n          updated = true;");
    assert.notEqual(lastRunAnchor, -1, 'could not locate the Last Run marker update — has the exit handler moved?');

    const updatedBlockAnchor = src.indexOf('// 5. Write changes and commit to git', lastRunAnchor);
    assert.notEqual(updatedBlockAnchor, -1, 'could not locate the "if (updated)" commit block after the Last Run marker');

    const region = src.slice(lastRunAnchor, updatedBlockAnchor);

    const workDirDecls = region.match(/const\s+workDir\s*=/g) || [];
    assert.strictEqual(
      workDirDecls.length, 1,
      `expected exactly one 'const workDir =' declaration between the Last Run update and the ` +
      `commit block, found ${workDirDecls.length}. If this is 0, the hoist regressed (track 1102 ` +
      `F9b's original bug); if >1, workDir is being redeclared instead of shared.`
    );

    // The lastRunLog block itself must not declare its own workDir — it
    // must reference the shared one declared above it in `region`.
    const lastRunLogBlock = region.slice(region.indexOf('const lastRunLog ='));
    assert.ok(
      !/const\s+workDir\s*=/.test(lastRunLogBlock),
      'if (lastRunLog) block must not redeclare workDir — it should reference the hoisted declaration'
    );
  });

  it('TC-6: product.md documents last_run.log as gitignored / not committed', () => {
    const productMd = readFileSync(join(ROOT, 'conductor/product.md'), 'utf8');
    const row = productMd.split('\n').find(line => line.includes('last_run.log'));
    assert.ok(row, 'expected a file-roles table row naming last_run.log in conductor/product.md');
    assert.match(
      row, /gitignored|not (a )?committed/i,
      `last_run.log's product.md row must state it is gitignored / not a committed artifact. Row: ${row}`
    );
  });
});
