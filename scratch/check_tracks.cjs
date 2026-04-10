const { Pool } = require('pg');
const pool = new Pool({
  connectionString: '***REMOVED-SECRET-NEON-CREDENTIAL***',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    const res = await pool.query("SELECT id, track_number, title, lane_status, progress_percent FROM tracks WHERE project_id = 1 ORDER BY track_number");
    console.log('Tracks:', JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

run();
