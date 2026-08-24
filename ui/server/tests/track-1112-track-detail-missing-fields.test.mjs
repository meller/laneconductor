// Track 1112 dogfood incident (2026-08-13): TrackDetailPanel's Logs tab
// never showed the "check the Transcript tab" hint for an in-progress
// claude run, no matter what the frontend condition checked, because
// GET /api/projects/:id/tracks/:num never returned lane_action_status or
// active_cli in the first place — both columns exist on the tracks table
// (confirmed via \d tracks) and are written by the worker, but this
// endpoint's SELECT and response object silently dropped them. Verified
// live against a real running track (1112 itself) via
// `fetch('/api/projects/1/tracks/1112')` in the browser console — the
// response had no lane_action_status/active_cli keys at all.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app, pool } from '../index.mjs';

vi.mock('../auth.mjs');
vi.mock('pg', () => {
  const query = vi.fn();
  const Pool = vi.fn(() => ({ query, on: vi.fn() }));
  return { default: { Pool }, Pool };
});

describe('GET /api/projects/:id/tracks/:num — lane_action_status and active_cli', () => {
  beforeEach(() => vi.resetAllMocks());

  it('includes lane_action_status and active_cli in the response so the Logs tab can tell a live run from a stale one', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{
        id: 1112, track_number: '1112', title: 'Git Sync And Worktree Visibility',
        lane_status: 'implement', lane_action_status: 'running', progress_percent: 10,
        current_phase: null, content_summary: null, last_heartbeat: null, created_at: new Date(),
        index_content: '', plan_content: '', spec_content: '', test_content: '',
        last_log_tail: 'stale content from a previous run', active_cli: 'claude',
        assignee_uid: null, created_by_uid: null,
      }],
    });

    const res = await request(app).get('/api/projects/1/tracks/1112').expect(200);
    expect(res.body.lane_action_status).toBe('running');
    expect(res.body.active_cli).toBe('claude');
  });
});
