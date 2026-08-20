// Track 1102 F10c: worker_dispatch.worker_id used to be
// `ON DELETE CASCADE` — deleting a workers row erased every dispatch row
// for it, including all worker_adhoc_chat history the Activity panel
// reads through it. F10's soft de-registration avoids this on the routine
// stop path, but a manual row deletion (an admin query, a bad script, a
// future feature) can still hit it. Migration
// 20260820101300_worker_dispatch_fk_set_null.sql makes worker_id nullable
// and changes the FK to ON DELETE SET NULL.
//
// This test builds the worker_dispatch/workers schema from scratch inside
// a real Postgres (the migration's exact ALTER statements, not a
// hand-copied re-derivation) rather than depending on the migration having
// been applied to any particular database — this is the same reason
// track-10012-inbox-buckets.test.mjs doesn't mock `pg` for its own CASE
// expression: FK/constraint behavior can't be verified against a mock, it
// has to be proven against a real one. Deliberately targets the scratch
// `laneconductor_dev` database (declared in atlas.hcl specifically as "Dev
// database for migration planning"), not the live dogfooded `laneconductor`
// DB this project's own workers/UI are running against.
//
// Skips itself (rather than failing) when laneconductor_dev isn't
// reachable — e.g. CI without a DB — matching track-10012's convention.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  database: 'laneconductor_dev',
  user: process.env.DB_USER ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
});

let dbAvailable = true;
try {
  await pool.query('SELECT 1');
} catch {
  dbAvailable = false;
}

beforeAll(async () => {
  if (!dbAvailable) return;
  await pool.query('DROP TABLE IF EXISTS worker_dispatch CASCADE');
  await pool.query('DROP TABLE IF EXISTS workers CASCADE');
  await pool.query(`CREATE TABLE "workers" ("id" SERIAL PRIMARY KEY, "hostname" TEXT NOT NULL, "pid" INTEGER NOT NULL)`);
  // Pre-fix schema, then the migration's own ALTER statements verbatim —
  // proves the MIGRATION works, not just a schema hand-written to already
  // match the desired end state.
  await pool.query(`
    CREATE TABLE "worker_dispatch" (
      "id" SERIAL PRIMARY KEY,
      "worker_id" INTEGER NOT NULL,
      "action" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'pending'
    )
  `);
  await pool.query(`ALTER TABLE "worker_dispatch" ADD CONSTRAINT "worker_dispatch_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
  await pool.query(`ALTER TABLE "worker_dispatch" ALTER COLUMN "worker_id" DROP NOT NULL`);
  await pool.query(`ALTER TABLE "worker_dispatch" DROP CONSTRAINT "worker_dispatch_worker_id_fkey"`);
  await pool.query(`ALTER TABLE "worker_dispatch" ADD CONSTRAINT "worker_dispatch_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON UPDATE NO ACTION ON DELETE SET NULL`);
});

afterEach(async () => {
  if (dbAvailable) {
    await pool.query('DELETE FROM worker_dispatch');
    await pool.query('DELETE FROM workers');
  }
});

afterAll(async () => {
  if (dbAvailable) {
    await pool.query('DROP TABLE IF EXISTS worker_dispatch CASCADE');
    await pool.query('DROP TABLE IF EXISTS workers CASCADE');
  }
  await pool.end();
});

describe('Track 1102 F10c: worker_dispatch survives its worker row being deleted', () => {
  it('deleting a workers row leaves its worker_dispatch rows with worker_id set to NULL, not deleted', async () => {
    if (!dbAvailable) return;
    const { rows } = await pool.query(`INSERT INTO workers (hostname, pid) VALUES ('h1', 1) RETURNING id`);
    const workerId = rows[0].id;
    await pool.query(`INSERT INTO worker_dispatch (worker_id, action) VALUES ($1, 'worker_adhoc_chat')`, [workerId]);

    await pool.query(`DELETE FROM workers WHERE id = $1`, [workerId]);

    const { rows: survivors } = await pool.query(
      `SELECT worker_id, action FROM worker_dispatch WHERE action = 'worker_adhoc_chat'`
    );
    expect(survivors).toHaveLength(1);
    expect(survivors[0].worker_id).toBeNull();
  });

  it('worker_id column accepts NULL directly (required for SET NULL to be legal)', async () => {
    if (!dbAvailable) return;
    await pool.query(`INSERT INTO worker_dispatch (worker_id, action) VALUES (NULL, 'deploy')`);
    const { rows } = await pool.query(`SELECT worker_id FROM worker_dispatch WHERE action = 'deploy'`);
    expect(rows[0].worker_id).toBeNull();
  });
});
