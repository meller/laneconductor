// server/tests/track-10099-marker-ownership.test.mjs
// Track AM-10099 Phase 7 (item e, REQ-8): syncTrackToFile must never let an
// un-asserted DB value overwrite an author-owned marker. Confirmed live on
// this very track: **Auto Run**: no, deliberately committed by the author,
// was overwritten with the DB's (corrupted-by-an-unrelated-bug) yes.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { app, pool, syncTrackToFile } from '../index.mjs';
import { AUTHORED_MARKER_PROVENANCE } from '../../../conductor/services/marker-ownership.mjs';

vi.mock('../auth.mjs');

vi.mock('pg', () => {
  const query = vi.fn();
  const Pool = vi.fn(() => ({ query, on: vi.fn() }));
  return { default: { Pool }, Pool };
});

describe('syncTrackToFile — author-owned marker provenance (Phase 7)', () => {
  let tmpRoot, tracksDir, indexPath;

  beforeEach(() => {
    vi.resetAllMocks();
    tmpRoot = mkdtempSync(join(tmpdir(), 'lc-marker-ownership-'));
    tracksDir = join(tmpRoot, 'conductor', 'tracks');
    mkdirSync(join(tracksDir, 'AM-10099-test-track'), { recursive: true });
    indexPath = join(tracksDir, 'AM-10099-test-track', 'index.md');
    writeFileSync(indexPath, [
      '# Track AM-10099: Test Track',
      '',
      '**Lane**: plan',
      '**Lane Status**: queue',
      '**Progress**: 0%',
      '**Auto Run**: no',
      '**Author**: AM',
      '**Created By**: x@y.com',
      '**Type**: dev',
      '**Merge Mode**: direct',
    ].join('\n') + '\n');
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('AC-12: an un-asserted auto_run update from a DB row leaves the file\'s Auto Run unchanged', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ repo_path: tmpRoot }] });
    await syncTrackToFile(1, '10099', { auto_run: true }); // no provenance asserted

    const content = readFileSync(indexPath, 'utf8');
    expect(content).toMatch(/\*\*Auto Run\*\*:\s*no/);
    expect(content).not.toMatch(/\*\*Auto Run\*\*:\s*yes/);
    // Untouched siblings, per REQ-8.
    expect(content).toMatch(/# Track AM-10099: Test Track/);
    expect(content).toMatch(/\*\*Author\*\*:\s*AM/);
    expect(content).toMatch(/\*\*Type\*\*:\s*dev/);
  });

  it('a properly-asserted auto_run update (the real /auto-run route\'s shape) DOES apply', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ repo_path: tmpRoot }] });
    await syncTrackToFile(1, '10099', { auto_run: true, provenance: AUTHORED_MARKER_PROVENANCE });

    const content = readFileSync(indexPath, 'utf8');
    expect(content).toMatch(/\*\*Auto Run\*\*:\s*yes/);
  });

  it('an un-asserted merge_mode update leaves the file\'s Merge Mode unchanged', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ repo_path: tmpRoot }] });
    await syncTrackToFile(1, '10099', { merge_mode: 'pr' });

    const content = readFileSync(indexPath, 'utf8');
    expect(content).toMatch(/\*\*Merge Mode\*\*:\s*direct/);
  });

  it('AC-13: machine-owned markers (Lane, Progress) still sync with NO provenance asserted', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ repo_path: tmpRoot }] });
    await syncTrackToFile(1, '10099', { lane_status: 'implement', progress_percent: 42 });

    const content = readFileSync(indexPath, 'utf8');
    expect(content).toMatch(/\*\*Lane\*\*:\s*implement/);
    expect(content).toMatch(/\*\*Progress\*\*:\s*42%/);
    // Guards against a writer that syncs nothing at all.
    expect(content).toMatch(/\*\*Auto Run\*\*:\s*no/); // still untouched
  });

  it('AC-25 in-situ (regression): the real /auto-run route path leaves an un-asserted call inert end to end', async () => {
    // Exercises the actual route, not just the syncTrackToFile unit —
    // confirms the wiring (provenance flag threaded from the route) holds,
    // not only the function's own default behavior.
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE tracks SET auto_run
      .mockResolvedValueOnce({ rows: [{ repo_path: tmpRoot }] }); // syncTrackToFile's project lookup

    const request = (await import('supertest')).default;
    const res = await request(app)
      .patch('/api/projects/1/tracks/10099/auto-run')
      .send({ auto_run: true });
    expect(res.status).toBe(200);

    const content = readFileSync(indexPath, 'utf8');
    // The real route DOES assert provenance, so this one legitimately applies.
    expect(content).toMatch(/\*\*Auto Run\*\*:\s*yes/);
  });

  // Track AM-10099 Phase 11 Task 3 (item l): `Model` had no provenance
  // guard at all until this pass — unlike its Auto Run/Merge Mode/
  // Workspace siblings above, an un-asserted `model_override` update used
  // to apply unconditionally. Same shape as AC-12 above, for the marker
  // this phase newly classified and guarded.
  it('(item l) an un-asserted model_override update from a DB row leaves the file\'s Model unchanged', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ repo_path: tmpRoot }] });
    await syncTrackToFile(1, '10099', { model_override: 'claude-opus-5' }); // no provenance asserted

    const content = readFileSync(indexPath, 'utf8');
    expect(content).not.toMatch(/\*\*Model\*\*/);
    // Untouched siblings.
    expect(content).toMatch(/\*\*Auto Run\*\*:\s*no/);
    expect(content).toMatch(/\*\*Merge Mode\*\*:\s*direct/);
  });

  it('(item l) an authored model_override update DOES apply, same as its siblings', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ repo_path: tmpRoot }] });
    await syncTrackToFile(1, '10099', { model_override: 'claude-opus-5', provenance: AUTHORED_MARKER_PROVENANCE });

    const content = readFileSync(indexPath, 'utf8');
    expect(content).toMatch(/\*\*Model\*\*:\s*claude-opus-5/);
  });

  it('(item l) the real /model-override route asserts provenance end to end', async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE tracks SET model_override
      .mockResolvedValueOnce({ rows: [{ repo_path: tmpRoot }] }); // syncTrackToFile's project lookup

    const request = (await import('supertest')).default;
    const res = await request(app)
      .patch('/api/projects/1/tracks/10099/model-override')
      .send({ model_override: 'claude-opus-5' });
    expect(res.status).toBe(200);

    const content = readFileSync(indexPath, 'utf8');
    expect(content).toMatch(/\*\*Model\*\*:\s*claude-opus-5/);
  });
});
