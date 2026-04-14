
import { readFileSync, writeFileSync, existsSync } from 'fs';

const metadataPath = 'conductor/tracks-metadata.json';
if (!existsSync(metadataPath)) {
  console.log('No metadata file found.');
  process.exit(0);
}

const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
const tracks = metadata.tracks || {};

for (const id in tracks) {
  if (tracks[id].jira_key) {
    console.log(`Resetting Jira link for track ${id} (${tracks[id].jira_key})`);
    delete tracks[id].jira_key;
    delete tracks[id].jira_last_synced;
  }
}

writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
console.log('Metadata reset complete. Watcher will now re-create Jira issues on next update.');
