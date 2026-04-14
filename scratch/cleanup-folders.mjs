
import { readFileSync, existsSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';

const metadataPath = 'conductor/tracks-metadata.json';
const tracksDir = 'conductor/tracks';

if (!existsSync(metadataPath)) {
  console.log('No metadata file found.');
  process.exit(0);
}

const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
const tracks = metadata.tracks || {};

// Find all current track folders
const folders = readdirSync(tracksDir);

for (const folder of folders) {
  if (folder.startsWith('KAN-')) {
    const jiraKey = folder.match(/^(KAN-\d+)/)?.[1];
    if (jiraKey) {
      // Find if any numeric track is linked to this jiraKey
      const numericId = Object.entries(tracks).find(([id, meta]) => meta.jira_key === jiraKey && id !== jiraKey && /^\d+$/.test(id))?.[0];
      
      if (numericId) {
        console.log(`Deleting redundant folder ${folder} (linked to numeric track ${numericId})`);
        rmSync(join(tracksDir, folder), { recursive: true, force: true });
      }
    }
  }
}

console.log('Cleanup complete.');
