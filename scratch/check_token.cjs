const { Pool } = require('pg');
const pool = new Pool({
  connectionString: '***REMOVED-SECRET-NEON-CREDENTIAL***',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    const res = await pool.query('SELECT token, workspace_id FROM api_tokens WHERE token = $1', ['***REMOVED-SECRET-LC-TOKEN***']);
    console.log('Token check:', JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

run();
