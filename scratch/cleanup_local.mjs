
import { readFileSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';

const metadataPath = 'conductor/tracks-metadata.json';
const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));

const keysToRemove = ['LAN-100', 'LAN-103', 'LAN-61', 'KAN-840'];
const foldersToRemove = [
  'conductor/tracks/LAN-100-track-1061-cli-gaps-with-worker',
  'conductor/tracks/LAN-103-track-1061-cli-gaps-with-worker',
  'conductor/tracks/LAN-61-track-1061-cli-gaps-with-worker',
  'conductor/tracks/KAN-840-track-1061-cli-gaps-with-worker'
];

for (const key of keysToRemove) {
  if (metadata.tracks[key]) {
    console.log(`Removing metadata key: ${key}`);
    delete metadata.tracks[key];
  }
}

writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

for (const folder of foldersToRemove) {
  if (existsSync(folder)) {
    console.log(`Removing folder: ${folder}`);
    rmSync(folder, { recursive: true, force: true });
  }
}
