const fs = require('fs');

const uiPath = 'ui/server/index.mjs';

let uiCode = fs.readFileSync(uiPath, 'utf8');

// Replace standard api calls to collector endpoints down directly to DB routes since they are now all in the same file!
uiCode = uiCode.replace(`app.get('/api/tracks/waiting', async (req, res) => {
  try {
    const { project_id } = req.query;
    const data = await collectorWrite('GET', '/tracks/waiting', undefined, project_id);
    res.json(data.tracks || []);
  } catch (err) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});`, `app.get('/api/tracks/waiting', async (req, res) => {
  try {
    const { project_id } = req.query;
    let queryStr = \`
      SELECT t.*, p.name as project_name
      FROM tracks t
      JOIN projects p ON p.id = t.project_id
      WHERE t.lane_status = 'waiting'\`;
    let queryArgs = [];
    if (project_id) {
       queryStr += ' AND t.project_id = \\$1';
       queryArgs.push(project_id);
    }
    queryStr += ' ORDER BY t.priority ASC NULLS LAST, t.updated_at ASC LIMIT 10';
    const r = await pool.query(queryStr, queryArgs);
    res.json(r.rows);
  } catch (err) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});`);

uiCode = uiCode.replace(`app.get('/api/projects/:id/tracks/waiting', async (req, res) => {
  try {
    const data = await collectorWrite('GET', '/tracks/waiting', undefined, req.params.id);
    res.json(data.tracks || []);
  } catch (err) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});`, `app.get('/api/projects/:id/tracks/waiting', async (req, res) => {
  try {
    const { id } = req.params;
    const r = await pool.query(\`
      SELECT t.*, p.name as project_name
      FROM tracks t
      JOIN projects p ON p.id = t.project_id
      WHERE t.lane_status = 'waiting' AND t.project_id = \\$1
      ORDER BY t.priority ASC NULLS LAST, t.updated_at ASC LIMIT 10\`, [id]);
    res.json(r.rows || []);
  } catch (err) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});`);

fs.writeFileSync(uiPath, uiCode);
console.log('Replaced tracks/waiting proxy with direct DB calls');
