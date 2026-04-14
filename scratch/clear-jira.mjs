
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Manual config since we want to be sure
const configPath = '.laneconductor.json';
if (!existsSync(configPath)) {
  console.error('No .laneconductor.json found.');
  process.exit(1);
}

import { execSync } from 'child_process';

const config = JSON.parse(readFileSync(configPath, 'utf8'));
const jiraCollector = config.collectors.find(c => c.type === 'jira');

if (!jiraCollector) {
  console.error('No Jira collector found.');
  process.exit(1);
}

const email = jiraCollector.email;
const domain = jiraCollector.domain;
const projectKey = jiraCollector.project_key;

let token = null;
if (jiraCollector.token_store_type === 'gcp-secret' && jiraCollector.token_secret_name) {
  try {
    token = execSync(`gcloud secrets versions access latest --secret="${jiraCollector.token_secret_name}"`, { encoding: 'utf8' }).trim();
  } catch (err) {
    console.error(`Failed to fetch GCP secret: ${err.message}`);
  }
} else {
  token = process.env[jiraCollector.token_env] || jiraCollector.token;
}

if (!token) {
  console.error('No token found.');
  process.exit(1);
}

const auth = Buffer.from(`${email}:${token}`).toString('base64');

async function clearJira() {
  console.log(`Clearing Jira project ${projectKey} on ${domain}...`);
  
  let totalDeleted = 0;
  while (true) {
    // 1. Search for issues
    const searchUrl = `https://${domain}/rest/api/3/search/jql`;
    const jql = `project = "${projectKey}"`;
    const response = await fetch(searchUrl, {
      method: 'POST',
      headers: { 
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ jql, maxResults: 100 })
    });
    
    if (!response.ok) {
      console.error(`Search failed: ${response.status} ${await response.text()}`);
      break;
    }
    
    const data = await response.json();
    const issues = data.issues || [];
    
    if (issues.length === 0) {
      console.log('No more issues found.');
      break;
    }
    
    console.log(`Found ${issues.length} issues in this batch. Deleting...`);
    
    for (const issue of issues) {
      const delUrl = `https://${domain}/rest/api/3/issue/${issue.id}`;
      const delRes = await fetch(delUrl, {
        method: 'DELETE',
        headers: { Authorization: `Basic ${auth}` }
      });
      
      if (delRes.ok) {
        // console.log(`Deleted ${issue.id}`);
        totalDeleted++;
      } else {
        console.error(`Failed to delete ${issue.id}: ${delRes.status}`);
      }
    }
    console.log(`Current progress: ${totalDeleted} deleted.`);
  }
  
  console.log(`Jira cleanup complete. Total deleted: ${totalDeleted}`);
}

clearJira().catch(err => console.error(err));
