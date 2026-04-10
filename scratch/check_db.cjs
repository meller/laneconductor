const { Pool } = require('pg');
const pool = new Pool({
  connectionString: '***REMOVED-SECRET-NEON-CREDENTIAL***',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    const tables = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
    console.log('Tables:', tables.rows.map(r => r.table_name).join(', '));
    
    for (const table of tables.rows.map(r => r.table_name)) {
      const count = await pool.query(`SELECT count(*) FROM ${table}`);
      console.log(`Table ${table} count: ${count.rows[0].count}`);
    }

  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

run();
