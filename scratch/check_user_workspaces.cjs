const { Pool } = require('pg');
const pool = new Pool({
  connectionString: '***REMOVED-SECRET-NEON-CREDENTIAL***',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    const res = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'workspace_members'");
    console.log('Columns:', res.rows.map(r => r.column_name).join(', '));
    const data = await pool.query("SELECT * FROM workspace_members");
    console.log('Data:', JSON.stringify(data.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

run();
