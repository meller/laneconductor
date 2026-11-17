// Fixtures for the recipe tests (track 10107). Libraries and reference repos are throwaway repos
// under os.tmpdir(), each with its own `git init` (track 10082 hazard). Fake secrets are built at
// test time so no key-shaped literal is ever committed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addRemote, commitAll, git, writeFile } from './repo.mjs';

/** A repo with only `files`, one commit on main, its own `git init`, under os.tmpdir(). */
export function initRepo(prefix, files) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Recipe Test');
  git(dir, 'config', 'user.email', 'recipe-test@example.invalid');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'config', 'core.hooksPath', path.join(dir, '.git', 'hooks'));
  for (const [rel, content] of Object.entries(files)) writeFile(dir, rel, content);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'fixture: initial');
  return dir;
}

export const fakeGoogleKey = () => `AIza${'Q'.repeat(35)}`;
export const fakeGithubToken = () => `ghp_${'a1'.repeat(18)}`;
export const fakeSkKey = () => `sk-${'Z9'.repeat(12)}`;
export const fakeAwsKey = () => `AKIA${'B7'.repeat(8)}`;
export const fakePemHeader = () => `-----BEGIN ${'RSA '}PRIVATE KEY-----`;
export const fakeDbUrl = () => `postgresql://app:${'hunter2'}@db.example.com:5432/x`;

export const BODY = [
  '## Why this works for you', 'Because it did, on two projects.', '',
  '## Recommendation', '- Use the site `<product>-laneconductor`.', '',
  '## Claude does', '- Write `.firebaserc` from `files/`.', '',
  '## You run', '1. `firebase hosting:sites:create <product>-laneconductor --project laneconductor-site`', '',
  '## Pitfalls', '- Never run a bare deploy.', '',
].join('\n');

const yamlList = (xs, pad = '    ') => xs.map((x) => `${pad}- ${x}`).join('\n');

/** A complete, valid SKILL.md. `fm` overrides pieces; pass `raw` to replace the whole frontmatter. */
export function skill({ name = 'sample-recipe', description = 'Host a sample product on shared hosting.', when_to_use = 'Use when a new web app needs hosting.', paths = 'firebase.json, .firebaserc', kind = 'recipe', stack = '[gcp, firebase-hosting]', refs, verified = '2026-11-15', extraMeta = '', body = BODY, raw = null, top = '' } = {}) {
  const references = refs ?? [{ repo: 'o/r', path: 'a.txt', commit: 'abc1234' }];
  const refYaml = references.length
    ? `  reference:\n${references.map((r) => `    - repo: ${r.repo}\n      path: ${r.path}\n      commit: "${r.commit}"\n      proves: it exists`).join('\n')}\n`
    : '';
  const fm = raw ?? [
    `name: ${name}`,
    `description: ${JSON.stringify(description)}`,
    when_to_use === null ? null : `when_to_use: ${JSON.stringify(when_to_use)}`,
    paths === null ? null : `paths: ${JSON.stringify(paths)}`,
    top || null,
    'metadata:',
    `  kind: ${kind}`,
    `  stack: ${stack}`,
    '  prerequisites:',
    yamlList(['The user is signed in.'], '    '),
    refYaml.trimEnd() || null,
    `  verified: ${verified}`,
    extraMeta || null,
  ].filter((l) => l !== null).join('\n');
  return `---\n${fm}\n---\n\n${body}`;
}

/** A library repo: recipes/<name>/SKILL.md (+ files) and optional advice log lines, committed on main. */
export function makeLibrary(recipes = {}, { files = {}, origin = null } = {}) {
  const all = { ...files };
  for (const [name, def] of Object.entries(recipes)) {
    const spec = typeof def === 'string' ? { text: def } : def;
    all[`recipes/${name}/SKILL.md`] = spec.text ?? skill({ name, ...spec.skill });
    for (const [rel, content] of Object.entries(spec.files ?? {})) all[`recipes/${name}/files/${rel}`] = content;
  }
  const dir = initRepo('lc-lib-', Object.keys(all).length ? all : { '.gitkeep': '' });
  if (origin) git(dir, 'remote', 'add', 'origin', origin);
  return dir;
}

/** A reference repo with `file` committed in two versions; returns the dir and both commits. */
export function makeRefRepo({ origin = 'git@github.com:o/r.git', file = 'a.txt' } = {}) {
  const dir = initRepo('lc-ref-', { [file]: 'one\n' });
  const first = git(dir, 'rev-parse', 'HEAD');
  git(dir, 'remote', 'add', 'origin', origin);
  return { dir, first, second: () => { writeFile(dir, file, 'two\n'); return commitAll(dir, 'change'); }, remove: () => { git(dir, 'rm', '-q', file); return commitAll(dir, 'delete'); } };
}

export { addRemote };
