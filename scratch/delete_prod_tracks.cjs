const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_g2LADMUf4KRT@ep-frosty-river-an0hmun7-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require',
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
