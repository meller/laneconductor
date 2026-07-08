
import { readJiraConfig, pushTrackToJira } from '../conductor/jira-collector.mjs';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Read config
const lcConfig = JSON.parse(readFileSync('.laneconductor.json', 'utf8'));
const jiraConfig = readJiraConfig(lcConfig.collectors);

if (!jiraConfig) {
    console.error("No JIRA config found in .laneconductor.json");
    process.exit(1);
}

const trackKey = 'LAN-100';
const trackPath = 'conductor/tracks/LAN-100-track-1061-cli-gaps-with-worker';

function readIfExists(filepath) {
  try { return existsSync(filepath) ? readFileSync(filepath, 'utf8') : null; }
  catch { return null; }
}

const indexContent = readFileSync(join(trackPath, 'index.md'), 'utf8');
const trackData = {
  track_number: trackKey,
  title: 'Manual Sync Test',
  indexContent: indexContent,
  planContent: readIfExists(join(trackPath, 'plan.md')),
  specContent: readIfExists(join(trackPath, 'spec.md')),
  testContent: readIfExists(join(trackPath, 'test.md')),
  logContent: readIfExists(join(trackPath, 'log.md')),
  lane: 'done',
  status: 'success'
};

console.log("Pushing to Jira...");
const success = await pushTrackToJira(jiraConfig, trackKey, trackData);
console.log("Success:", success);
