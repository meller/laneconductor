
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const metadataPath = 'conductor/tracks-metadata.json';
if (!existsSync(metadataPath)) {
  console.log('No metadata file found.');
  process.exit(0);
}

const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
const newMetadata = {
  format: metadata.format || '1.0',
  last_checked: metadata.last_checked || new Date().toISOString(),
  _jira_last_poll: metadata._jira_last_poll,
  tracks: metadata.tracks || {}
};

// 1. Move flat entries to tracks
const topLevelKeys = Object.keys(metadata).filter(k => !['format', 'last_checked', 'tracks', '_jira_last_poll'].includes(k));

for (const key of topLevelKeys) {
  if (!newMetadata.tracks[key]) {
    newMetadata.tracks[key] = metadata[key];
  } else {
    // If both exist, merge them
    Object.assign(newMetadata.tracks[key], metadata[key]);
  }
}

// 2. Resolve Jira duplicates
// Find all tracks that have a jira_key
const tracks = Object.entries(newMetadata.tracks);
const jiraToTracks = {};

for (const [id, meta] of tracks) {
  if (meta.jira_key) {
    if (!jiraToTracks[meta.jira_key]) jiraToTracks[meta.jira_key] = [];
    jiraToTracks[meta.jira_key].push(id);
  }
}

for (const [jiraKey, trackIds] of Object.entries(jiraToTracks)) {
  if (trackIds.length > 1) {
    console.log(`Found duplicate for Jira key ${jiraKey}: ${trackIds.join(', ')}`);
    // Rule: Prefer numeric ID over the Jira key ID
    const numericId = trackIds.find(id => /^\d+$/.test(id));
    const jiraId = trackIds.find(id => id === jiraKey);

    if (numericId && jiraId && numericId !== jiraId) {
      console.log(`Merging ${jiraId} into ${numericId}`);
      Object.assign(newMetadata.tracks[numericId], newMetadata.tracks[jiraId]);
      delete newMetadata.tracks[jiraId];
    }
  }
}

writeFileSync(metadataPath, JSON.stringify(newMetadata, null, 2), 'utf8');
console.log('Metadata migration complete.');
