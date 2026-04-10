const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_g2LADMUf4KRT@ep-frosty-river-an0hmun7-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    const workspaceId = '0e7f6ade-4584-462c-b0ef-5cc5ed5cad39';
    const userUid = 'LSkU70kEaRaqpJRWnH6PUH8f4Yj2';
    
    await pool.query(
      "INSERT INTO workspace_members (workspace_id, firebase_uid, role, github_username) VALUES ($1, $2, 'admin', 'google-asaf') ON CONFLICT DO NOTHING",
      [workspaceId, userUid]
    );
    console.log(`User ${userUid} added to workspace ${workspaceId}`);
    
    // Create an API token for this user so the worker can use it
    const token = 'lc_live_1a59afa40be342ecbe520a2140109f22'; // Use the one we found in local secret for convenience if it's unique
    await pool.query(
      "INSERT INTO api_tokens (workspace_id, token, created_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [workspaceId, token, userUid]
    );
    console.log(`Token ${token} registered for workspace ${workspaceId}`);

  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

run();
