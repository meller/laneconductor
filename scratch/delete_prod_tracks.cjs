const { Pool } = require('pg');
const pool = new Pool({
  connectionString: '***REMOVED-SECRET-NEON-CREDENTIAL***',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    const res = await pool.query('DELETE FROM tracks');
    console.log('Deleted', res.rowCount, 'tracks from production.');
  } catch (err) {
    console.error('Error deleting tracks:', err.message);
  } finally {
    await pool.end();
  }
}

run();
