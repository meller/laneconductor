import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

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

const MERGE_ONLY_ARTIFACTS = new Set(['index.md']);
const ARTIFACTS = ['index.md', 'plan.md', 'spec.md', 'test.md', 'conversation.md', 'quality-gate.md'];

// Copies a worktree's track-doc artifacts back onto the primary checkout's
// copy of the same track — index.md via mergeIndexMarkers() (status markers
// only, body preserved), everything else full-replace, both gated by a
// "does the incoming version look suspiciously truncated" safety check.
//
// Extracted out of the exit-handler's inline block (Track 1112, 2026-08-14)
// so the SAME logic can also run from a startup reconciliation pass (Track
// 1110 Phase 6, 2026-08-14): if the sync worker process restarts while a
// dispatch's child CLI is still running, the child keeps running and
// finishes on its own, but the worker's in-memory `on('exit')` listener for
// it is gone — nothing ever calls this. Making it a standalone function lets
// a reconciliation pass call the identical code path later instead of
// re-deriving a parallel, easy-to-drift copy of the same safety-guard logic.
//
// `resolveTrackFolder` is injected rather than imported — it lives in
// laneconductor.sync.mjs and depends on that module's own track-metadata
// state (ambiguous-folder quarantining), which this module has no business
// knowing about.
export function copyWorktreeArtifactsToPrimary({ worktreePath, trackNumber, isSuccess, primaryRoot, resolveTrackFolder }) {
  const mainTracksDir = join(primaryRoot, 'conductor', 'tracks');
  const wtTracksDir = join(worktreePath, 'conductor', 'tracks');
  const wtTrackDir = existsSync(wtTracksDir) ? resolveTrackFolder(wtTracksDir, trackNumber) : null;
  if (!wtTrackDir) return { copied: [], destDir: null };

  mkdirSync(mainTracksDir, { recursive: true });
  let mainTrackDir = existsSync(mainTracksDir) ? resolveTrackFolder(mainTracksDir, trackNumber) : null;
  if (!mainTrackDir) {
    // Planning agent created the dir inside the worktree — copy whole dir to main
    mainTrackDir = wtTrackDir;
    mkdirSync(join(mainTracksDir, mainTrackDir), { recursive: true });
  }
  const destDir = join(mainTracksDir, mainTrackDir);
  const copied = [];

  for (const file of ARTIFACTS) {
    const src = join(wtTracksDir, wtTrackDir, file);
    const dest = join(destDir, file);
    if (!existsSync(src)) continue;

    if (MERGE_ONLY_ARTIFACTS.has(file) && existsSync(dest)) {
      const artifact = readFileSync(src, 'utf8');
      const merged = mergeIndexMarkers(readFileSync(dest, 'utf8'), artifact);

      const artifactStats = statSync(src);
      const existingStats = statSync(dest);
      const lineCount = artifact.split('\n').length;
      // Suspicious if < 10 lines OR < 50% of existing OR < 500 bytes for markdown files
      const isSuspicious = (lineCount < 10) || (artifactStats.size < existingStats.size * 0.5 && existingStats.size > 100);

      if (isSuspicious && !isSuccess) continue;
      writeFileSync(dest, merged, 'utf8');
    } else {
      const srcStats = statSync(src);
      const destStats = existsSync(dest) ? statSync(dest) : { size: 0 };
      const isSuspicious = srcStats.size < destStats.size * 0.5 && destStats.size > 200;

      if (isSuspicious && !isSuccess) continue;
      copyFileSync(src, dest);
    }
    copied.push(file);
  }

  return { copied, destDir };
}
