#!/usr/bin/env node
// conductor/scripts/clean-nested-claude.mjs
//
// Track AM-10096: guarded cleanup for the .claude/.claude nesting bug (see
// conductor/services/claude-dir-copy.mjs for the root cause and
// conductor/services/claude-nest-audit.mjs for the audit logic this wraps).
//
// Report-only by default. Only deletes with --fix, and even then only when
// the audit found nothing unique at a deeper level — refusing and naming
// the file otherwise (REQ-7). This is deliberate: cleanup here touches
// 40-plus worktrees across three repositories, and a plain `rm -rf` nobody
// can audit afterwards is exactly the risk this track's own problem
// statement called out.
//
// Usage:
//   node conductor/scripts/clean-nested-claude.mjs [repo-path]              # report only
//   node conductor/scripts/clean-nested-claude.mjs [repo-path] --fix        # delete if safe
//   node conductor/scripts/clean-nested-claude.mjs [repo-path] --worktrees  # also audit .worktrees/*
//   node conductor/scripts/clean-nested-claude.mjs [repo-path] --fix --worktrees
//   node conductor/scripts/clean-nested-claude.mjs [repo-path] --baseline <path>
//
// --baseline overrides what nested content is compared against (default:
// repo-path's own .claude, and always what --worktrees compares EVERY
// worktree against, regardless of this flag). Needed when repo-path is
// itself a worktree rather than a real primary checkout: a plain git
// worktree never has third-party skills checked out at its own top level
// (they're gitignored), so auditing it against its own .claude produces a
// false "unique content" refusal for every one of them — found live running
// this tool for real. Point --baseline at the actual primary checkout's
// .claude in that case.
//
// Exit codes: 0 = nothing to do, or cleaned successfully; 1 = refused
// because unique content was found (nothing deleted); 2 = usage error.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { auditNestedClaude, cleanNestedClaude } from '../services/claude-nest-audit.mjs';

function parseArgs(argv) {
  const args = { fix: false, worktrees: false, repoPath: '.', baseline: null };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fix') args.fix = true;
    else if (a === '--worktrees') args.worktrees = true;
    else if (a === '--baseline') {
      args.baseline = argv[++i];
      if (!args.baseline) {
        console.error('--baseline requires a path argument');
        process.exit(2);
      }
    } else if (a.startsWith('--')) {
      console.error(`Unknown flag: ${a}`);
      process.exit(2);
    } else positional.push(a);
  }
  if (positional.length > 1) {
    console.error('Usage: clean-nested-claude.mjs [repo-path] [--fix] [--worktrees] [--baseline <path>]');
    process.exit(2);
  }
  if (positional.length === 1) args.repoPath = positional[0];
  return args;
}

function formatBytes(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

function reportOne(label, claudeRoot, baselineDir) {
  if (!existsSync(claudeRoot)) {
    console.log(`${label}: no .claude directory — nothing to do`);
    return { hadNesting: false, refused: false };
  }
  const audit = auditNestedClaude(claudeRoot, { baselineDir });
  if (audit.depth <= 1) {
    console.log(`${label}: single .claude, no nesting — nothing to do`);
    return { hadNesting: false, refused: false };
  }
  const totalFiles = audit.levels.reduce((s, l) => s + l.fileCount, 0);
  const totalBytes = audit.levels.reduce((s, l) => s + l.byteSize, 0);
  console.log(`${label}: nested ${audit.depth} levels deep, ${totalFiles} file(s), ${formatBytes(totalBytes)}`);
  for (const level of audit.levels) {
    console.log(`  depth ${level.depth}: ${level.fileCount} file(s), ${formatBytes(level.byteSize)}`);
  }
  if (audit.uniqueFiles.length > 0) {
    console.log(`  ⚠️  ${audit.uniqueFiles.length} file(s) unique to a nested depth (would refuse --fix):`);
    for (const f of audit.uniqueFiles) console.log(`    depth ${f.depth}: ${f.path}`);
  }
  if (audit.newerFiles.length > 0) {
    console.log(`  ⚠️  ${audit.newerFiles.length} file(s) where the nested copy is NEWER than level 1:`);
    for (const f of audit.newerFiles) console.log(`    depth ${f.depth}: ${f.path}`);
  }
  return { hadNesting: true, refused: audit.uniqueFiles.length > 0 };
}

function cleanOne(label, claudeRoot, fix, baselineDir) {
  const result = cleanNestedClaude(claudeRoot, { fix, baselineDir });
  if (!result.ok) {
    console.error(`${label}: ${result.reason}`);
    return false;
  }
  if (result.removed) {
    console.log(`${label}: removed nested .claude (was ${result.audit.depth} levels deep)`);
  } else if (fix) {
    console.log(`${label}: ${result.reason}`);
  }
  return true;
}

function listWorktrees(repoPath) {
  const worktreesDir = join(repoPath, '.worktrees');
  if (!existsSync(worktreesDir)) return [];
  return readdirSync(worktreesDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => ({ name: e.name, path: join(worktreesDir, e.name) }))
    .filter(w => { try { return statSync(w.path).isDirectory(); } catch { return false; } });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoPath = resolve(args.repoPath);
  if (!existsSync(repoPath)) {
    console.error(`Repository path does not exist: ${repoPath}`);
    process.exit(2);
  }

  // The primary checkout's own top-level .claude is the one place all
  // skills are genuinely installed on disk (gitignore only keeps most of
  // them out of git, never off disk) — the correct baseline for judging
  // whether ANY nested copy (main's own, or a worktree's) is pure
  // duplication. A worktree's OWN top level is never a safe baseline: see
  // auditNestedClaude's doc comment for why (gitignore + git worktree add).
  const mainClaudeRoot = join(repoPath, '.claude');
  const repoBaseline = args.baseline ? resolve(args.baseline) : mainClaudeRoot;
  const targets = [{ label: 'main', claudeRoot: mainClaudeRoot, baselineDir: repoBaseline }];
  if (args.worktrees) {
    for (const wt of listWorktrees(repoPath)) {
      targets.push({ label: `worktree ${wt.name}`, claudeRoot: join(wt.path, '.claude'), baselineDir: repoBaseline });
    }
  }

  let anyRefused = false;
  for (const { label, claudeRoot, baselineDir } of targets) {
    const { refused } = reportOne(label, claudeRoot, baselineDir);
    if (refused) anyRefused = true;
  }

  if (args.fix) {
    console.log('');
    for (const { label, claudeRoot, baselineDir } of targets) {
      if (!existsSync(claudeRoot)) continue;
      const ok = cleanOne(label, claudeRoot, true, baselineDir);
      if (!ok) anyRefused = true;
    }
  }

  process.exit(anyRefused ? 1 : 0);
}

main();
