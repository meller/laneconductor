// Advice log (REQ-19): append-only JSONL under conductor/advice-log/YYYY-MM.jsonl. This module only
// builds, parses and reads lines; the store appends them (StateStore.appendLog). Lines never carry
// file contents, prompts or error messages: ids, codes, counts and Claude's one-line reasons only.
export const LOG_DIR = 'conductor/advice-log';
export const BETA_PATH = `${LOG_DIR}/beta.json`;
export const KINDS = ['serve', 'outcome', 'call', 'tool_error', 'conflict', 'stale_read', 'empty_result', 'beta_start', 'beta_end', 'push'];

export const logFile = (ts) => `${LOG_DIR}/${ts.slice(0, 7)}.jsonl`;
export const isLogFile = (p) => p.startsWith(`${LOG_DIR}/`) && p.endsWith('.jsonl');
export const isoSeconds = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Stamps a line with the common fields. */
export function makeLine(kind, fields, { now, session, surface }) {
  return { v: 1, ts: isoSeconds(now), kind, session, surface, ...fields };
}

/** @returns {string[]} problems; empty when the line is a valid v1 line. */
export function lineProblems(line) {
  const out = [];
  if (!line || typeof line !== 'object') return ['not an object'];
  if (line.v !== 1) out.push('v must be 1');
  if (typeof line.ts !== 'string' || Number.isNaN(Date.parse(line.ts))) out.push('ts must be an ISO time');
  if (!KINDS.includes(line.kind)) out.push(`unknown kind ${JSON.stringify(line.kind)}`);
  return out;
}

/**
 * The connector-side lines for one tool call: always a `call`, plus `conflict` or `tool_error` for a
 * failure, `stale_read` when a read was not fresh, `empty_result`, and whatever the tool recorded
 * (`serve`, `outcome`).
 */
export function callEvents({ tool, readOnly, ok, code, latencyMs, chars, backend, freshness, staleReasons, empty, recorded, commit }, meta) {
  const line = (kind, fields) => makeLine(kind, fields, meta);
  const out = [line('call', { tool, ok, latency_ms: latencyMs, chars, backend })];
  if (!ok) out.push(code === 'CONFLICT' ? line('conflict', { tool, code }) : line('tool_error', { tool, code }));
  if (ok && readOnly && freshness !== 'fresh') out.push(line('stale_read', { tool, reasons: staleReasons, backend }));
  if (empty) out.push(line('empty_result', { tool }));
  for (const e of recorded) {
    const { kind, ...rest } = e;
    out.push(line(kind, kind === 'serve' ? { ...rest, latency_ms: latencyMs, commit } : rest));
  }
  return out;
}

/** @returns {{ lines: object[], malformed: number }} */
export function parseLog(text) {
  const lines = [];
  let malformed = 0;
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue;
    try {
      const l = JSON.parse(raw);
      if (lineProblems(l).length) malformed++;
      else lines.push(l);
    } catch {
      malformed++;
    }
  }
  return { lines, malformed };
}

/** Every line of every month file, oldest first. */
export async function readLog(store) {
  const files = (await store.listDir(LOG_DIR)).filter((e) => e.type === 'file' && e.name.endsWith('.jsonl')).map((e) => `${LOG_DIR}/${e.name}`).sort();
  const got = await store.readFiles(files);
  const lines = [];
  let malformed = 0;
  for (const f of files) {
    const r = parseLog(got.get(f)?.content ?? '');
    lines.push(...r.lines);
    malformed += r.malformed;
  }
  return { lines, malformed, files: files.length };
}

/** conductor/advice-log/beta.json: `{ "beta_start": ISO, "beta_end": ISO | null }`, written by hand when the human says so. */
export function parseBeta(text) {
  if (text === null || text === undefined) return { start: null, end: null, problems: [] };
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    return { start: null, end: null, problems: [`${BETA_PATH} is not valid JSON`] };
  }
  const problems = [];
  const time = (k) => {
    if (j[k] === undefined || j[k] === null) return null;
    const t = Date.parse(j[k]);
    if (Number.isNaN(t)) problems.push(`${k} is not an ISO time`);
    return Number.isNaN(t) ? null : t;
  };
  const start = time('beta_start');
  const end = time('beta_end');
  if (start !== null && end !== null && end < start) problems.push('beta_end is before beta_start');
  return { start, end, problems };
}
