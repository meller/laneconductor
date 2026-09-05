// conductor/services/track-folder-fs.mjs
// Track 10063 Phase 1: the filesystem-fact-gathering half of track-folder
// resolution, extracted so every reader — the worker's resolveTrackFolder,
// `lc track-dir`, and the Collector API's syncTrackToFile + siblings — asks
// the SAME question the SAME way. decideTrackFolder (./track-folder.mjs)
// already made the pure decision correct and shared; the bug this track
// fixes is that three different callers were gathering the input facts
// three different ways (one of them, syncTrackToFile, not calling
// decideTrackFolder at all), so they reached three different answers for
// the same track number.
//
// Pure with respect to the filesystem: reads directories, reads metadata,
// stats file sizes — but never renames a folder and never writes metadata.
// Applying decideTrackFolder's quarantine/metadataUpdate as real effects is
// the worker's job alone (conductor/laneconductor.sync.mjs's
// resolveTrackFolder) — a lookup must never mutate the tree as a side
// effect of answering "where is this track".

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, basename } from 'path';
import { decideTrackFolder } from './track-folder.mjs';

/**
 * Gathers the filesystem facts decideTrackFolder needs and returns its
 * decision unapplied.
 *
 * @param {object} opts
 * @param {string} opts.tracksDir - absolute or cwd-relative path to conductor/tracks
 * @param {string} opts.trackNumber
 * @param {string} [opts.metadataPath] - path to tracks-metadata.json; read fresh
 *   from disk on every call. Ignored when `lookupRegisteredFolder` is given.
 *   Omit both to treat every track as unregistered (still correct, just loses
 *   the registration tie-break).
 * @param {(trackNumber: string) => ({folder_path?: string}|null)} [opts.lookupRegisteredFolder] -
 *   caller-supplied lookup (e.g. the worker's own cached tracks-metadata.json
 *   reader) used INSTEAD of reading `metadataPath` from disk. Lets a hot-path
 *   caller that already maintains an in-memory metadata cache avoid a
 *   redundant disk read on every single resolution.
 * @returns {{folder: string|null, quarantine: string[], metadataUpdate: {folder_path: string}|null, matches: number, registeredFolder: string|null}}
 */
export function resolveTrackFolderFs({ tracksDir, trackNumber, metadataPath, lookupRegisteredFolder }) {
  const dirNames = existsSync(tracksDir)
    ? readdirSync(tracksDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)
    : [];

  let registeredFolder = null;
  if (typeof lookupRegisteredFolder === 'function') {
    const meta = lookupRegisteredFolder(trackNumber);
    registeredFolder = meta?.folder_path ? basename(meta.folder_path) : null;
  } else if (metadataPath && existsSync(metadataPath)) {
    try {
      const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
      const meta = metadata.tracks?.[trackNumber] || metadata[trackNumber];
      registeredFolder = meta?.folder_path ? basename(meta.folder_path) : null;
    } catch {
      // Malformed metadata — treat as unregistered. A read-only lookup
      // must never throw because a sibling file is corrupt.
    }
  }
  const registeredExists = !!(registeredFolder && dirNames.includes(registeredFolder));

  // Same cheap pre-check the worker's resolveTrackFolder uses: only pay for
  // the directory-size walk when 2+ folders could plausibly match.
  const candidateNames = dirNames.filter(name => name.includes(trackNumber));
  let contentSizeByName = null;
  if (candidateNames.length > 1) {
    contentSizeByName = {};
    for (const name of candidateNames) {
      try {
        const dirPath = join(tracksDir, name);
        let total = 0;
        for (const f of readdirSync(dirPath)) {
          try { total += statSync(join(dirPath, f)).size; } catch { /* unreadable entry — skip */ }
        }
        contentSizeByName[name] = total;
      } catch { /* unreadable dir — leave unset, decideTrackFolder treats missing as -1 */ }
    }
  }

  const decision = decideTrackFolder({ dirNames, trackNumber, registeredFolder, registeredExists, contentSizeByName });

  const folderRegex = new RegExp(`^(?:[A-Za-z]+-)?${trackNumber}-`);
  const matches = dirNames.filter(name => folderRegex.test(name)).length;

  return { folder: decision.folder, quarantine: decision.quarantine, metadataUpdate: decision.metadataUpdate, matches, registeredFolder };
}
