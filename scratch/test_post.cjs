const https = require('https');
const { execSync } = require('child_process');

function post(url, token, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const options = {
      hostname: u.hostname,
      port: 443,
      path: u.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Content-Length': data.length
      }
    };

    const req = https.request(options, (res) => {
      let resData = '';
      res.on('data', (d) => resData += d);
      res.on('end', () => resolve({ status: res.statusCode, data: resData }));
    });

    req.on('error', (e) => reject(e));
    req.write(data);
    req.end();
  });
}

async function run() {
  const url = 'https://app.laneconductor.com/track';
  let token = '***REMOVED-SECRET-LC-TOKEN***';
  try {
     token = execSync('gcloud secrets versions access latest --secret LC_WORKER_PROD_KEY', { encoding: 'utf8' }).trim();
  } catch(e) {}

  const body = {
    project_id: 1,
    track_number: "TEST_999",
    title: "Testing Sync",
    lane_status: "backlog",
    progress_percent: 50
  };

  console.log('Testing POST to', url);
  try {
    const res = await post(url, token, body);
    console.log('Status:', res.status);
    console.log('Response:', res.data);
  } catch(err) {
    console.error('Error:', err.message);
  }
}

run();
