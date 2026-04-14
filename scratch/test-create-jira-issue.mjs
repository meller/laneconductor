// Standalone test: create one Jira issue from FS track 1067
import { readJiraConfig, createJiraIssue } from '../conductor/jira-collector.mjs';
import { readFileSync, existsSync } from 'fs';

const config = JSON.parse(readFileSync('.laneconductor.json', 'utf8'));
const jiraConfig = readJiraConfig(config.collectors);

if (!jiraConfig) {
  console.error('❌ No Jira config found');
  process.exit(1);
}

console.log('✅ Jira config loaded. Domain:', jiraConfig.domain);

// Test with track 1067
const indexPath = 'conductor/tracks/1067-jira-integration/index.md';
if (!existsSync(indexPath)) {
  console.error('❌ Track 1067 index.md not found');
  process.exit(1);
}

const content = readFileSync(indexPath, 'utf8');
const titleMatch = content.match(/^# (.+)$/m);
const title = titleMatch ? titleMatch[1] : '1067-jira-integration';
const laneMatch = content.match(/\*\*Lane\*\*:\s*(\S+)/i);
const lane = laneMatch ? laneMatch[1] : 'queue';

console.log('Creating Jira issue for track 1067:', { title, lane });

const issueKey = await createJiraIssue(jiraConfig, { title, lane, content });
if (issueKey) {
  console.log('✅ Created Jira issue:', issueKey);
} else {
  console.error('❌ Failed to create Jira issue');
}
