// server/tests/track-10095-claim-broadcast.test.mjs
// Track AM-10095 Phase 1 (REQ-1/REQ-2): POST /tracks/claim-queue flips a
// claimed track's lane_action_status to 'running' in Postgres but never
// broadcast()s the change, so a board with a healthy websocket only learns
// about the claim on its next scheduled poll — up to POLL_INTERVAL_CONNECTED
// (30s at the time this track was filed). This exercises the real endpoint
// against a real local Postgres (same reasoning as
// track-10040-claim-reason.test.mjs) with the wsBroadcast module mocked so
// broadcast() calls can be asserted without a real WebSocket server. Skips
// itself when no local Postgres is reachable.

import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import pg from 'pg';

vi.mock('../wsBroadcast.mjs', () => ({
  initWebSocket: vi.fn(),
  broadcast: vi.fn(),
}));

const { app } = await import('../index.mjs');
const { broadcast } = await import('../wsBroadcast.mjs');

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME ?? 'laneconductor',
  user: process.env.DB_USER ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
});

let dbAvailable = true;
try {
  await pool.query('SELECT 1');
} catch {
  dbAvailable = false;
}

let projectId;

beforeAll(async () => {
  if (!dbAvailable) return;
  const r = await pool.query(
    `INSERT INTO projects (name, repo_path) VALUES ($1, $2) RETURNING id`,
    ['track-10095-claim-broadcast-test', `/tmp/track-10095-claim-broadcast-test-${Date.now()}`]
  );
  projectId = r.rows[0].id;
});

afterAll(async () => {
  if (dbAvailable && projectId) {
    await pool.query('DELETE FROM projects WHERE id = $1', [projectId]);
  }
  await pool.end();
});

afterEach(async () => {
  vi.mocked(broadcast).mockClear();
  if (dbAvailable) await pool.query('DELETE FROM tracks WHERE project_id = $1', [projectId]);
});

async function insertTrack(overrides = {}) {
  const r = await pool.query(
    `INSERT INTO tracks (project_id, track_number, title, lane_status, lane_action_status)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, track_number`,
    [
      projectId,
      overrides.track_number ?? String(Math.floor(Math.random() * 1_000_000)),
      overrides.title ?? 'claim-broadcast test track',
      overrides.lane_status ?? 'implement',
      overrides.lane_action_status ?? 'queue',
    ]
  );
  return r.rows[0];
}

describe.skipIf(!dbAvailable)('POST /tracks/claim-queue — broadcasts claims (Track AM-10095 REQ-1/REQ-2)', () => {
  it('TC-1.1: claiming one queued track emits exactly one track:updated broadcast', async () => {
    const track = await insertTrack();

    const res = await request(app)
      .post(`/tracks/claim-queue?project_id=${projectId}`)
      .send({ track_number: track.track_number, limit: 1 });

    expect(res.status).toBe(200);
    expect(res.body.tracks).toHaveLength(1);

    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith('track:updated', { projectId, trackNumber: track.track_number });
  });

  it('TC-1.2: a claim that wins nothing emits no broadcast', async () => {
    // No tracks in this project at all — untargeted, idle-poll shape.
    const res = await request(app)
      .post(`/tracks/claim-queue?project_id=${projectId}`)
      .send({ limit: 5 });

    expect(res.status).toBe(200);
    expect(res.body.tracks).toHaveLength(0);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('TC-1.3: claiming several tracks in one call emits one broadcast per claimed track', async () => {
    const t1 = await insertTrack({ lane_status: 'plan' });
    const t2 = await insertTrack({ lane_status: 'review' });

    const res = await request(app)
      .post(`/tracks/claim-queue?project_id=${projectId}`)
      .send({ limit: 5 });

    expect(res.status).toBe(200);
    expect(res.body.tracks).toHaveLength(2);

    expect(broadcast).toHaveBeenCalledTimes(2);
    const broadcastTrackNumbers = vi.mocked(broadcast).mock.calls
      .map(([event, data]) => (event === 'track:updated' ? data.trackNumber : null))
      .sort();
    expect(broadcastTrackNumbers).toEqual([t1.track_number, t2.track_number].sort());
  });

  it('TC-1.4: an error before commit never broadcasts', async () => {
    // project_id=abc fails integer binding inside the UPDATE...FROM query,
    // before COMMIT is ever reached — proves the broadcast loop sits
    // strictly after a successful commit, not ahead of it in the try block.
    const res = await request(app)
      .post(`/tracks/claim-queue?project_id=abc`)
      .send({ limit: 5 });

    expect(res.status).toBe(500);
    expect(broadcast).not.toHaveBeenCalled();
  });
});
