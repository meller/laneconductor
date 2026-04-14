
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const metadataPath = 'conductor/tracks-metadata.json';
const tracksDir = 'conductor/tracks';

if (!existsSync(metadataPath)) {
  console.log('No metadata file found.');
  process.exit(0);
}

const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
const tracks = metadata.tracks || {};
const newTracks = {};

const existingFolders = readdirSync(tracksDir);

for (const id in tracks) {
  // Keep if ID is numeric OR if folder exists
  const isNumeric = /^\d+$/.test(id);
  const folderExists = existingFolders.some(f => f.startsWith(`${id}-`));

  if (isNumeric || folderExists) {
    newTracks[id] = tracks[id];
  } else {
    console.log(`Removing orphaned metadata for track ${id}`);
  }
}

metadata.tracks = newTracks;
writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
console.log('Orphaned metadata cleanup complete.');
