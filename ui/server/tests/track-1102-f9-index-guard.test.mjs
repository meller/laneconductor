// server/tests/track-1102-f9-index-guard.test.mjs
// Track 1102 F9: POST /track must refuse to replace a substantial
// index_content with a gutted, title-less stub.
//
// Observed live (2026-08-12, first dogfooded UI-triggered plan run): after
// the run, a 263-byte marker-only index_content (no `# Track` title, body
// gone, Summary lifted from plan.md) was pushed over the DB's full 4KB
// version, and the DB→FS pull then propagated the stub back over the good
// file — a newer-wins ping-pong that erased the track body in both places.
// With multiple workers/checkouts pushing concurrently (a phantom test
// worker was heartbeating pid 999999 at the time), the durable fix is at
// the boundary every writer goes through: the server keeps its existing
// substantial index_content when an incoming one is drastically smaller
// AND has lost its title, instead of trusting any single pusher.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app, pool } from '../index.mjs';

vi.mock('../auth.mjs');

vi.mock('pg', () => {
    const query = vi.fn();
    const Pool = vi.fn(() => ({ query, on: vi.fn() }));
    return { default: { Pool }, Pool };
});

const FULL = '# Track 1104: End-to-end walkthrough — UI (browser)\n\n**Lane**: plan\n**Lane Status**: queue\n**Progress**: 0%\n\n## Problem\n' + 'x'.repeat(3000) + '\n\n## Phases\n- [ ] Phase 1\n';
const STUB = '**Lane**: plan\n**Lane Status**: queue\n**Progress**: 0%\n**Summary**: gutted\n';

function mockUpsert({ existingIndex }) {
    const calls = [];
    vi.mocked(pool.query).mockImplementation(async (sql, params) => {
        calls.push([sql, params]);
        if (/SELECT.*index_content.*FROM tracks/i.test(sql) || /SELECT index_content/i.test(sql)) {
            return { rows: existingIndex === undefined ? [] : [{ index_content: existingIndex }] };
        }
        if (/INSERT INTO tracks/i.test(sql)) return { rows: [{ id: 1 }], rowCount: 1 };
        if (/SELECT length\(index_content\)/i.test(sql)) return { rows: [{ len: 1 }] };
        return { rows: [] };
    });
    return calls;
}

function postTrack(index_content) {
    return request(app)
        .post('/track?project_id=1')
        .send({
            project_id: 1, track_number: '1104', title: 'E2e Ui Walkthrough',
            lane_status: 'plan', lane_action_status: 'queue', progress_percent: 0,
            index_content,
        });
}

describe('POST /track — F9 gutted-index guard', () => {
    beforeEach(() => vi.resetAllMocks());

    it('refuses to replace a substantial index_content with a tiny title-less stub', async () => {
        const calls = mockUpsert({ existingIndex: FULL });
        const res = await postTrack(STUB).expect(200);
        expect(res.body.index_guard).toBe('kept_existing');

        const upsert = calls.find(([sql]) => /INSERT INTO tracks/i.test(sql));
        expect(upsert).toBeTruthy();
        // The upserted index_content must be the existing full version, not the stub.
        const sentContents = upsert[1].filter(p => typeof p === 'string' && p.includes('## Problem'));
        expect(sentContents.length).toBeGreaterThan(0);
        expect(upsert[1]).not.toContain(STUB);
    });

    it('accepts a normal update that keeps the title, even if somewhat smaller', async () => {
        const trimmed = FULL.replace('x'.repeat(3000), 'x'.repeat(2000));
        const calls = mockUpsert({ existingIndex: FULL });
        const res = await postTrack(trimmed).expect(200);
        expect(res.body.index_guard).toBeUndefined();
        const upsert = calls.find(([sql]) => /INSERT INTO tracks/i.test(sql));
        expect(upsert[1].some(p => typeof p === 'string' && p === trimmed)).toBe(true);
    });

    it('accepts small content when there is no existing substantial version (new track)', async () => {
        mockUpsert({ existingIndex: undefined });
        const res = await postTrack(STUB).expect(200);
        expect(res.body.index_guard).toBeUndefined();
    });

    it('accepts a deliberate full rewrite that is small but keeps a title', async () => {
        const smallButTitled = '# Track 1104: Renamed\n\n**Lane**: plan\n**Lane Status**: queue\n**Progress**: 0%\n';
        mockUpsert({ existingIndex: FULL });
        const res = await postTrack(smallButTitled).expect(200);
        expect(res.body.index_guard).toBeUndefined();
    });
});
