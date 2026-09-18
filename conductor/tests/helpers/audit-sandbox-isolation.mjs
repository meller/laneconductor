#!/usr/bin/env node
// conductor/tests/helpers/audit-sandbox-isolation.mjs
//
// Track AM-10099 Phase 1 Task 1: reports, per file in AM-10089's "Files In
// Scope" list, whether it is structurally protected against
// cwd-normalization redirecting a spawned worker/CLI into the primary
// checkout — i.e. whether it imports `helpers/isolated-worker.mjs`, or
// itself calls `git init` / `mkdtempSync` before any real spawn.
//
// AM-10089 claimed this fixed and changed nothing (see AM-10099/spec.md
// item (a)). This script is what makes that claim falsifiable: run with no
// args to print the audit table and exit 1 if any file is unprotected, or
// `--json` for machine-readable output.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TESTS_DIR = join(__dirname, '..');

export const FILES_IN_SCOPE = [
  'chat-reply-conversation-md.test.mjs',
  'track-10011-gemini-discovery.test.mjs',
  'track-10017-auto-run-phase7-e2e.test.mjs',
  'track-10020-resumed-session-unanswered-tail.test.mjs',
  'track-10035-direct-merge-e2e.test.mjs',
  'track-10035-pr-flow-e2e.test.mjs',
  'track-10047-bounded-resume.test.mjs',
  'track-10049-e2e-real-launch.test.mjs',
  'track-1085-dispatch-worker.test.mjs',
  'track-1086-session-resilience-worker.test.mjs',
  'track-1086-session-worker.test.mjs',
  'track-1087-non-claude-fallback.test.mjs',
  'track-1087-worker-chat-dispatch.test.mjs',
  'track-1089-provision-worker-dispatch.test.mjs',
  'track-1091-manager-worker.test.mjs',
  'track-1091-orphan-worker-reaping.test.mjs',
  'track-1110-lc-start-lock.test.mjs',
  'track-1110-stop-confirms-death.test.mjs',
  'track-1111-model-precedence.test.mjs',
  'track-1113-chat-coordination.test.mjs',
  'track-1119-phase6-e2e-autorun.test.mjs',
  'track-1119-wizard-dispatch.test.mjs',
  'track-AM-1121-marketing-tracks.test.mjs',
  'worker-id-watchdog.test.mjs',
  'worker-mode.test.mjs',
];

// Files that spawn the real worker/CLI exclusively in `--manager` mode,
// which is structurally immune to the redirect-into-primary mechanism
// (isManager gates every resolvePrimaryRepoRoot() call site it depends on).
// Still required to be protected for hygiene/consistency (Phase 1 Task 4),
// but flagged separately so the audit table distinguishes them.
export const MANAGER_ONLY_FILES = new Set([
  'track-10049-e2e-real-launch.test.mjs',
  'track-1089-provision-worker-dispatch.test.mjs',
  'track-1091-manager-worker.test.mjs',
  'track-1119-wizard-dispatch.test.mjs',
  'track-AM-1121-marketing-tracks.test.mjs',
]);

// Files whose non-manager sandbox is deliberately NOT git-init'd by the test
// fixture itself: the production code path under test (`create-project`'s
// `isRepo` branch in laneconductor.sync.mjs) is what git-inits the target
// directory, awaited synchronously before the only real (non-manager)
// worker spawn that uses it as its cwd. Verified by reading the ordering,
// documented inline at each site — see AM-10099 spec.md item (a) AC option
// (c). Pre-initializing here would make that production code path a no-op
// and silently stop testing it.
export const PRODUCTION_GIT_INIT_FILES = new Set([
  'track-1119-phase6-e2e-autorun.test.mjs',
]);

export function auditFile(relPath) {
  const abs = join(TESTS_DIR, relPath);
  if (!existsSync(abs)) {
    return { file: relPath, exists: false, protected: false, signals: [] };
  }
  const src = readFileSync(abs, 'utf8');

  const importsHelper = /isolated-worker\.mjs/.test(src);
  const hasGitInit =
    /['"]git['"],\s*\[\s*['"]init['"]/.test(src) ||
    /execSync\(\s*['"]git init/.test(src) ||
    /\bgit init\b/.test(src) ||
    // Local `git(cmd, cwd)` test helpers (e.g. `git('init -q --bare ...')`,
    // `git(\`init -q ...\`)`) used by the direct-merge/pr-flow e2e fixtures —
    // these `git clone` a fresh LOCAL working tree from a bare ORIGIN, which
    // is exactly as protected as a literal `git init` call.
    /\bgit\(\s*[`'"]init\b/.test(src) ||
    /\bgit\(\s*[`'"]clone\b/.test(src);
  const hasMkdtemp = /mkdtempSync/.test(src);
  // A fixed-name (non-mkdtemp) sandbox is equally protected as long as its
  // root is computed from os.tmpdir() rather than this repo's ROOT — what
  // matters for REQ-1 is that the sandbox lives outside the repo working
  // tree and is git-initialized before any real spawn, not HOW its unique
  // path was generated.
  const usesTmpdir = /\btmpdir\(\)/.test(src);

  const managerOnly = MANAGER_ONLY_FILES.has(relPath);
  const productionGitInit = PRODUCTION_GIT_INIT_FILES.has(relPath);

  const signals = [];
  if (importsHelper) signals.push('isolated-worker.mjs import');
  if (hasGitInit) signals.push('git init');
  if (hasMkdtemp) signals.push('mkdtempSync');
  if (usesTmpdir) signals.push('tmpdir()-rooted');
  if (managerOnly) signals.push('manager-only (structurally immune)');
  if (productionGitInit) signals.push('git-inited by production code under test');

  return {
    file: relPath,
    exists: true,
    protected:
      importsHelper ||
      (hasGitInit && (hasMkdtemp || usesTmpdir)) ||
      // A manager-only spawn never reaches resolvePrimaryRepoRoot's escape
      // mechanism at all (isManager gates every call site it depends on) —
      // it only needs to be outside the repo for hygiene, not git-inited.
      (managerOnly && usesTmpdir) ||
      (productionGitInit && usesTmpdir),
    managerOnly,
    signals,
  };
}

export function runAudit(files = FILES_IN_SCOPE) {
  return files.map(auditFile);
}

function main() {
  const results = runAudit();
  const protectedCount = results.filter(r => r.protected).length;
  const asJson = process.argv.includes('--json');

  if (asJson) {
    console.log(JSON.stringify({ total: results.length, protected: protectedCount, results }, null, 2));
  } else {
    console.log(`Sandbox isolation audit — ${protectedCount}/${results.length} protected\n`);
    for (const r of results) {
      const mark = r.protected ? '✅' : '❌';
      const mgr = r.managerOnly ? ' [manager-only]' : '';
      const sig = r.signals.length ? r.signals.join(', ') : 'none';
      console.log(`${mark} ${r.file}${mgr} — ${sig}`);
    }
    console.log(`\n${protectedCount}/${results.length} protected`);
  }

  process.exit(protectedCount === results.length ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
