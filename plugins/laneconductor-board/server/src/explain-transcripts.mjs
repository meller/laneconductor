// Track AM-10155 (Task 4): reads Claude session transcripts (JSON Lines) and keeps NUMBERS ONLY.
//
// Privacy (REQ-4, a hard requirement). A transcript holds prompts, replies, tool inputs, tool results and file contents. This module
// parses each line but retains only: timestamps, token counts, tool NAMES, tool-call ids, the session id, a sub-agent id, a track NUMBER
// (from a branch such as `track-10155`, a worktree folder `.worktrees/10155`, or the sub-agent's meta description) and, for the tool
// `Read` only, a short hash of the file path so repeats can be counted (the path itself is dropped at once and never leaves this
// function). No text of any message, input or result is stored, returned, logged or thrown. Errors name a file by its basename only.
// Phase 8 (D16, D17) adds, per reply: the model id, the effort level and the thinking token count. The model id, the effort and every tool
// NAME are free text in a transcript, so each goes through an allow-list (a short fixed shape, else the word "other"): a token, an email or a
// prompt that landed in one of those fields never leaves this module.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import crypto from 'node:crypto';

const TRACK_BRANCH = /^track-(\d+)/;
const TRACK_WORKTREE = /\/\.worktrees\/(\d+)(?:\/|$)/;
const TRACK_WORDS = /\btrack\s+(?:[A-Za-z]+-)?(\d+)\b/i;

/** The folder name Claude uses for a project path: every character that is not a letter or digit becomes a dash. */
export const projectFolderName = (p) => p.replace(/[^A-Za-z0-9]/g, '-');

/** The model id of a reply: a `claude-` id of a short fixed shape, `synthetic` for the placeholder replies no model wrote, `unknown` when absent, else `other`. */
export const cleanModel = (v) => {
  if (v === '<synthetic>') return 'synthetic';
  if (typeof v !== 'string') return 'unknown';
  return /^claude-[a-z0-9-]{1,48}$/.test(v) ? v : 'other';
};
/** An effort level of a line: a short lower-case word, else `other`; null when the line does not carry one (perTurnEffort wins over effort: the two never differ on the lines that carry both). */
export const cleanEffort = (o) => {
  const v = typeof o.perTurnEffort === 'string' ? o.perTurnEffort : typeof o.effort === 'string' ? o.effort : null;
  if (v === null) return null;
  return /^[a-z]{2,10}$/.test(v) ? v : 'other';
};
/** A tool name: letters, digits and a few separators (the names of built-in and MCP tools), else `other`. */
export const cleanTool = (v) => (typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(v) ? v : 'other');

const num = (v) => (Number.isFinite(v) ? v : 0);
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
const within = (cwd, roots) => typeof cwd === 'string' && roots.some((r) => cwd === r || cwd.startsWith(`${r}/`));

/** The track number a line belongs to by its branch or working directory, or null. */
export function trackOfLine(branch, cwd) {
  const b = TRACK_BRANCH.exec(typeof branch === 'string' ? branch : '');
  if (b) return Number(b[1]);
  const w = TRACK_WORKTREE.exec(typeof cwd === 'string' ? cwd : '');
  return w ? Number(w[1]) : null;
}

/**
 * Reads one transcript file. Returns { messages, results, count } where
 *  messages: Map id -> { id, ts, session, agent, owner, usage: {output, fresh, cacheCreated, cacheRead}, model, effort, thinking, tools: [{ id, name, ts, fileKey }] }
 *    (effort: a level or null; thinking: the thinking token count or null when the reply does not record it)
 *  results:  Map toolUseId -> ts (ms)
 *  count:    lines that were in this repository (cwd under `roots`)
 * `agentOwner` is the track number the sub-agent's meta file names, or null.
 */
export async function readTranscriptFile(file, { roots, agentOwner = null, since = 0 }) {
  const messages = new Map();
  const results = new Map();
  const skipped = { outsideRepo: 0 };
  let inRepo = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    const isAssistant = line.includes('"type":"assistant"');
    const isUser = !isAssistant && line.includes('"type":"user"') && line.includes('"tool_result"');
    if (!isAssistant && !isUser) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const ts = Date.parse(o.timestamp);
    if (Number.isNaN(ts) || ts < since) continue;
    if (!within(o.cwd, roots)) { if (isAssistant && o.message?.id) skipped.outsideRepo += 1; continue; }
    if (isUser) {
      for (const c of Array.isArray(o.message?.content) ? o.message.content : []) {
        if (c?.type === 'tool_result' && typeof c.tool_use_id === 'string') results.set(c.tool_use_id, ts);
      }
      continue;
    }
    const m = o.message;
    if (!m || typeof m.id !== 'string') continue;
    inRepo += 1;
    const u = m.usage ?? {};
    let e = messages.get(m.id);
    if (!e) {
      e = { id: m.id, ts, session: typeof o.sessionId === 'string' ? o.sessionId : '', agent: typeof o.agentId === 'string' ? o.agentId : null, owner: agentOwner ?? trackOfLine(o.gitBranch, o.cwd), usage: { output: 0, fresh: 0, cacheCreated: 0, cacheRead: 0 }, model: cleanModel(m.model), effort: null, thinking: null, tools: [] };
      messages.set(m.id, e);
    }
    // The same response is written once per content block, with the same usage (a streaming line can hold a smaller output count): the largest value wins, once per response.
    e.ts = Math.min(e.ts, ts);
    e.usage.output = Math.max(e.usage.output, num(u.output_tokens));
    e.usage.fresh = Math.max(e.usage.fresh, num(u.input_tokens));
    e.usage.cacheCreated = Math.max(e.usage.cacheCreated, num(u.cache_creation_input_tokens));
    e.usage.cacheRead = Math.max(e.usage.cacheRead, num(u.cache_read_input_tokens));
    if (e.effort === null) e.effort = cleanEffort(o);
    const th = u.output_tokens_details?.thinking_tokens;
    if (Number.isFinite(th)) e.thinking = Math.max(e.thinking ?? 0, th);
    for (const c of Array.isArray(m.content) ? m.content : []) {
      if (c?.type !== 'tool_use' || typeof c.id !== 'string' || e.tools.some((t) => t.id === c.id)) continue;
      const name = cleanTool(c.name);
      const fp = name === 'Read' && typeof c.input?.file_path === 'string' ? hash(c.input.file_path) : null;
      e.tools.push({ id: c.id, name, ts, fileKey: fp });
    }
  }
  return { messages, results, count: inRepo, skipped };
}

/** The track number a sub-agent's meta file names ("... track 10155 ..."), or null. Only the digits are kept. */
export function readAgentOwner(metaFile) {
  try {
    const d = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    const m = TRACK_WORDS.exec(typeof d?.description === 'string' ? d.description : '');
    return m ? Number(m[1]) : null;
  } catch { return null; }
}

/** The transcript files that can hold this repository's sessions: project folders named after `root` (and its worktrees), with their sub-agent files. */
export function listTranscriptFiles(projectsDir, root, sinceMs = 0) {
  const base = projectFolderName(root);
  const out = [];
  let dirs = [];
  try { dirs = fs.readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory() && (d.name === base || d.name.startsWith(`${base}-`))); } catch { return out; }
  const fresh = (f) => { try { return fs.statSync(f).mtimeMs >= sinceMs; } catch { return false; } };
  for (const d of dirs) {
    const dir = path.join(projectsDir, d.name);
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith('.jsonl') && fresh(path.join(dir, e.name))) out.push({ file: path.join(dir, e.name), sub: false, owner: null });
      if (e.isDirectory()) {
        const subDir = path.join(dir, e.name, 'subagents');
        let subs = [];
        try { subs = fs.readdirSync(subDir); } catch { continue; }
        for (const f of subs) {
          if (!/^agent-.+\.jsonl$/.test(f) || !fresh(path.join(subDir, f))) continue;
          out.push({ file: path.join(subDir, f), sub: true, owner: readAgentOwner(path.join(subDir, f.replace(/\.jsonl$/, '.meta.json'))) });
        }
      }
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/** Everything in scope for `track`: messages of this repository that are not another track's, plus the counts of what was left out. */
export async function collectMessages({ projectsDir, roots, root, track, sinceMs }) {
  const files = listTranscriptFiles(projectsDir, root, sinceMs);
  const messages = [];
  const results = new Map();
  const skipped = { otherTrack: 0, outsideRepo: 0 };
  const sessions = new Set();
  let mainFiles = 0;
  let subFiles = 0;
  for (const f of files) {
    const r = await readTranscriptFile(f.file, { roots, agentOwner: f.owner, since: sinceMs });
    skipped.outsideRepo += r.skipped.outsideRepo;
    if (r.count) { if (f.sub) subFiles += 1; else mainFiles += 1; }
    for (const [k, v] of r.results) results.set(k, v);
    for (const m of r.messages.values()) {
      if (m.owner !== null && m.owner !== track) { skipped.otherTrack += 1; continue; }
      if (m.session) sessions.add(m.session);
      messages.push({ ...m, sub: f.sub });
    }
  }
  return { messages, results, skipped, sessions: [...sessions].sort(), mainFiles, subFiles };
}
