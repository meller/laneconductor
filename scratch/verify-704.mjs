
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

const config = JSON.parse(readFileSync('.laneconductor.json', 'utf8'));
const jira = config.collectors.find(c => c.type === 'jira');
const token = execSync(`gcloud secrets versions access latest --secret="${jira.token_secret_name}"`, { encoding: 'utf8' }).trim();
const auth = Buffer.from(`${jira.email}:${token}`).toString('base64');

async function checkIssue() {
  const issueKey = 'KAN-704';
  const url = `https://${jira.domain}/rest/api/3/issue/${issueKey}`;
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${auth}` }
  });
  if (res.ok) {
    const data = await res.json();
    console.log(`Found ${issueKey}: ${data.fields.summary}`);
    console.log(`Labels: ${JSON.stringify(data.fields.labels)}`);
  } else {
    console.error(`Failed to find ${issueKey}: ${res.status} ${await res.text()}`);
  }
}
checkIssue();
