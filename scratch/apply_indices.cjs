const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_g2LADMUf4KRT@ep-frosty-river-an0hmun7-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    console.log('Adding constraints to projects and tracks...');
    
    // 1. Projects constraint for UPSERT
    await pool.query(`
      ALTER TABLE projects 
      ADD CONSTRAINT projects_workspace_git_global_unique 
      UNIQUE (workspace_id, git_global_id)
    `).catch(e => console.log('Projects constraint already exists or failed:', e.message));

    // 2. Tracks constraint for UPSERT
    await pool.query(`
      ALTER TABLE tracks 
      ADD CONSTRAINT tracks_project_track_number_unique 
      UNIQUE (project_id, track_number)
    `).catch(e => console.log('Tracks constraint already exists or failed:', e.message));

    console.log('Done.');
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

run();
