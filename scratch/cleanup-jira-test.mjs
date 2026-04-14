import { readJiraConfig, pollJira } from '../conductor/jira-collector.mjs';
import { readFileSync, writeFileSync } from 'fs';

async function cleanup() {
  const config = JSON.parse(readFileSync('.laneconductor.json', 'utf8'));
  const jiraConfig = readJiraConfig(config.collectors);

  if (!jiraConfig) {
    console.error('❌ No Jira config found');
    process.exit(1);
  }

  const auth = Buffer.from(`${jiraConfig.email}:${jiraConfig.token}`).toString('base64');
  
  console.log('🔍 Listing all issues in project', jiraConfig.project_key);
  const issues = await pollJira(jiraConfig, '2000-01-01'); // Long ago to get all
  
  if (issues.length === 0) {
    console.log('✅ No issues found to delete');
  } else {
    console.log(`🗑️ Deleting ${issues.length} issues...`);
    for (const issue of issues) {
      const url = `https://${jiraConfig.domain}/rest/api/3/issue/${issue.key}`;
      const res = await fetch(url, {
        method: 'DELETE',
        headers: { Authorization: `Basic ${auth}` }
      });
      if (res.ok) {
        console.log(`  ✅ Deleted ${issue.key}`);
      } else {
        console.error(`  ❌ Failed to delete ${issue.key}: ${res.status} ${await res.text()}`);
      }
    }
  }

  console.log('🧹 Cleaning tracks-metadata.json...');
  const metadataPath = 'conductor/tracks-metadata.json';
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
  
  // Clean up root level issues
  Object.keys(metadata).forEach(key => {
    if (key.match(/^\d+$/) || key.startsWith('KAN-')) {
      delete metadata[key];
    }
  });

  // Clean up inside tracks
  if (metadata.tracks) {
    Object.keys(metadata.tracks).forEach(id => {
      delete metadata.tracks[id].jira_key;
      delete metadata.tracks[id].jira_last_synced;
    });
  }
  
  delete metadata._jira_last_poll;

  writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
  console.log('✨ Metadata cleaned');
}

cleanup().catch(console.error);
