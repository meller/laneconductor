// New-project scaffold (track AM-10117, Phase 1): from the answers of the guided interview, render the `conductor/` context
// files, `.laneconductor.json`, the `.gitignore` entries and the first tracks. Deterministic and dependency-light: the
// interview itself is a Markdown procedure (skill file ops/new-project.md); this is the part that must not be left to chance.
//
// What it never does: it adds no daemon and no database (no `mode`, no collectors), it names in `quality-gate.md`
// only commands the answers say exist, it never overwrites a file that is already there, and it runs no git command that
// writes history (it may `git init`; committing is the human's decision).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fail } from '../errors.mjs';
import { buildTrackFiles, defaultInitials, nextNumber } from '../tracks.mjs';

/** The default lane workflow a new project starts with (the same lanes and transitions as the skill's setup/templates.md). */
export const DEFAULT_WORKFLOW = {
  global: { total_parallel_limit: 3 },
  defaults: { parallel_limit: 1, max_retries: 1 },
  lanes: {
    plan: { parallel_limit: 1, max_retries: 1, on_success: 'plan:success', on_failure: 'backlog' },
    implement: { parallel_limit: 2, max_retries: 3, on_success: 'review:queue', on_failure: 'implement:failure' },
    review: { parallel_limit: 1, max_retries: 1, on_success: 'quality-gate:queue', on_failure: 'implement:queue' },
    'quality-gate': { parallel_limit: 1, max_retries: 1, on_success: 'done:queue', on_failure: 'plan:queue' },
    done: { parallel_limit: 1, max_retries: 1, on_failure: 'done:failure' },
  },
};

/** The `.gitignore` lines a new project gets: the per-machine conversation files and worktree checkouts, nothing from a daemon. */
export const GITIGNORE_LINES = ['conductor/tracks/**/conversation.md', 'conductor/tracks/**/conversation.json', '.worktrees/'];

/** Gate commands in the order the template lists them: [answers.commands key, label, expected]. */
const GATE_CHECKS = [
  ['typecheck', 'Syntax/typecheck', 'no errors'],
  ['lint', 'Lint', 'clean'],
  ['test', 'Unit + integration tests', 'all pass'],
  ['build', 'Build', 'succeeds'],
  ['coverage', 'Coverage', 'at or above the target in the answers'],
  ['audit', 'Security', '0 high/critical'],
];

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const list = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : str(v) ? [str(v)] : []);
const bullets = (xs, empty) => (xs.length ? xs.map((x) => `- ${x}`).join('\n') : empty);
const oneLine = (s) => s.replace(/\s+/g, ' ').trim();

/**
 * Validates and normalizes the interview answers. Unknown keys are ignored; only `name` and `summary` are required, because the
 * interview stops early when answers are enough. Anything left out renders as an honest placeholder, never an invented value.
 */
export function normalizeAnswers(a = {}) {
  const name = str(a.name);
  const summary = str(a.summary);
  if (!name || /[\r\n]/.test(name) || name.length > 80) throw fail('VALIDATION_FAILED', 'answers.name is required: one line, at most 80 characters');
  if (!summary) throw fail('VALIDATION_FAILED', 'answers.summary is required: what the project is for, in one or two sentences');
  const stack = a.stack && typeof a.stack === 'object' ? a.stack : {};
  const commands = {};
  for (const [k] of GATE_CHECKS) if (str(a.commands?.[k])) commands[k] = str(a.commands[k]);
  if (str(a.commands?.e2e)) commands.e2e = str(a.commands.e2e);
  const initials = str(a.initials);
  if (initials && !/^[A-Za-z]{1,4}$/.test(initials)) throw fail('VALIDATION_FAILED', 'answers.initials must be 1 to 4 letters');
  return {
    name,
    summary,
    users: str(a.users),
    features: list(a.features),
    stack: { language: str(stack.language), framework: str(stack.framework), data: str(stack.data), auth: str(stack.auth), hosting: str(stack.hosting), ai: str(stack.ai), testing: str(stack.testing), other: list(stack.other) },
    constraints: list(a.constraints),
    commands,
    kpis: (Array.isArray(a.kpis) ? a.kpis : []).filter((k) => str(k?.metric)).map((k) => ({ metric: str(k.metric), target: str(k.target), horizon: str(k.horizon) })),
    journeys: (Array.isArray(a.journeys) ? a.journeys : []).filter((j) => str(j?.persona) && str(j?.name)).map((j) => ({ persona: str(j.persona), name: str(j.name), flow: list(j.flow) })),
    stateBranch: str(a.stateBranch) || 'main',
    initials,
  };
}

const TBD = '(not decided yet)';

function productMd(a) {
  return [
    `# Product: ${a.name}`, '',
    '## What it is', a.summary, '',
    '## Who uses it', a.users || TBD, '',
    '## Key features', bullets(a.features, TBD), '',
    '## Constraints', bullets(a.constraints, 'None stated.'), '',
  ].join('\n');
}

function techStackMd(a) {
  const s = a.stack;
  const row = (label, v) => `- ${label}: ${v || TBD}`;
  return [
    '# Tech stack', '',
    row('Language', s.language), row('Framework', s.framework), row('Data', s.data), row('Authentication', s.auth),
    row('Hosting and deploy target', s.hosting), row('AI use', s.ai), row('Testing', s.testing),
    ...(s.other.length ? ['', '## Other', ...s.other.map((x) => `- ${x}`)] : []),
    '',
  ].join('\n');
}

function qualityGateMd(a) {
  const c = a.commands;
  const checks = GATE_CHECKS.filter(([k]) => c[k]).map(([k, label, expected]) => `- [ ] ${label}: \`${c[k]}\` (Expected: ${expected})`);
  return [
    '# Quality Gate', '',
    '> Checklist, not a report. Every box starts unchecked and is ticked only by',
    '> whoever ran the command **this time** and saw it pass. Do not trust marks',
    '> left by a previous run.', '',
    '## Automated Checks', '',
    ...(checks.length ? checks : ['(No verification commands exist yet. The walking-skeleton track adds the first one; list it here when it runs.)']),
    '',
    ...(c.e2e ? ['## End-to-End / Real-Product Checks', '', `- [ ] End-to-end: \`${c.e2e}\` (Expected: all specs pass)`, ''] : []),
    '## Manual Quality Review', '',
    '- [ ] Architecture alignment: follows this project\'s established patterns',
    '- [ ] Readability: clear naming, comments explain *why*',
    '- [ ] No stubs in completed work', '',
    '## Verdict', '',
    '- Status: PENDING (set to PASS or FAIL only after running the above)',
    '- Reviewer: (who or what ran it)',
    '- Date: (ISO date of this run)', '',
  ].join('\n');
}

function userStoriesMd(a) {
  if (!a.journeys.length) return '# User Stories\n\nTODO: no user journey was discussed yet. Add the first one when the walking skeleton is planned.\n';
  return ['# User Stories', '', ...a.journeys.flatMap((j) => [`## ${j.persona} - ${j.name}`, `**As a** ${j.persona}, see the flow below.`, '', ...(j.flow.length ? j.flow.map((f, i) => `${i + 1}. ${f}`) : ['Flow: (to be written)']), ''])].join('\n');
}

function kpisMd(a) {
  const rows = a.kpis.length ? a.kpis.map((k) => `| ${k.metric} | ${k.target || TBD} | ${k.horizon || TBD} | tracking | |`) : ['| (none set yet) | | | | |'];
  return ['# Project KPIs', '', '## North-Star Metrics', '', '| Metric | Target | Time Horizon | Status | Notes |', '|--------|--------|--------------|--------|-------|', ...rows, '',
    '## Contributing Tracks', '', 'Tracks with `**Maps To**` referencing a metric above will appear here automatically.', ''].join('\n');
}

const PRODUCT_GUIDELINES = '# Product guidelines\n\n## Brand and tone\n(placeholder: not discussed yet)\n\n## UX principles\n(placeholder: not discussed yet)\n';
const DESIGN_LANGUAGE = '# Design Language\n\n## Color Tokens\n(placeholder: no design tokens yet)\n\n## Typography Scale\n(placeholder)\n\n## Spacing System\n(placeholder)\n\n## Component Conventions\n(placeholder)\n';
const WORKFLOW_MD = `# Workflow

## Commit Strategy
- Conventional Commits: feat/fix/docs/refactor/test/chore
- Include the track number: \`feat(track-NNN): description\`

## Branching Model
- main: production-ready
- one branch per track when work is delegated: track-NNN-description

## Development Process
1. Create a track (\`/laneconductor:new\`), write its spec before coding
2. Implement in phases, one commit per phase
3. Review and quality-gate before merging; ask before any merge or push

## Workflow Configuration
Machine-readable config lives in \`conductor/workflow.json\` (lane transitions, parallel limits, retries).
`;

/** The `.laneconductor.json` of a new project: a state branch and nothing else. No mode, no database, no collectors. */
export function laneconductorConfig(a) {
  return { project: { name: a.name }, connector: { state_branch: a.stateBranch } };
}

/** Map<repo-relative path, content> of every file the scaffold creates (not the tracks, and not `.gitignore`, which is merged). */
export function renderScaffold(answers) {
  const a = normalizeAnswers(answers);
  const json = (v) => `${JSON.stringify(v, null, 2)}\n`;
  return new Map([
    ['conductor/product.md', productMd(a)],
    ['conductor/tech-stack.md', techStackMd(a)],
    ['conductor/workflow.md', WORKFLOW_MD],
    ['conductor/workflow.json', json(DEFAULT_WORKFLOW)],
    ['conductor/product-guidelines.md', PRODUCT_GUIDELINES],
    ['conductor/design-language.md', DESIGN_LANGUAGE],
    ['conductor/quality-gate.md', qualityGateMd(a)],
    ['conductor/user-stories.md', userStoriesMd(a)],
    ['conductor/kpis.md', kpisMd(a)],
    ['conductor/tracks/.gitkeep', ''],
    ['.laneconductor.json', json(laneconductorConfig(a))],
  ]);
}

/**
 * The first tracks, as `buildTrackFiles` output (`{ id, folder, files }`), numbered from the folders already present:
 * the walking skeleton.
 */
export function firstTracks(answers, existingDirs = []) {
  const a = normalizeAnswers(answers);
  const initials = defaultInitials(existingDirs, a.initials);
  return [buildTrackFiles({
    number: nextNumber(existingDirs), initials, title: 'Walking skeleton',
    problem: `Build the thinnest end-to-end slice of ${a.name}: ${oneLine(a.summary)} One input to one visible result, runnable, with the first real test and the first line of conductor/quality-gate.md.`,
  })];
}

/** Appends the lines of `GITIGNORE_LINES` that are missing; returns the new content, or null when nothing is missing. */
export function mergeGitignore(current) {
  const have = new Set((current ?? '').split(/\r?\n/).map((l) => l.trim()));
  const add = GITIGNORE_LINES.filter((l) => !have.has(l));
  if (!add.length) return null;
  const base = current ?? '';
  return `${base}${base === '' || base.endsWith('\n') ? '' : '\n'}${add.join('\n')}\n`;
}

/**
 * Writes the scaffold and the first tracks into `dir`. Existing files are skipped and reported, never overwritten
 * (an existing repository gets only what is missing). `dryRun` writes nothing and reports what it would do. `firstTrack: false` skips
 * the walking-skeleton track, which belongs to a new project: an existing one has its own history to plan from.
 * @returns {{ created: string[], skipped: string[], merged: string[], gitInit: boolean }}
 */
export function writeScaffold(dir, answers, { dryRun = false, gitInit = true, firstTrack = true } = {}) {
  const root = path.resolve(dir);
  const created = [];
  const skipped = [];
  const merged = [];
  const put = (rel, content) => {
    const abs = path.join(root, rel);
    if (fs.existsSync(abs)) { skipped.push(rel); return; }
    created.push(rel);
    if (dryRun) return;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  };
  const trackRoot = path.join(root, 'conductor/tracks');
  const existing = fs.existsSync(trackRoot) ? fs.readdirSync(trackRoot) : [];
  for (const [rel, content] of renderScaffold(answers)) {
    if (rel === 'conductor/tracks/.gitkeep' && existing.length) { skipped.push(rel); continue; } // a folder that already holds tracks needs no placeholder
    put(rel, content);
  }
  const slugOf = (folder) => folder.replace(/^(?:[A-Za-z]+-)?\d+-/, '');
  for (const t of firstTrack ? firstTracks(answers, existing) : []) {
    if (existing.some((d) => slugOf(d) === slugOf(t.folder))) { skipped.push(`conductor/tracks/${t.folder}`); continue; } // a re-run adds no duplicate track
    const base = `conductor/tracks/${t.folder}`;
    put(`${base}/index.md`, t.files.index);
    put(`${base}/spec.md`, t.files.spec);
    put(`${base}/plan.md`, t.files.plan);
    put(`${base}/test.md`, t.files.test);
    put(`${base}/conversation.md`, t.files.conversation);
  }
  const giPath = path.join(root, '.gitignore');
  const gi = mergeGitignore(fs.existsSync(giPath) ? fs.readFileSync(giPath, 'utf8') : null);
  if (gi !== null) {
    merged.push('.gitignore');
    if (!dryRun) fs.writeFileSync(giPath, gi);
  }
  let didInit = false;
  if (gitInit && !fs.existsSync(path.join(root, '.git'))) {
    didInit = true;
    if (!dryRun) {
      fs.mkdirSync(root, { recursive: true });
      const r = spawnSync('git', ['init', '-q', '-b', normalizeAnswers(answers).stateBranch], { cwd: root, encoding: 'utf8' });
      if (r.status !== 0) throw fail('VALIDATION_FAILED', `git init failed: ${r.stderr.trim()}`);
    }
  }
  return { created, skipped, merged, gitInit: didInit };
}
