#!/usr/bin/env node
// conductor/remote-sync.mjs
// Remote Sync: Read track data from collector API and write to local files
// Usage: node conductor/remote-sync.mjs [track-number]

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'fs';
import { dirname, join } from 'path';

// ── Config ─────────────────────────────────────────────────────────────────

const config = JSON.parse(readFileSync('.laneconductor.json', 'utf8'));
const { collectors, project } = config;

if (!collectors || collectors.length === 0) {
  console.error('[remote-sync] Error: No collectors configured in .laneconductor.json');
  process.exit(1);
}

const primaryCollector = collectors[0];
const collectorUrl = primaryCollector.url;
const projectId = project.id;

if (!projectId) {
  console.error('[remote-sync] Error: project.id not set in .laneconductor.json');
  process.exit(1);
}

// ── API Client ────────────────────────────────────────────────────────────

async function fetchTracks(trackNumber = null) {
  try {
    let url = `${collectorUrl}/api/projects/${projectId}/tracks`;
    if (trackNumber) {
      url += `?track=${trackNumber}`;
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`${response.status} ${await response.text()}`);
    }

    return await response.json();
  } catch (err) {
    console.error('[remote-sync] API fetch error:', err.message);
    throw err;
  }
}

async function syncTrackToDB(trackNumber, updates) {
  try {
    const response = await fetch(`${collectorUrl}/api/projects/${projectId}/tracks/${trackNumber}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${await response.text()}`);
    }

    return await response.json();
  } catch (err) {
    console.error(`[remote-sync] Failed to sync track ${trackNumber} to DB:`, err.message);
    throw err;
  }
}

// ── File Operations ────────────────────────────────────────────────────────

function findTrackFolder(trackNumber) {
  const tracksDir = 'conductor/tracks';
  if (!existsSync(tracksDir)) return null;

  const dirs = readdirSync(tracksDir).filter(d => {
    const match = d.match(/^(\d+)-/);
    return match && match[1] === trackNumber.toString();
  });

  return dirs.length > 0 ? join(tracksDir, dirs[0]) : null;
}

function updateTrackFile(trackFolder, track, metadata) {
  const indexPath = join(trackFolder, 'index.md');
  if (!existsSync(indexPath)) {
    console.warn(`[remote-sync] index.md not found: ${indexPath}`);
    return { action: 'skipped', reason: 'no_index_md' };
  }

  // ── Timestamp Check: "Newer Wins" ───────────────────────────────────────
  // Compare file mtime with last_file_update to determine direction
  const trackMeta = metadata?.tracks?.[track.track_number];
  const fileMtime = statSync(indexPath).mtimeMs;
  const lastFileUpdateMs = trackMeta?.last_file_update ? new Date(trackMeta.last_file_update).getTime() : 0;

  if (fileMtime > lastFileUpdateMs) {
    // File is newer — should sync to DB (not handled here, return flag)
    return { action: 'file_newer', fileMtime };
  }

  let content = readFileSync(indexPath, 'utf8');

  // Update Lane
  if (track.lane_status) {
    const laneRegex = /^\*\*Lane\*\*:\s*.+$/m;
    if (laneRegex.test(content)) {
      content = content.replace(laneRegex, `**Lane**: ${track.lane_status}`);
    } else {
      content = `**Lane**: ${track.lane_status}\n` + content;
    }
  }

  // Update Lane Status
  if (track.lane_action_status) {
    const statusRegex = /^\*\*Lane Status\*\*:\s*.+$/m;
    if (statusRegex.test(content)) {
      content = content.replace(statusRegex, `**Lane Status**: ${track.lane_action_status}`);
    } else {
      content = `**Lane Status**: ${track.lane_action_status}\n` + content;
    }
  }

  // Update Progress
  if (track.progress_percent !== undefined) {
    const progressStr = `${track.progress_percent}%`;
    const progressRegex = /^\*\*Progress\*\*:\s*.+$/m;
    if (progressRegex.test(content)) {
      content = content.replace(progressRegex, `**Progress**: ${progressStr}`);
    } else {
      content = `**Progress**: ${progressStr}\n` + content;
    }
  }

  // Update Phase if provided
  if (track.current_phase) {
    const phaseRegex = /^\*\*Phase\*\*:\s*.+$/m;
    if (phaseRegex.test(content)) {
      content = content.replace(phaseRegex, `**Phase**: ${track.current_phase}`);
    } else {
      content = `**Phase**: ${track.current_phase}\n` + content;
    }
  }

  writeFileSync(indexPath, content, 'utf8');
  return { action: 'synced_db_to_file' };
}

// ── Metadata Updates ───────────────────────────────────────────────────────

function updateMetadata(trackNumber) {
  try {
    const metadataPath = 'conductor/tracks-metadata.json';
    let metadata = { format: '1.0', last_checked: new Date().toISOString(), tracks: {} };

    if (existsSync(metadataPath)) {
      metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
    }

    if (!metadata.tracks[trackNumber]) {
      metadata.tracks[trackNumber] = {};
    }

    metadata.tracks[trackNumber].last_db_update = new Date().toISOString();
    metadata.last_checked = new Date().toISOString();

    writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
  } catch (err) {
    console.warn('[remote-sync] Failed to update metadata:', err.message);
  }
}

// ── File Parser ───────────────────────────────────────────────────────────

function parseTrackMarker(content, markerName) {
  const regex = new RegExp(`^\\*\\*${markerName}\\*\\*:\\s*(.+)$`, 'm');
  const match = content.match(regex);
  return match ? match[1].trim() : null;
}

function parseTrackFromFile(filepath) {
  const content = readFileSync(filepath, 'utf8');
  return {
    lane_status: parseTrackMarker(content, 'Lane'),
    lane_action_status: parseTrackMarker(content, 'Lane Status'),
    progress_percent: parseInt(parseTrackMarker(content, 'Progress')) || 0,
    current_phase: parseTrackMarker(content, 'Phase'),
  };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const trackNumber = process.argv[2];

  console.log(`[remote-sync] Syncing from ${collectorUrl}`);
  if (trackNumber) {
    console.log(`[remote-sync] Track: ${trackNumber}`);
  } else {
    console.log('[remote-sync] All tracks');
  }

  try {
    // Load metadata for timestamp comparison
    const metadataPath = 'conductor/tracks-metadata.json';
    let metadata = { format: '1.0', last_checked: new Date().toISOString(), tracks: {} };
    if (existsSync(metadataPath)) {
      metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
    }

    const tracksData = await fetchTracks(trackNumber);
    const tracks = Array.isArray(tracksData) ? tracksData : (tracksData.tracks || []);

    if (tracks.length === 0) {
      console.log('[remote-sync] No tracks to sync');
      return;
    }

    let updated = 0;
    let skipped = 0;

    for (const track of tracks) {
      const trackFolder = findTrackFolder(track.track_number);
      if (!trackFolder) {
        console.warn(`[remote-sync] Track folder not found for ${track.track_number}`);
        skipped++;
        continue;
      }

      const result = updateTrackFile(trackFolder, track, metadata);

      if (result.action === 'synced_db_to_file') {
        // DB → File sync: update metadata with DB timestamp
        metadata.tracks[track.track_number] = {
          ...metadata.tracks[track.track_number],
          last_db_update: new Date().toISOString(),
          last_file_update: new Date(statSync(join(trackFolder, 'index.md')).mtime).toISOString(),
        };
        console.log(`[remote-sync] ✅ Updated track ${track.track_number}: ${track.lane_status} (${track.progress_percent}%) — DB → File`);
        updated++;
      } else if (result.action === 'file_newer') {
        // File → DB sync: extract data from file and sync to API
        const indexPath = join(trackFolder, 'index.md');
        const fileData = parseTrackFromFile(indexPath);

        try {
          await syncTrackToDB(track.track_number, fileData);
          metadata.tracks[track.track_number] = {
            ...metadata.tracks[track.track_number],
            last_file_update: new Date(result.fileMtime).toISOString(),
            last_db_update: new Date().toISOString(),
          };
          console.log(`[remote-sync] ✅ Updated track ${track.track_number}: ${fileData.lane_status || '?'} — File → DB (file was newer)`);
          updated++;
        } catch (err) {
          console.warn(`[remote-sync] ⚠️  Failed to sync track ${track.track_number} to DB`);
          skipped++;
        }
      } else {
        skipped++;
      }
    }

    // Save updated metadata
    writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

    console.log(`[remote-sync] Complete: ${updated} updated, ${skipped} skipped`);
    console.log('[remote-sync] Next: Run /laneconductor init-tracks-summary to update conductor/tracks.md');
  } catch (err) {
    console.error('[remote-sync] Sync failed:', err.message);
    process.exit(1);
  }
}

main();
