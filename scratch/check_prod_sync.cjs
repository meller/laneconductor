const { Pool } = require('pg');
const pool = new Pool({
  connectionString: '***REMOVED-SECRET-NEON-CREDENTIAL***',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    const res = await pool.query('SELECT COUNT(*), lane_action_status, COUNT(*) as status_count FROM tracks GROUP BY lane_action_status');
    console.log('Production Tracks Status Breakdown:');
    res.rows.forEach(row => {
      console.log(`- ${row.lane_action_status}: ${row.status_count}`);
    });
    const total = await pool.query('SELECT COUNT(*) FROM tracks');
    console.log(`Total: ${total.rows[0].count}`);
  } catch (err) {
    console.error('Error counting tracks:', err.message);
  } finally {
    await pool.end();
  }
}

run();
