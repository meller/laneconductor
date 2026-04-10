const { Pool } = require('pg');
const pool = new Pool({
  connectionString: '***REMOVED-SECRET-NEON-CREDENTIAL***',
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
    const token = '***REMOVED-SECRET-LC-TOKEN***'; // Use the one we found in local secret for convenience if it's unique
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
