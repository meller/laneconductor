
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

const config = JSON.parse(readFileSync('.laneconductor.json', 'utf8'));
const jira = config.collectors.find(c => c.type === 'jira');
const token = execSync(`gcloud secrets versions access latest --secret="${jira.token_secret_name}"`, { encoding: 'utf8' }).trim();
const auth = Buffer.from(`${jira.email}:${token}`).toString('base64');

async function checkStatuses() {
  const url = `https://${jira.domain}/rest/api/3/project/${jira.project_key}/statuses`;
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${auth}` }
  });
  if (res.ok) {
    const data = await res.json();
    console.log('Available statuses for project:', JSON.stringify(data, null, 2));
  } else {
    console.error('Failed to get statuses:', res.status, await res.text());
  }
}
checkStatuses();
