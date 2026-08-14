// Merges the status markers a worktree's index.md just had written into it
// (by the exit handler, after a lane action finishes) onto the primary
// checkout's own copy of the same file — everything else about the primary
// copy's structure/body is left untouched.
//
// Lane and Lane Status are included deliberately (Track 1112 dogfood
// incident, 2026-08-14): when a track runs in a worktree, the exit handler
// only ever writes Lane/Lane Status into the WORKTREE's copy — this merge is
// the only thing that ever reaches the primary checkout for that track, so
// excluding them left the primary checkout frozen at its pre-run lane for
// the track's entire time in that worktree.
export function mergeIndexMarkers(existingContent, artifactContent) {
  const markerPatterns = [
    { re: /\*\*Lane\*\*:\s*[^\n]+/i },
    { re: /\*\*Lane Status\*\*:\s*[^\n]+/i },
    { re: /\*\*Progress\*\*:\s*[^\n]+/i },
    { re: /\*\*Phase\*\*:\s*[^\n]+/i },
    { re: /\*\*Summary\*\*:\s*[^\n]+/i },
    { re: /\*\*Waiting for reply\*\*:\s*[^\n]+/i },
  ];

  let merged = existingContent;
  for (const { re } of markerPatterns) {
    const m = artifactContent.match(re);
    if (!m) continue;
    if (re.test(merged)) {
      merged = merged.replace(re, m[0]);
    }
    // If the marker isn't present in the existing file, don't inject it —
    // preserve the file's own structure rather than reshaping it.
  }
  return merged;
}
