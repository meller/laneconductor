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

// Track 10099/AM-1005 (dual-reader incident): entries the scaffold-generate
// step itself may already have written before runCreateProject's git-init
// guard runs — never something a user's own pre-existing directory would
// contain by surprise, and never anything holding a secret value (a
// `.gitignore` or `.env.example` holds only patterns/variable names, never
// real values; unlike `.env` itself, which must stay excluded here).
// `.gitignore`'s absence from this set meant the guard fired on a file the
// SAME dispatch had just created one step earlier — every brand-new
// project's create-project dispatch reported "failed" here unconditionally,
// with the scaffold itself already complete and correct.
export const SCAFFOLD_ENTRIES = new Set(['.laneconductor.json', 'conductor', '.claude', '.agents', '.git', '.env.example', '.gitignore']);

/** Directory entries NOT explained by our own just-written scaffold — a
 * non-empty result means runCreateProject must refuse to git-init (it would
 * otherwise risk `git add -A`-ing a user's own pre-existing files, secrets
 * included, into a fresh history it just created). */
export function filterNonScaffoldEntries(dirEntries) {
  return dirEntries.filter(e => !SCAFFOLD_ENTRIES.has(e));
}

// See spec.md REQ-2b/REQ-3: payload.repo_source is {type: 'path', value} or
// {type: 'git', value, target_path?}. 'path' needs no target resolution —
// value already is the path. 'git' resolves to target_path if given,
// otherwise <projectsDir>/<slug(scaffold_context.project.name)> — and
// fails clearly (not a guess) if neither is available.
export function resolveRepoTarget({ repoSource, scaffoldContext, projectsDir }) {
  if (repoSource?.type === 'path') {
    // has_existing_code: false means the UI's "brand new project" checkbox
    // was unchecked — the path is where the project SHOULD live, not
    // necessarily where it already does. needsMkdir tells the caller it's
    // fine (expected, not an error) for that directory not to exist yet.
    const needsMkdir = scaffoldContext?.project?.has_existing_code === false;
    return { ok: true, targetPath: repoSource.value, needsClone: false, needsMkdir };
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
