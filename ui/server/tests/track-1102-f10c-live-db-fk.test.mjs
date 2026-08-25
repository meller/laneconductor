// server/tests/track-1102-f10c-live-db-fk.test.mjs
// Track 1102 F10c, TC-13.5 (the honest AC-8 check, per test.md): the
// scratch-DB test (track-1102-f10c-dispatch-fk-set-null.test.mjs) proved
// the migration's SQL is CORRECT — it does not prove the migration was
// ever actually APPLIED to the database this project's own workers/UI run
// against. F22 documented exactly that gap: the fix sat committed and
// scratch-tested for days while the live FK stayed ON DELETE CASCADE.
//
// This test targets the REAL local laneconductor DB (server/index.mjs's
// own defaults — localhost:5432/laneconductor, postgres/postgres), not a
// scratch or mocked one, matching track-10012-inbox-buckets.test.mjs's
// established convention for exactly this reason: some things can only be
// proven against the real thing. All writes are wrapped in a transaction
// that's always rolled back, so this never leaves data behind or touches
// anything another workflow depends on.
//
// Skips itself (rather than failing) when the live DB isn't reachable —
// e.g. CI without a DB — matching every other real-DB test in this suite.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';

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

afterAll(async () => {
  await pool.end();
});

describe('Track 1102 F10c TC-13.5: the live DB actually has the fix applied', () => {
  it('worker_dispatch.worker_id FK is ON DELETE SET NULL on the real DB (not just the scratch one)', async () => {
    if (!dbAvailable) return;
    const { rows } = await pool.query(`
      SELECT confdeltype FROM pg_constraint
      WHERE conname = 'worker_dispatch_worker_id_fkey' AND conrelid = 'worker_dispatch'::regclass
    `);
    expect(rows).toHaveLength(1);
    // 'n' = SET NULL, 'c' = CASCADE (see pg_constraint.confdeltype in the
    // Postgres catalog docs) — asserting the raw catalog code rather than
    // a human-readable string is deliberate: it can't be satisfied by a
    // constraint that merely LOOKS right in a \d listing but isn't.
    expect(rows[0].confdeltype).toBe('n');
  });

  it('deleting a real (rolled-back) worker row preserves its worker_dispatch rows with worker_id NULL', async () => {
    if (!dbAvailable) return;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [worker] } = await client.query(
        `INSERT INTO workers (project_id, hostname, pid, worker_number, mode, type) VALUES (1, 'f10c-tc13-5-host', 888778, 98, 'sync-only', 'project') RETURNING id`
      );
      await client.query(`INSERT INTO worker_dispatch (worker_id, action) VALUES ($1, 'worker_adhoc_chat')`, [worker.id]);
      await client.query('DELETE FROM workers WHERE id = $1', [worker.id]);
      const { rows: survivors } = await client.query(
        `SELECT worker_id FROM worker_dispatch WHERE action = 'worker_adhoc_chat' AND worker_id IS NULL ORDER BY id DESC LIMIT 1`
      );
      expect(survivors).toHaveLength(1);
      expect(survivors[0].worker_id).toBeNull();
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
