
import { readFileSync, writeFileSync, existsSync } from 'fs';

const metadataPath = 'conductor/tracks-metadata.json';
if (!existsSync(metadataPath)) {
  process.exit(0);
}

const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
if (!metadata.tracks) metadata.tracks = {};

const keys = Object.keys(metadata);
for (const key of keys) {
  if (key === 'tracks' || key === 'format' || key === 'last_checked' || key.startsWith('_')) continue;
  
  // If it's a track ID (numeric or KAN-*)
  if (/^\d+$/.test(key) || key.startsWith('KAN-')) {
    console.log(`Moving track ${key} into 'tracks' object`);
    metadata.tracks[key] = { ...metadata.tracks[key], ...metadata[key] };
    delete metadata[key];
  }
}

metadata.format = "1.0";
writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
console.log('Metadata unified successfully.');
