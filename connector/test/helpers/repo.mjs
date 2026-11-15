// Fixture repos for the connector tests. Every fixture lives under os.tmpdir() and gets its OWN
// `git init` (track 10082 hazard: a fixture without one would resolve to an enclosing checkout).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const WORKFLOW_JSON = JSON.stringify({
  lanes: {
    plan: { on_success: 'plan:success' },
    implement: { on_success: 'review:queue' },
    review: { on_success: 'quality-gate:queue' },
    'quality-gate': { on_success: 'done:queue' },
    done: {},
  },
}, null, 2);

export function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' },
  }).trimEnd();
}

/** Creates a throwaway repo with a conductor/ skeleton and one commit on `main`. */
export function makeRepo({ branch = 'main', workflow = true, files = {}, prefix = 'lc-conn-' } = {}) {
  const real = fs.realpathSync(os.tmpdir());
  const dir = fs.mkdtempSync(path.join(real, prefix));
  git(dir, 'init', '-q', '-b', branch);
  git(dir, 'config', 'user.name', 'Connector Test');
  git(dir, 'config', 'user.email', 'connector-test@example.invalid');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'config', 'core.hooksPath', path.join(dir, '.git', 'hooks'));
  const all = { 'conductor/tracks/.gitkeep': '', ...(workflow ? { 'conductor/workflow.json': WORKFLOW_JSON } : {}), ...files };
  for (const [rel, content] of Object.entries(all)) writeFile(dir, rel, content);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'fixture: initial');
  return dir;
}

export function writeFile(dir, rel, content) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

export function readFile(dir, rel) {
  return fs.readFileSync(path.join(dir, rel), 'utf8');
}

export function commitAll(dir, message = 'fixture: change') {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', message);
  return git(dir, 'rev-parse', 'HEAD');
}

/** Gives `dir` a local bare remote `origin` and pushes main with upstream tracking. */
export function addRemote(dir, branch = 'main') {
  const real = fs.realpathSync(os.tmpdir());
  const bare = fs.mkdtempSync(path.join(real, 'lc-conn-bare-'));
  execFileSync('git', ['init', '-q', '--bare', '-b', branch, bare]);
  git(dir, 'remote', 'add', 'origin', bare);
  git(dir, 'push', '-q', '-u', 'origin', branch);
  return bare;
}

export function rm(...dirs) {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
}

export const INDEX = (n, title, { lane = 'plan', status = 'queue', extra = '' } = {}) =>
  `# Track AM-${n}: ${title}\n\n**Lane**: ${lane}\n**Lane Status**: ${status}\n**Progress**: 0%\n**Phase**: New\n**Type**: dev\n${extra}**Summary**: ${title} summary\n`;
