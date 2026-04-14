
import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';

const config = JSON.parse(readFileSync('.laneconductor.json', 'utf8'));
const jira = config.collectors.find(c => c.type === 'jira');
const token = execSync(`gcloud secrets versions access latest --secret="${jira.token_secret_name}"`, { encoding: 'utf8' }).trim();
const auth = Buffer.from(`${jira.email}:${token}`).toString('base64');

async function debug() {
  const url = `https://${jira.domain}/rest/api/3/search/jql`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jql: `project = "${jira.project_key}"`, maxResults: 5 })
  });
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}
debug();
