
import { readFileSync } from 'fs';
import { readJiraConfig } from '../conductor/jira-collector.mjs';

async function deleteIssue(config, issueKey) {
  const auth = Buffer.from(`${config.email}:${config.token}`).toString('base64');
  const url = `https://${config.domain}/rest/api/3/issue/${issueKey}`;

  console.log(`Deleting ${issueKey}...`);
  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    }
  });

  if (response.ok || response.status === 404) {
    console.log(`Successfully deleted ${issueKey} (or already gone)`);
    return true;
  } else {
    console.error(`Failed to delete ${issueKey}: ${response.status} ${await response.text()}`);
    return false;
  }
}

const lcConfig = JSON.parse(readFileSync('.laneconductor.json', 'utf8'));
const jiraConfig = readJiraConfig(lcConfig.collectors);

const issuesToDelete = ['LAN-100', 'LAN-103', 'LAN-61', 'KAN-840'];

for (const key of issuesToDelete) {
  await deleteIssue(jiraConfig, key);
}
