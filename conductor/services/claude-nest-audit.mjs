// conductor/services/claude-nest-audit.mjs
//
// Track AM-10096: the .claude/.claude nesting bug (see claude-dir-copy.mjs's
// header for the root cause) left a real, physically-materialized nest on
// this repository's main (5 levels, 480 tracked files, 6.4MB) and in 40-plus
// existing worktrees and two other projects. Phase 2/3 stop new growth;
// this module is the cleanup half — and it is a REFUSAL-FIRST tool, not a
// deletion tool, per the track's own standing instruction to investigate
// rather than blindly delete unfamiliar nested state (REQ-7).
//
// The shape of this specific bug is a single linear chain: .claude/.claude,
// then .claude/.claude/.claude, and so on — never branching, confirmed by
// direct inspection of every affected repository. findNestingChain() walks
// exactly that chain; it does not attempt to find every .claude anywhere
// in a tree (that is a different, much broader question this track never
// needed to answer).
//
//   findNestingChain(claudeRoot)      — pure I/O: level 1 through the
//                                        deepest existing nested level.
//   auditNestedClaude(claudeRoot)     — compares level 1 against every
//                                        deeper level; reports unique files
//                                        (never seen at level 1) and newer
//                                        files (same relative path, but the
//                                        deeper copy's mtime is later).
//   cleanNestedClaude(claudeRoot, {fix}) — report-only unless fix:true;
//                                        refuses to delete when the audit
//                                        found any unique file, and says
//                                        which ones (REQ-7).

import { existsSync, statSync, readdirSync, rmSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * @param {string} claudeRoot - path to a `.claude` directory (level 1)
 * @returns {string[]} absolute paths, level 1 first, through the deepest
 *   existing `.claude/.claude/...` chain. Length 1 means no nesting.
 */
export function findNestingChain(claudeRoot) {
  const levels = [];
  let current = claudeRoot;
  while (existsSync(current) && statSync(current).isDirectory()) {
    levels.push(current);
    current = join(current, '.claude');
  }
  return levels;
}

/**
 * Lists every file under `dir`, as a Map of POSIX-style relative path ->
 * { mtimeMs, size }, excluding anything under a nested `.claude` entry
 * (that belongs to the next level in the chain, audited separately).
 */
function listFiles(dir) {
  const out = new Map();
  function walk(current) {
    let entries;
    try { entries = readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === '.claude') continue; // next level in the chain
      const full = join(current, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.isFile()) {
        const rel = relative(dir, full).split(sep).join('/');
        const st = statSync(full);
        out.set(rel, { mtimeMs: st.mtimeMs, size: st.size });
      }
    }
  }
  walk(dir);
  return out;
}

/**
 * @param {string} claudeRoot - path to a `.claude` directory (level 1)
 * @returns {{
 *   depth: number,
 *   levels: Array<{ path: string, depth: number, fileCount: number, byteSize: number }>,
 *   uniqueFiles: Array<{ depth: number, path: string }>,
 *   newerFiles: Array<{ depth: number, path: string, level1MtimeMs: number, deeperMtimeMs: number }>
 * }}
 */
export function auditNestedClaude(claudeRoot) {
  const chain = findNestingChain(claudeRoot);
  const depth = chain.length;
  const level1Files = chain.length > 0 ? listFiles(chain[0]) : new Map();

  const levels = [];
  const uniqueFiles = [];
  const newerFiles = [];

  for (let i = 1; i < chain.length; i++) {
    const levelPath = chain[i];
    const levelDepth = i + 1;
    const files = listFiles(levelPath);
    let byteSize = 0;
    for (const [relPath, meta] of files) {
      byteSize += meta.size;
      const atLevel1 = level1Files.get(relPath);
      if (!atLevel1) {
        uniqueFiles.push({ depth: levelDepth, path: relPath });
      } else if (meta.mtimeMs > atLevel1.mtimeMs) {
        newerFiles.push({ depth: levelDepth, path: relPath, level1MtimeMs: atLevel1.mtimeMs, deeperMtimeMs: meta.mtimeMs });
      }
    }
    levels.push({ path: levelPath, depth: levelDepth, fileCount: files.size, byteSize });
  }

  return { depth, levels, uniqueFiles, newerFiles };
}

/**
 * @param {string} claudeRoot - path to a `.claude` directory (level 1)
 * @param {{ fix?: boolean }} [opts]
 * @returns {{ ok: boolean, removed: boolean, audit: ReturnType<typeof auditNestedClaude>, reason?: string }}
 */
export function cleanNestedClaude(claudeRoot, opts = {}) {
  const audit = auditNestedClaude(claudeRoot);

  if (audit.depth <= 1) {
    return { ok: true, removed: false, audit, reason: 'no nesting found' };
  }

  if (audit.uniqueFiles.length > 0) {
    return {
      ok: false,
      removed: false,
      audit,
      reason: `refusing to delete — ${audit.uniqueFiles.length} file(s) exist only at a nested depth: ` +
        audit.uniqueFiles.map(f => `depth ${f.depth}: ${f.path}`).join(', ')
    };
  }

  if (!opts.fix) {
    return { ok: true, removed: false, audit, reason: 'report-only (pass fix:true to delete)' };
  }

  rmSync(join(claudeRoot, '.claude'), { recursive: true, force: true });
  return { ok: true, removed: true, audit };
}
