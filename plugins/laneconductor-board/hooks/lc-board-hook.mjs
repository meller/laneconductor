#!/usr/bin/env node
// LaneConductor Board hooks (track AM-10115 Phase 0, H2 and H3). One script, two events:
//   post  (PostToolUse on the connector's create_track / update_track and on Edit / Write): when a track's files changed, record a
//         "board is stale" marker. Silent otherwise.
//   stop  (Stop): when the marker is set and `board.auto_update` is true in the project's .laneconductor.json and `board.artifact_url`
//         is stored, clear the marker and ask Claude to run the board refresh once. Without the option, say once per session that the
//         board is out of date. Never blocks for any other reason.
// The marker lives in the plugin's data directory (CLAUDE_PLUGIN_DATA, Claude Code exports it to hook processes), keyed by a hash of the
// project path; never inside the working tree or .git. No network, no child process, no file bodies and no secrets printed, exit 0 always.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

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
const keyOf = (root) => { try { return hash(fs.realpathSync(root)); } catch { return hash(root); } };
const markerPath = (root) => path.join(stateDir(), `stale-${keyOf(root)}.json`);

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

function stop(input) {
  for (const root of roots(input)) {
    const marker = markerPath(root);
    if (!fs.existsSync(marker)) continue;
    const board = readJson(path.join(root, '.laneconductor.json'))?.board;
    if (!board || typeof board !== 'object') return; // no readable settings: nothing to do, nothing to say
    const url = str(board.artifact_url);
    if (board.auto_update === true && url) {
      if (input.stop_hook_active === true) return; // already continuing because of a stop hook: never loop (the marker stays for the next turn)
      fs.rmSync(marker, { force: true });
      process.stdout.write(`${JSON.stringify({ decision: 'block', reason: `The project board is out of date because a track changed. Run \`${REFRESH}\` now (it publishes only the changed files), then stop. Nothing else is needed.` })}\n`);
      return;
    }
    // Option off (or no stored board): one line per session, then silence.
    const dir = stateDir();
    const once = path.join(dir, `warned-${hash(`${str(input.session_id) ?? 'no-session'}|${root}`)}`);
    if (fs.existsSync(once)) return;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(once, '');
    prune(dir);
    const hint = url ? 'set board.auto_update to true in .laneconductor.json to refresh it automatically' : 'no board is stored yet: run /laneconductor:board';
    process.stdout.write(`${JSON.stringify({ systemMessage: `LaneConductor: the board is out of date (a track changed). Run ${REFRESH}, or ${hint}.` })}\n`);
    return;
  }
}

try {
  let input = {};
  try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { input = {}; }
  if (input && typeof input === 'object') {
    if (process.argv[2] === 'post') post(input);
    else if (process.argv[2] === 'stop') stop(input);
  }
} catch { /* a hook never breaks the session */ }
process.exitCode = 0;
