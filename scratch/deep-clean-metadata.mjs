
import { readFileSync, writeFileSync, existsSync } from 'fs';

const metadataPath = 'conductor/tracks-metadata.json';
if (!existsSync(metadataPath)) {
  process.exit(0);
}

const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
const cleanTracks = {};

// Migrate all known track data into a clean structure
if (metadata.tracks) {
  for (const [id, data] of Object.entries(metadata.tracks)) {
    cleanTracks[id] = {
      folder_path: data.folder_path,
      last_file_update: data.last_file_update,
      synced: data.synced || false
      // NO jira_key or jira_last_synced here!
    };
  }
}

// Check for top-level track keys too
for (const [key, data] of Object.entries(metadata)) {
  if (key === 'tracks' || key === 'format' || key === 'last_checked') continue;
  if (/^\d+$/.test(key) || key.startsWith('KAN-')) {
    if (!cleanTracks[key]) {
       cleanTracks[key] = { folder_path: data.folder_path || '' };
    }
  }
}

const cleanMetadata = {
  format: "1.0",
  last_checked: new Date().toISOString(),
  tracks: cleanTracks
};

writeFileSync(metadataPath, JSON.stringify(cleanMetadata, null, 2), 'utf8');
console.log('Metadata deep-cleaned and reset for fresh Jira sync.');
