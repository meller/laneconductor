// conductor/services/track-folder.mjs
// Track 10040 Phase 3 (REQ-15, Finding 6): the canonical track-folder
// resolution DECISION, extracted from laneconductor.sync.mjs's
// resolveTrackFolder as a pure function so a read-only consumer (the `lc
// track-dir` CLI, and the implement skill's own instructions) can resolve
// a folder WITHOUT mutating the tree as a side effect of answering a
// question. The worker's resolveTrackFolder becomes a thin wrapper around
// this that applies the returned quarantine/metadataUpdate as real effects
// (rename, tracks-metadata.json write) — behavior must stay byte-identical
// to what it was before this extraction; the quarantine semantics here are
// load-bearing (track 1119, confirmed live: trusting a stale legacy match
// blindly fed git-add/commit into the wrong folder repeatedly).
//
// Pure module, no I/O — mirrors workspace-mode.mjs's extraction style.

/**
 * Decides which folder is canonical for a track number, and what
 * bookkeeping (quarantine renames, metadata update) the caller should
 * apply as a result. Performs NO I/O itself.
 *
 * @param {object} opts
 * @param {string[]} opts.dirNames - every directory name under conductor/tracks/
 *   (already directory-filtered by the caller; this function does no fs access)
 * @param {string} opts.trackNumber
 * @param {string|null} opts.registeredFolder - basename of tracks-metadata.json's
 *   registered folder_path for this track, or null if unregistered
 * @param {boolean} opts.registeredExists - whether registeredFolder is actually
 *   present in dirNames (caller determines this, since only it can stat)
 * @returns {{folder: string|null, quarantine: string[], metadataUpdate: {folder_path: string}|null}}
 */
export function decideTrackFolder({ dirNames, trackNumber, registeredFolder, registeredExists }) {
  const matches = dirNames
    .filter(name => name.startsWith(`${trackNumber}-`))
    .sort();

  // Legacy folders are named `${trackNumber}-slug`. Newer tracks (since
  // track 10023) use `INITIALS-${trackNumber}-slug`, which never matches
  // that prefix — fall back to the registered folder_path, which newTrack
  // always writes correctly regardless of naming convention.
  if (matches.length === 0) {
    return { folder: registeredExists ? registeredFolder : null, quarantine: [], metadataUpdate: null };
  }

  // A lone legacy-pattern match is the common, unambiguous case — EXCEPT
  // when metadata registers a DIFFERENT, currently-existing folder. That
  // combination only arises when a prefixed track has a stale legacy-named
  // duplicate sitting next to it (track 1119). Quarantine the stale match
  // instead of trusting it.
  if (matches.length === 1) {
    if (registeredExists && registeredFolder !== matches[0]) {
      return { folder: registeredFolder, quarantine: [matches[0]], metadataUpdate: null };
    }
    return { folder: matches[0], quarantine: [], metadataUpdate: null };
  }

  const canonical = (registeredExists && matches.includes(registeredFolder)) ? registeredFolder : matches[0];
  const quarantine = matches.filter(name => name !== canonical);

  return { folder: canonical, quarantine, metadataUpdate: { folder_path: canonical } };
}
