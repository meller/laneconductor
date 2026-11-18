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
 * @param {Object<string, number>|null} [opts.contentSizeByName] - optional total
 *   content byte-size per candidate folder name, used ONLY as a tie-break when
 *   2+ folders match this track number and none is registered (see below);
 *   the caller computes this (pure function, no fs access itself)
 * @returns {{folder: string|null, quarantine: string[], metadataUpdate: {folder_path: string}|null}}
 */
export function decideTrackFolder({ dirNames, trackNumber, registeredFolder, registeredExists, contentSizeByName = null }) {
  // AM-10046 root cause (2026-09-01): this used to match ONLY bare
  // `${trackNumber}-slug` names, structurally blind to the modern
  // `INITIALS-${trackNumber}-slug` convention (track 10023+). The first
  // time a track ended up with BOTH shapes before either was registered in
  // tracks-metadata.json, the old matcher couldn't see the prefixed one at
  // all, silently defaulted to the bare one, and whatever called this next
  // (syncTrack) locked that wrong answer into metadata permanently —
  // confirmed live corrupting 3 tracks' folder_path in one session
  // (10039, 10045, 10046), each losing real in-flight plan/spec work to
  // the wrong folder until manually recovered. Matching both shapes here
  // closes that blind spot at the source.
  const matches = dirNames
    .filter(name => new RegExp(`^(?:[A-Za-z]+-)?${trackNumber}-`).test(name))
    .sort();

  // No folder of either naming style exists on disk — fall back to the
  // registered folder_path, which newTrack always writes correctly
  // regardless of naming convention.
  if (matches.length === 0) {
    return { folder: registeredExists ? registeredFolder : null, quarantine: [], metadataUpdate: null };
  }

  // A lone match (either naming style) is the common, unambiguous case —
  // EXCEPT when metadata registers a DIFFERENT, currently-existing folder.
  // That combination only arises when a prefixed track has a stale
  // duplicate sitting next to it (track 1119). Quarantine the stale match
  // instead of trusting it.
  if (matches.length === 1) {
    if (registeredExists && registeredFolder !== matches[0]) {
      return { folder: registeredFolder, quarantine: [matches[0]], metadataUpdate: null };
    }
    return { folder: matches[0], quarantine: [], metadataUpdate: null };
  }

  // Genuinely ambiguous: 2+ folders match this track number. Registered
  // metadata wins if it names one of them — an already-verified answer.
  let canonical;
  if (registeredExists && matches.includes(registeredFolder)) {
    canonical = registeredFolder;
  } else if (contentSizeByName) {
    // Nothing registered — this is exactly the corruption window. Rather
    // than defaulting to matches[0] (alphabetical — arbitrary, and
    // confirmed to pick the WRONG folder in 2 of 3 live incidents),
    // prefer whichever candidate actually has real content: an
    // accidentally-created duplicate is near-empty; the track that's
    // genuinely been worked on has accumulated real index/spec/plan/test/
    // conversation content. Falls back to matches[0] below on a tie or
    // missing size data — same as the old, unconditional behavior.
    let best = matches[0];
    let bestSize = contentSizeByName[best] ?? -1;
    for (const name of matches.slice(1)) {
      const size = contentSizeByName[name] ?? -1;
      if (size > bestSize) { best = name; bestSize = size; }
    }
    canonical = best;
  } else {
    canonical = matches[0];
  }

  const quarantine = matches.filter(name => name !== canonical);
  // Skip the metadata write when the registered value is already correct
  // — nothing changed, no need to touch tracks-metadata.json.
  const metadataUpdate = (registeredExists && registeredFolder === canonical) ? null : { folder_path: canonical };

  return { folder: canonical, quarantine, metadataUpdate };
}
