#!/usr/bin/env node
// LaneConductor Board hooks (track AM-10115 Phase 0, H2 and H3). One script, two events:
//   post  (PostToolUse on the connector's create_track / update_track and on Edit / Write): when a track's files changed, record a
//         "board is stale" marker. Silent otherwise.
//   seen  (run by the refresh command after it published): record the tracks' current state as the one the board shows, and clear the marker, so the
//         next Stop does not ask for a refresh that was just made. No stdin needed.
//   stop  (Stop): ON BY DEFAULT (owner, 2026-11-19). When the marker is set and `board.artifact_url` is stored in the project's
//         .laneconductor.json, clear the marker and ask Claude to run the board refresh once. Only `board.auto_update: false` turns it
//         off; with no stored board there is nothing to refresh. In both cases it is silent. Never blocks for any other reason.
//         Besides the marker it compares a fingerprint of the project's tracks (the tree of conductor/tracks on the state branch, plus the
//         uncommitted changes under it) with the one seen at the last prompt, so a change made by Bash, in a scratch worktree, by another
//         session or by a push is caught too. The first time it only records the fingerprint.
// The marker lives in the plugin's data directory (CLAUDE_PLUGIN_DATA, Claude Code exports it to hook processes), keyed by a hash of the
// project path; never inside the working tree or .git. No network, no file bodies and no secrets printed, exit 0 always. The only child process is
// a read-only `git` (rev-parse, status) for the fingerprint, with a short timeout; any failure means "no fingerprint".
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const CONNECTOR_TOOL = /^mcp__.+__(create_track|update_track)$/;
const TRACK_DOCS = new Set(['index.md', 'plan.md', 'spec.md', 'test.md']); // what the board shows (conversation.md only with board.include_conversation)
const KEEP_MS = 14 * 24 * 3600 * 1000;
const REFRESH = '/laneconductor-board:refresh';

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const str = (v) => (typeof v === 'string' && v !== '' ? v : null);

/** The project roots this event can belong to: the session directory and the project directory, those that have conductor/tracks/. */
function roots(input) {
  const seen = new Set();
  for (const c of [str(input.cwd), str(process.env.CLAUDE_PROJECT_DIR)]) if (c) seen.add(path.resolve(c));
  return [...seen].filter((r) => isDir(path.join(r, 'conductor', 'tracks')));
}

const stateDir = () => path.join(str(process.env.CLAUDE_PLUGIN_DATA) ?? path.join(os.tmpdir(), 'laneconductor-board-hook'), 'state');
// A run from a shell may not have CLAUDE_PLUGIN_DATA, so it writes to the temp fallback; the hook reads both places and the newest `seen` wins.
const stateDirs = () => [...new Set([stateDir(), path.join(os.tmpdir(), 'laneconductor-board-hook', 'state')])];
const keyOf = (root) => { try { return hash(fs.realpathSync(root)); } catch { return hash(root); } };
const markerPath = (root, dir = stateDir()) => path.join(dir, `stale-${keyOf(root)}.json`);
const seenPath = (root, dir = stateDir()) => path.join(dir, `seen-${keyOf(root)}.json`);
const isMarked = (root) => stateDirs().some((d) => fs.existsSync(markerPath(root, d)));
const clearMarkers = (root) => { for (const d of stateDirs()) fs.rmSync(markerPath(root, d), { force: true }); };
/** The fingerprint last recorded for the root: the newest of the files in the places above, or undefined. */
function readSeen(root) {
  let best = null;
  for (const d of stateDirs()) {
    try { const p = seenPath(root, d), t = fs.statSync(p).mtimeMs, fp = readJson(p)?.fp; if (typeof fp === 'string' && (!best || t >= best.t)) best = { t, fp }; } catch { /* none there */ }
  }
  return best?.fp;
}

const git = (root, args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }).trim();
const SAFE_BRANCH = /^[A-Za-z0-9._][A-Za-z0-9._/-]{0,100}$/;

/** A short fingerprint of the project's tracks as the board is built from them, or null (not a git repository, no such branch, any failure). */
function fingerprint(root) {
  try {
    const configured = str(readJson(path.join(root, '.laneconductor.json'))?.connector?.state_branch);
    const branches = configured && SAFE_BRANCH.test(configured) ? [configured] : ['main', 'master'];
    let tree = null;
    for (const b of branches) {
      for (const ref of [`origin/${b}`, b]) {
        try { tree = git(root, ['rev-parse', '--verify', '--quiet', `${ref}:conductor/tracks`]); } catch { tree = null; }
        if (tree) break;
      }
      if (tree) break;
    }
    if (!tree) return null;
    let dirty = '';
    try { dirty = git(root, ['status', '--porcelain', '--untracked-files=all', '--', 'conductor/tracks']); } catch { dirty = ''; }
    return hash(`${tree}\n${dirty}`);
  } catch { return null; }
}

function prune(dir) {
  try {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (Date.now() - fs.statSync(p).mtimeMs > KEEP_MS) fs.rmSync(p, { force: true });
    }
  } catch { /* housekeeping only */ }
}

/** The file this Edit or Write touched, as an absolute path, or null (not a file, or an edit that changes nothing). */
function editedFile(input, root) {
  const ti = input.tool_input;
  const f = ti && typeof ti === 'object' ? str(ti.file_path) : null;
  if (!f) return null;
  if (typeof ti.old_string === 'string' && ti.old_string === ti.new_string) return null;
  return path.resolve(str(input.cwd) ?? root, f);
}

/** Did this tool call change a track the board shows? Returns the project root it belongs to, or null. */
function changedRoot(input) {
  const rs = roots(input);
  if (!rs.length) return null;
  const tool = str(input.tool_name) ?? '';
  const resp = input.tool_response;
  if (resp && typeof resp === 'object' && resp.isError === true) return null;
  if (CONNECTOR_TOOL.test(tool)) {
    if (tool.endsWith('create_track')) return rs[0];
    const a = input.tool_input ?? {};
    const some = (o) => o && typeof o === 'object' && Object.keys(o).length > 0;
    return some(a.files) || some(a.markers) || a.summary !== undefined || a.outcome !== undefined || a.repair_index === true ? rs[0] : null;
  }
  if (tool !== 'Edit' && tool !== 'Write') return null;
  for (const root of rs) {
    const abs = editedFile(input, root);
    if (!abs) return null;
    const m = path.relative(root, abs).split(path.sep).join('/').match(/^conductor\/tracks\/([^/]+)\/([^/]+)$/);
    if (!m || m[1].startsWith('_')) continue;
    if (TRACK_DOCS.has(m[2]) || (m[2] === 'conversation.md' && readJson(path.join(root, '.laneconductor.json'))?.board?.include_conversation === true)) return root;
  }
  return null;
}

function post(input) {
  const root = changedRoot(input);
  if (!root) return;
  const dir = stateDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(markerPath(root), `${JSON.stringify({ at: new Date().toISOString() })}\n`);
  prune(dir);
}

function writeSeen(root, fp) {
  try { fs.mkdirSync(stateDir(), { recursive: true }); fs.writeFileSync(seenPath(root), `${JSON.stringify({ fp })}\n`); } catch { /* housekeeping only */ }
}

/** After a refresh was published: the board now shows the tracks as they are. Silent; a project that is not a git repository only has its marker cleared. */
function seen() {
  for (const root of roots({ cwd: process.cwd() })) {
    const fp = fingerprint(root);
    if (fp) writeSeen(root, fp);
    clearMarkers(root);
  }
}

function stop(input) {
  for (const root of roots(input)) {
    const board = readJson(path.join(root, '.laneconductor.json'))?.board;
    if (!board || typeof board !== 'object') continue; // no readable settings: nothing to do, nothing to say
    const url = str(board.artifact_url);
    const off = board.auto_update === false || board.auto_update === 'false'; // only an explicit false turns the default off
    if (!url || off) continue; // no stored board to refresh, or the person turned it off: nothing to do, nothing to say
    const marked = isMarked(root);
    const fp = fingerprint(root), seen = readSeen(root);
    const moved = Boolean(fp) && typeof seen === 'string' && seen !== fp; // the tracks changed since the last prompt, by any tool
    if (!marked && !moved) { if (fp && typeof seen !== 'string') writeSeen(root, fp); continue; } // first sight: only remember it
    if (input.stop_hook_active === true) return; // already continuing because of a stop hook: never loop (the marker stays for the next turn)
    clearMarkers(root);
    if (fp) writeSeen(root, fp);
    process.stdout.write(`${JSON.stringify({ decision: 'block', reason: `The project board is out of date because a track changed. Run \`${REFRESH}\` now (it publishes only the changed files), then stop. Nothing else is needed.` })}\n`);
    return;
  }
}

try {
  if (process.argv[2] === 'seen') seen();
  else {
    let input = {};
    try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { input = {}; }
    if (input && typeof input === 'object') {
      if (process.argv[2] === 'post') post(input);
      else if (process.argv[2] === 'stop') stop(input);
    }
  }
} catch { /* a hook never breaks the session */ }
process.exitCode = 0;
