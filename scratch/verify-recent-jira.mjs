
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

const config = JSON.parse(readFileSync('.laneconductor.json', 'utf8'));
const jira = config.collectors.find(c => c.type === 'jira');
const token = execSync(`gcloud secrets versions access latest --secret="${jira.token_secret_name}"`, { encoding: 'utf8' }).trim();
const auth = Buffer.from(`${jira.email}:${token}`).toString('base64');

async function checkIssues() {
  const url = `https://${jira.domain}/rest/api/3/search/jql`;
  const jql = `project = "${jira.project_key}" ORDER BY created DESC`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jql, maxResults: 10, fields: ['summary', 'labels', 'status'] })
  });
  
  const data = await res.json();
  const issues = data.issues || [];
  console.log(`Checking last ${issues.length} issues in ${jira.project_key}...`);
  
  for (const issue of issues) {
    console.log(`${issue.key}: ${issue.fields.summary}`);
    console.log(`  Labels: ${JSON.stringify(issue.fields.labels)}`);
    console.log(`  Status: ${issue.fields.status.name}`);
  }
}
checkIssues();
