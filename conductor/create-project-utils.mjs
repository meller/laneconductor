#!/usr/bin/env node
// conductor/create-project-utils.mjs
// Track 1091 Phase 3: pure repo_source resolution for a create-project
// dispatch, kept separate from checkDispatchInbox (real I/O — git clone,
// spawning claude) so the path/slug decisions are unit-testable directly.

import { join } from 'node:path';

export function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// See spec.md REQ-2b/REQ-3: payload.repo_source is {type: 'path', value} or
// {type: 'git', value, target_path?}. 'path' needs no target resolution —
// value already is the path. 'git' resolves to target_path if given,
// otherwise <projectsDir>/<slug(scaffold_context.project.name)> — and
// fails clearly (not a guess) if neither is available.
export function resolveRepoTarget({ repoSource, scaffoldContext, projectsDir }) {
  if (repoSource?.type === 'path') {
    return { ok: true, targetPath: repoSource.value, needsClone: false };
  }

  if (repoSource?.type === 'git') {
    if (repoSource.target_path) {
      return { ok: true, targetPath: repoSource.target_path, needsClone: true, gitUrl: repoSource.value };
    }
    if (projectsDir) {
      const slug = slugify(scaffoldContext?.project?.name || 'new-project');
      return { ok: true, targetPath: join(projectsDir, slug), needsClone: true, gitUrl: repoSource.value };
    }
    return {
      ok: false,
      error: 'No projects directory configured and no target_path given — restart with lc worker start --manager --projects-dir <path>',
    };
  }

  return { ok: false, error: `Unknown repo_source.type: "${repoSource?.type}"` };
}
