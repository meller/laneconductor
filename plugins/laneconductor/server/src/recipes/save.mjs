// Saving a recipe to the person's OWN library (track AM-10117, Phase 3 Task 2, REQ-6). Three rules are enforced here rather than
// left to the procedure: the checker (format, secrets, references) runs first and its result is returned either way; nothing is
// written without `approved: true` (the human's yes); and the save is ONE LOCAL COMMIT that touches only the recipe's own
// folder and is never pushed (this module has no code path that runs `git push`). `retire` is the same shape: a local commit that
// removes the folder; the recipe stays in git history.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkLibraryDir } from './check-library.mjs';
import { NAME_RE } from './format.mjs';

const git = (cwd, args) => execFileSync('git', ['-c', 'core.quotepath=off', ...args], { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

async function requireRepoRoot(libDir) {
  let top;
  try {
    top = git(libDir, ['rev-parse', '--show-toplevel']);
  } catch {
    throw new Error(`${libDir} is not a git repository: the personal library must be a git repo so a save can be a commit (git init it first)`);
  }
  if ((await fs.realpath(top)) !== (await fs.realpath(libDir))) throw new Error(`${libDir} is inside the git repository ${top}; the library must be the root of its own repository`);
}

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  for (const e of await fs.readdir(src, { withFileTypes: true })) {
    if (e.name === '.git') continue;
    if (e.isDirectory()) await copyDir(path.join(src, e.name), path.join(dest, e.name));
    else if (e.isFile()) await fs.copyFile(path.join(src, e.name), path.join(dest, e.name));
  }
}

/** Runs the checker on the draft alone (staged in a temp library) and returns its findings for this recipe. */
export async function checkDraft(draftDir, { resolver = null, now = Date.now() } = {}) {
  const name = path.basename(draftDir);
  const tmp = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'lc-recipe-draft-'));
  try {
    await copyDir(draftDir, path.join(tmp, 'recipes', name));
    const res = await checkLibraryDir(tmp, { resolver, now });
    const findings = res.findings.filter((f) => f.recipe === name || f.recipe === null);
    return { name, findings, errors: findings.filter((f) => f.severity === 'error').length, warnings: findings.filter((f) => f.severity === 'warn').length };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

/**
 * @param {{ libDir: string, draftDir: string, approved?: boolean, resolver?: object|null, now?: number }} o
 * @returns {Promise<{ saved: boolean, reason?: 'checker_errors'|'needs_approval', action?: 'add'|'update', commit?: string, check: object }>}
 */
export async function saveRecipe({ libDir, draftDir, approved = false, resolver = null, now = Date.now() }) {
  const name = path.basename(draftDir);
  if (!NAME_RE.test(name)) throw new Error(`the draft folder name ${JSON.stringify(name)} must be the recipe name in kebab-case`);
  if (!(await fs.stat(path.join(draftDir, 'SKILL.md')).then((s) => s.isFile(), () => false))) throw new Error(`${draftDir} has no SKILL.md`);
  const check = await checkDraft(draftDir, { resolver, now });
  if (check.errors > 0) return { saved: false, reason: 'checker_errors', check };
  if (approved !== true) return { saved: false, reason: 'needs_approval', check };
  await requireRepoRoot(libDir);
  const dest = path.join(libDir, 'recipes', name);
  const action = await fs.stat(dest).then(() => 'update', () => 'add');
  if (action === 'update') await fs.rm(dest, { recursive: true, force: true });
  await copyDir(draftDir, dest);
  const rel = `recipes/${name}`;
  git(libDir, ['add', '--', rel]);
  // The pathspec limits the commit to this recipe: anything else the person has staged stays staged.
  git(libDir, ['commit', '-q', '-m', `recipe: ${action} ${name}`, '--', rel]);
  return { saved: true, action, commit: git(libDir, ['rev-parse', '--short', 'HEAD']), check };
}

/** Retires a recipe: one local commit that removes its folder (history keeps it). Needs the human's yes like a save. */
export async function retireRecipe({ libDir, name, approved = false }) {
  if (!NAME_RE.test(name)) throw new Error(`${JSON.stringify(name)} is not a recipe name`);
  const rel = `recipes/${name}`;
  if (!(await fs.stat(path.join(libDir, rel, 'SKILL.md')).then((s) => s.isFile(), () => false))) throw new Error(`no recipe ${name} in ${libDir}`);
  if (approved !== true) return { retired: false, reason: 'needs_approval' };
  await requireRepoRoot(libDir);
  git(libDir, ['rm', '-r', '-q', '--', rel]);
  git(libDir, ['commit', '-q', '-m', `recipe: retire ${name}`, '--', rel]);
  return { retired: true, commit: git(libDir, ['rev-parse', '--short', 'HEAD']) };
}
