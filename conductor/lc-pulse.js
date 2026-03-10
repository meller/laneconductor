const { Client } = require('pg');
const fs = require('fs');

async function pulse() {
  const cfg = JSON.parse(fs.readFileSync('./.laneconductor.json', 'utf8'));
  const track_number = process.argv[2];
  const lane_status = process.argv[3];
  const progress_percent = parseInt(process.argv[4]);
  const content_summary = process.argv[5] || '';

  const client = new Client({
    host: cfg.db.host,
    port: cfg.db.port,
    database: cfg.db.name,
    user: cfg.db.user,
    password: cfg.db.password
  });

  try {
    await client.connect();
    await client.query(
      `UPDATE tracks 
       SET lane_status = $1, 
           progress_percent = $2, 
           content_summary = $3, 
           last_heartbeat = NOW(),
           lane_action_status = 'done'
       WHERE project_id = $4 AND track_number = $5`,
      [lane_status, progress_percent, content_summary, cfg.project.id, track_number]
    );
    console.log(`✅ Pulsed track ${track_number} to ${lane_status} (${progress_percent}%)`);
  } catch (err) {
    console.error('❌ Failed to pulse track:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

pulse();
