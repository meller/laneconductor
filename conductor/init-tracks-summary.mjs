#!/usr/bin/env node
// conductor/init-tracks-summary.mjs
// Generate/regenerate conductor/tracks.md from all track files
// Usage: node conductor/init-tracks-summary.mjs

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

// ── Parsers ────────────────────────────────────────────────────────────────

function parseTrackMarker(content, markerName) {
  const regex = new RegExp(`^\\*\\*${markerName}\\*\\*:\\s*(.+)$`, 'm');
  const match = content.match(regex);
  return match ? match[1].trim() : null;
}

function parseProgress(content) {
  const match = content.match(/^\*\*Progress\*\*:\s*(\d+)%/m);
  return match ? parseInt(match[1]) : 0;
}

// ── Track Collection ───────────────────────────────────────────────────────

function collectTracks() {
  const tracksDir = 'conductor/tracks';
  if (!existsSync(tracksDir)) {
    console.error('[init-tracks-summary] Error: conductor/tracks directory not found');
    return [];
  }

  const tracks = [];
  const dirs = readdirSync(tracksDir);

  for (const dir of dirs) {
    const indexPath = join(tracksDir, dir, 'index.md');
    if (!existsSync(indexPath)) continue;

    const content = readFileSync(indexPath, 'utf8');
    const match = dir.match(/^(\d+)-(.+)$/);
    if (!match) continue;

    const trackNumber = match[1];
    const trackSlug = match[2];

    const track = {
      number: trackNumber,
      slug: trackSlug,
      title: parseTrackMarker(content, 'title') || parseTrackMarker(content, 'Title') || trackSlug,
      lane: parseTrackMarker(content, 'Lane') || 'plan',
      progress: parseProgress(content),
    };

    tracks.push(track);
  }

  return tracks.sort((a, b) => parseInt(a.number) - parseInt(b.number));
}

// ── Summary Generation ────────────────────────────────────────────────────

function generateSummary(tracks) {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);

  // Count by lane
  const counts = {
    plan: 0,
    implement: 0,
    review: 0,
    'quality-gate': 0,
    backlog: 0,
    done: 0,
  };

  const byLane = {};
  for (const lane of Object.keys(counts)) {
    byLane[lane] = [];
  }

  for (const track of tracks) {
    const lane = track.lane.toLowerCase();
    if (counts.hasOwnProperty(lane)) {
      counts[lane]++;
      byLane[lane].push(track);
    }
  }

  let summary = `# Track Summary\n\n`;
  summary += `Last Updated: ${timestamp} UTC\n`;
  summary += `Total Tracks: ${tracks.length} | `;
  summary += `Plan: ${counts.plan} | `;
  summary += `Implement: ${counts.implement} | `;
  summary += `Review: ${counts.review} | `;
  summary += `Quality-Gate: ${counts['quality-gate']} | `;
  summary += `Done: ${counts.done}\n\n`;

  // By lane sections
  const laneOrder = ['plan', 'implement', 'review', 'quality-gate', 'backlog', 'done'];
  for (const lane of laneOrder) {
    const laneTracks = byLane[lane];
    if (laneTracks.length === 0) continue;

    const laneTitle = lane.charAt(0).toUpperCase() + lane.slice(1).replace('-', ' ');
    summary += `## ${laneTitle}\n\n`;

    for (const track of laneTracks) {
      const progress = track.progress > 0 ? ` (${track.progress}%)` : '';
      summary += `- **${track.number}**: ${track.title}${progress}\n`;
    }

    summary += '\n';
  }

  return summary;
}

// ── Main ───────────────────────────────────────────────────────────────────

function main() {
  console.log('[init-tracks-summary] Scanning conductor/tracks...');

  const tracks = collectTracks();
  console.log(`[init-tracks-summary] Found ${tracks.length} tracks`);

  const summary = generateSummary(tracks);
  const summaryPath = 'conductor/tracks.md';

  writeFileSync(summaryPath, summary, 'utf8');
  console.log(`[init-tracks-summary] ✅ Generated ${summaryPath}`);
  console.log(`[init-tracks-summary] Summary:\n${summary}`);
}

main();
