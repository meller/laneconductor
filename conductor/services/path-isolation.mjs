// conductor/services/path-isolation.mjs
// Extracted from laneconductor.sync.mjs (track 1033) so it can also be
// reused by conductor/services/worktree-merge.mjs (track 1112) without
// importing laneconductor.sync.mjs itself — that file runs setIntervals
// and chokidar watchers as module-load side effects, which must never fire
// just because something imported a helper function from it.

import { resolve } from 'node:path';

// Ensures `proposedPath` resolves inside `<projectRoot>/.worktrees` and
// inside `projectRoot` itself, and that `identifier` (a track number or
// other path segment) contains no traversal characters.
export function validatePathIsolation(identifier, proposedPath, projectRoot = process.cwd()) {
  if (identifier.includes('..') || identifier.includes('/') || identifier.includes('\\')) {
    throw new Error(`[isolation] Invalid identifier (path traversal attempt): ${identifier}`);
  }

  const root = resolve(projectRoot);
  const worktreeBase = resolve(root, '.worktrees');
  const resolvedPath = resolve(proposedPath);

  if (!resolvedPath.startsWith(worktreeBase)) {
    throw new Error(`[isolation] Proposed path is outside .worktrees: ${resolvedPath}`);
  }
  if (!resolvedPath.startsWith(root)) {
    throw new Error(`[isolation] Proposed path is outside project root: ${resolvedPath}`);
  }

  return resolvedPath;
}
