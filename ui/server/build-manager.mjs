import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { execSync } from 'child_process';

/**
 * Resolves Git metadata for a repository path safely.
 */
export function getGitMetadata(repoPath) {
  if (!repoPath || !existsSync(repoPath)) {
    return { commit: 'unknown', shortCommit: 'unknown', branch: 'unknown' };
  }
  try {
    const commit = execSync('git rev-parse HEAD', { cwd: repoPath, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const shortCommit = execSync('git rev-parse --short HEAD', { cwd: repoPath, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoPath, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return { commit, shortCommit, branch };
  } catch (err) {
    return { commit: 'unknown', shortCommit: 'unknown', branch: 'unknown' };
  }
}

/**
 * List all build artifacts in conductor/builds/ ordered by creation timestamp descending.
 */
export function getBuilds(repoPath) {
  if (!repoPath || !existsSync(repoPath)) return [];

  const buildsDir = join(repoPath, 'conductor', 'builds');
  if (!existsSync(buildsDir)) return [];

  const files = readdirSync(buildsDir).filter(f => f.startsWith('build-') && f.endsWith('.json'));
  const builds = [];

  for (const file of files) {
    try {
      const filePath = join(buildsDir, file);
      const raw = readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw);
      if (data && data.id && data.createdAt) {
        builds.push(data);
      }
    } catch (e) {
      // Ignore unparseable or corrupted build files
    }
  }

  builds.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return builds;
}

/**
 * Get a single build artifact by build ID.
 */
export function getBuildById(repoPath, buildId) {
  if (!repoPath || !buildId) return null;
  const filePath = join(repoPath, 'conductor', 'builds', `${buildId}.json`);
  if (!existsSync(filePath)) return null;

  try {
    const raw = readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

/**
 * Parse metadata from a track folder's index.md.
 */
export function parseTrackIndex(trackFolderPath) {
  const indexFile = join(trackFolderPath, 'index.md');
  if (!existsSync(indexFile)) return null;

  try {
    const content = readFileSync(indexFile, 'utf8');
    const lines = content.split('\n');

    let title = '';
    let lane = '';
    let laneStatus = '';
    let type = 'dev';
    let summary = '';
    let completedAt = null;

    const titleMatch = content.match(/^# Track (\d+):\s*(.+)$/m);
    const trackNumber = titleMatch ? titleMatch[1] : null;
    if (titleMatch) {
      title = titleMatch[2].trim();
    }

    const laneMatch = content.match(/\*\*Lane\*\*:\s*(.+)$/m);
    if (laneMatch) lane = laneMatch[1].trim();

    const statusMatch = content.match(/\*\*(?:Lane Status|Status)\*\*:\s*(.+)$/m);
    if (statusMatch) laneStatus = statusMatch[1].trim();

    const typeMatch = content.match(/\*\*Type\*\*:\s*(.+)$/m);
    if (typeMatch) type = typeMatch[1].trim();

    const summaryMatch = content.match(/\*\*Summary\*\*:\s*(.+)$/m);
    if (summaryMatch) summary = summaryMatch[1].trim();

    const completedAtMatch = content.match(/Completed At:\s*(.+)$/m);
    if (completedAtMatch) {
      completedAt = completedAtMatch[1].trim();
    }

    // Fallback summary from Problem block if Summary field not found
    if (!summary) {
      const problemBlock = content.match(/## Problem\s*\n+([^#]+)/);
      if (problemBlock) {
        summary = problemBlock[1].trim().split('\n')[0];
      }
    }

    const stat = statSync(indexFile);
    const mtimeIso = stat.mtime.toISOString();

    return {
      trackNumber,
      title,
      lane,
      laneStatus,
      type,
      summary: summary || title,
      completedAt: completedAt || mtimeIso,
      mtimeMs: stat.mtimeMs
    };
  } catch (err) {
    return null;
  }
}

/**
 * Find completed tracks in conductor/tracks/ since lastBuildCreatedAt.
 */
export function getCompletedTracksSince(repoPath, lastBuildCreatedAt = null) {
  if (!repoPath || !existsSync(repoPath)) return [];
  const tracksDir = join(repoPath, 'conductor', 'tracks');
  if (!existsSync(tracksDir)) return [];

  const trackDirs = readdirSync(tracksDir).filter(d => /^\d+-/.test(d));
  const completedTracks = [];
  const lastTime = lastBuildCreatedAt ? new Date(lastBuildCreatedAt).getTime() : 0;

  for (const dirName of trackDirs) {
    const trackPath = join(tracksDir, dirName);
    const trackInfo = parseTrackIndex(trackPath);
    if (!trackInfo || !trackInfo.trackNumber) continue;

    const isCompleted = (
      trackInfo.lane === 'done' ||
      trackInfo.laneStatus === 'success' ||
      trackInfo.laneStatus === 'completed' ||
      trackInfo.completedAt
    );

    if (isCompleted) {
      const trackTime = new Date(trackInfo.completedAt).getTime() || trackInfo.mtimeMs;
      if (!lastTime || trackTime > lastTime) {
        completedTracks.push(trackInfo);
      }
    }
  }

  // Sort by track number ascending
  completedTracks.sort((a, b) => parseInt(a.trackNumber, 10) - parseInt(b.trackNumber, 10));
  return completedTracks;
}

/**
 * Synthesizes Markdown release notes and categorized summaries from a set of tracks.
 */
export function synthesizeReleaseNotes(tracks, buildId) {
  const categories = {
    features: [],
    fixes: [],
    improvements: []
  };

  const featureLines = [];
  const fixLines = [];
  const improvementLines = [];

  for (const track of tracks) {
    const entryStr = `${track.title} (Track ${track.trackNumber})`;
    const typeLower = (track.type || '').toLowerCase();
    const titleLower = (track.title || '').toLowerCase();

    if (typeLower.includes('fix') || typeLower.includes('bug') || titleLower.includes('fix') || titleLower.includes('bug')) {
      categories.fixes.push(entryStr);
      fixLines.push(`- **${track.title}** (Track ${track.trackNumber}): ${track.summary}`);
    } else if (typeLower.includes('refactor') || typeLower.includes('clean') || titleLower.includes('cleanup')) {
      categories.improvements.push(entryStr);
      improvementLines.push(`- **${track.title}** (Track ${track.trackNumber}): ${track.summary}`);
    } else {
      categories.features.push(entryStr);
      featureLines.push(`- **${track.title}** (Track ${track.trackNumber}): ${track.summary}`);
    }
  }

  const markdownParts = [];
  if (featureLines.length > 0) {
    markdownParts.push('### 🚀 Features & Enhancements\n' + featureLines.join('\n'));
  }
  if (fixLines.length > 0) {
    markdownParts.push('### 🐛 Bug Fixes\n' + fixLines.join('\n'));
  }
  if (improvementLines.length > 0) {
    markdownParts.push('### 🧹 Refactoring & Improvements\n' + improvementLines.join('\n'));
  }

  if (markdownParts.length === 0) {
    markdownParts.push('### 📦 General Release\n- General system updates and operational enhancements.');
  }

  const markdown = markdownParts.join('\n\n');
  const title = `Release ${buildId}`;

  return {
    title,
    markdown,
    categories
  };
}

/**
 * Generate a new build artifact and save it to conductor/builds/<build_id>.json.
 */
export function createBuildArtifact(repoPath, options = {}) {
  if (!repoPath || !existsSync(repoPath)) {
    throw new Error('Invalid project repo_path');
  }

  const conductorDir = join(repoPath, 'conductor');
  const buildsDir = join(conductorDir, 'builds');
  if (!existsSync(buildsDir)) {
    mkdirSync(buildsDir, { recursive: true });
  }

  const existingBuilds = getBuilds(repoPath);
  const lastBuild = existingBuilds[0] || null;
  const lastBuildCreatedAt = lastBuild ? lastBuild.createdAt : null;

  let tracksToInclude = getCompletedTracksSince(repoPath, lastBuildCreatedAt);

  // If explicit track numbers were passed, filter to those
  if (options.trackIds && Array.isArray(options.trackIds) && options.trackIds.length > 0) {
    const trackSet = new Set(options.trackIds.map(t => t.toString()));
    const allTrackDirs = readdirSync(join(repoPath, 'conductor', 'tracks')).filter(d => /^\d+-/.test(d));
    const customTracks = [];
    for (const dir of allTrackDirs) {
      const info = parseTrackIndex(join(repoPath, 'conductor', 'tracks', dir));
      if (info && trackSet.has(info.trackNumber)) {
        customTracks.push(info);
      }
    }
    if (customTracks.length > 0) {
      tracksToInclude = customTracks;
    }
  }

  // Generate build timestamp and ID
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const timeStr = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const buildId = `build-${dateStr}-${timeStr}`;

  const gitMeta = getGitMetadata(repoPath);
  const releaseNotes = synthesizeReleaseNotes(tracksToInclude, buildId);

  const buildArtifact = {
    id: buildId,
    createdAt: now.toISOString(),
    git: gitMeta,
    tracks: tracksToInclude.map(t => t.trackNumber),
    summary: releaseNotes,
    createdBy: options.createdBy || 'system'
  };

  const artifactPath = join(buildsDir, `${buildId}.json`);
  writeFileSync(artifactPath, JSON.stringify(buildArtifact, null, 2) + '\n', 'utf8');

  return buildArtifact;
}
