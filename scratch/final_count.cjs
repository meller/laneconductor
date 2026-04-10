const { Pool } = require('pg');
const pool = new Pool({
  connectionString: '***REMOVED-SECRET-NEON-CREDENTIAL***',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  const res = await pool.query('SELECT COUNT(*) FROM tracks');
  console.log('COUNT:', res.rows[0].count);
  const res2 = await pool.query('SELECT * FROM projects');
  console.log('Projects:', JSON.stringify(res2.rows, null, 2));
  const res3 = await pool.query('SELECT * FROM tracks LIMIT 1');
  console.log('Sample Track:', JSON.stringify(res3.rows, null, 2));
  await pool.end();
}

run();
