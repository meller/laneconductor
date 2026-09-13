// conductor/services/scaffold-gitignore.mjs
// Track AM-10097: the scaffold gitignore template used to exist as three
// unlinked copies — this repo's own .gitignore (hand-maintained), a string
// list inlined in bin/lc.mjs's `setup` command, and a fenced prose block in
// SKILL.md's skill-only scaffold instructions. They drifted: .conv-cursor and
// .worktrees/ were added here by hand months apart from ever reaching either
// scaffold consumer, so every OTHER project set up via `lc setup` or the
// skill-only path accumulated the exact dirty-checkout noise this repo had
// already fixed for itself. One shared source, so the next new pattern is
// added once, not silently forgotten in two of three places.
//
// Kept deliberately free of any git/network I/O beyond the one .gitignore
// file it reads and writes — testable against a plain tmp directory, no
// collector or DB required.

/**
 * Secrets/identity that must never be committed. Distinct from
 * RUNTIME_STATE_PATTERNS below: these can contain real credentials or
 * project-identifying config, not just disposable sync bookkeeping.
 */
export const SECRET_PATTERNS = [
  { pattern: '.env', why: 'holds real credentials (DB password, API tokens) — never committed' },
  { pattern: '.laneconductor.json', why: 'project identity/config, regenerated per machine by `lc setup`' },
];

/**
 * Pure DB/API-synced or per-machine runtime state — never meaningful
 * content, never worth a diff or a git blame. Left tracked, any one of
 * these shows up as a permanent "uncommitted changes" entry that trips the
 * main-mode lane actions' clean-checkout gate (conductor/services/
 * workspace-mode.mjs's findDisqualifyingDirtyPaths) and blocks every merge
 * project-wide — not just the one track whose file happens to be dirty.
 *
 * Deliberately excludes conductor/tracks/**\/index.md — unlike everything
 * here, index.md carries real authored content (a track's Problem/Solution
 * write-up) that IS worth tracking. See track AM-10097's own conversation.md
 * for the macrodash incident that first raised the question.
 */
export const RUNTIME_STATE_PATTERNS = [
  { pattern: 'conductor/tracks/**/conversation.md', why: 'comment threads sync via the DB/API layer, not git' },
  { pattern: 'conductor/tracks/**/conversation.json', why: 'comment threads sync via the DB/API layer, not git' },
  { pattern: '.conv-cursor', why: 'per-track sync cursor position, written by laneconductor.sync.mjs' },
  { pattern: '.worktrees/', why: 'git worktree checkouts, created by `git worktree add` — must never be tracked in the main tree' },
  { pattern: 'conductor/.runs/', why: 'per-run dispatch/pid-liveness markers (track 10020)' },
  { pattern: '.prespawn-block-count', why: 'per-track pre-spawn block streak counter, written by conductor/services/prespawn-block-counter.mjs' },
  { pattern: '.prespawn-block-kind', why: 'per-track pre-spawn block streak counter, written by conductor/services/prespawn-block-counter.mjs' },
];

const ALL_PATTERNS = [...SECRET_PATTERNS, ...RUNTIME_STATE_PATTERNS];

/**
 * Does an existing .gitignore line already satisfy `pattern`?
 *
 * Line-aware, not naive-substring: a project that already has the
 * path-scoped spelling `conductor/tracks/**\/.prespawn-block-count` must be
 * recognised as already covering the bare `.prespawn-block-count` pattern —
 * otherwise every already-fixed project (macrodash included) would get a
 * redundant duplicate line on its next `lc setup` re-run. Strips a leading
 * `#` (never let a commented-out line count as active) and a leading `/`
 * (gitignore's root-anchor spelling) before comparing.
 */
function lineSatisfiesPattern(rawLine, pattern) {
  const line = rawLine.trim();
  if (!line || line.startsWith('#')) return false;
  const normalised = line.replace(/^\/+/, '');
  return normalised === pattern || normalised.endsWith(`/${pattern}`);
}

function isPatternPresent(gitignoreContent, pattern) {
  return gitignoreContent.split('\n').some(line => lineSatisfiesPattern(line, pattern));
}

/**
 * Ensures `projectRoot`'s .gitignore covers every secret and runtime-state
 * pattern above. Creates the file (with a grouped, commented template) if
 * absent; otherwise appends only whatever is actually missing, never
 * rewriting or reordering a line the project already has.
 *
 * @param {string} projectRoot
 * @param {{ existsSync, readFileSync, writeFileSync, appendFileSync }} fsImpl
 *   Injected so this stays testable against a plain object in a tmp dir
 *   without touching the real filesystem module more than once per caller.
 * @returns {{ created: boolean, added: string[] }}
 */
export function ensureScaffoldGitignore(projectRoot, fsImpl) {
  const { existsSync, readFileSync, writeFileSync, appendFileSync } = fsImpl;
  const gitignorePath = `${projectRoot}/.gitignore`;

  if (!existsSync(gitignorePath)) {
    const template = [
      '# Secrets — never committed',
      ...SECRET_PATTERNS.map(({ pattern }) => pattern),
      '',
      '# Runtime state — DB/API-synced or per-machine, never meaningful content',
      ...RUNTIME_STATE_PATTERNS.map(({ pattern }) => pattern),
      '',
    ].join('\n');
    writeFileSync(gitignorePath, template);
    return { created: true, added: ALL_PATTERNS.map(p => p.pattern) };
  }

  const content = readFileSync(gitignorePath, 'utf8');
  const missing = ALL_PATTERNS.filter(({ pattern }) => !isPatternPresent(content, pattern));
  if (missing.length === 0) return { created: false, added: [] };

  const needsLeadingNewline = content.length > 0 && !content.endsWith('\n');
  const block = missing.map(({ pattern }) => pattern).join('\n') + '\n';
  appendFileSync(gitignorePath, (needsLeadingNewline ? '\n' : '') + block);
  return { created: false, added: missing.map(p => p.pattern) };
}
