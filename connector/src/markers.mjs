// Marker lines in a track's index.md: `**Name**: value`. Only the HEADER BLOCK counts: everything
// before the first `## ` heading (markers further down are prose, not state). A marker's value may
// continue over following lines (e.g. **Problem**) until the next marker or the first `## `.
import { blobSha } from './blob.mjs';
import { fail } from './errors.mjs';

const MARKER_RE = /^\*\*([A-Za-z][A-Za-z0-9 ]{0,39})\*\*: ?(.*)$/;
const NAME_RE = /^[A-Za-z][A-Za-z0-9 ]{0,39}$/;
export const STATUSES = ['queue', 'running', 'success', 'failure', 'waiting'];
const FINGERPRINT_OVER = 200;

function headerEnd(lines) {
  const i = lines.findIndex((l) => /^## /.test(l));
  return i === -1 ? lines.length : i;
}

/** @returns {{ order: string[], values: Record<string,string>, extents: Record<string,{start:number,end:number}>, lines: string[], headerEnd: number }} */
export function parseMarkers(content) {
  const lines = content.split('\n');
  const hEnd = headerEnd(lines);
  const order = [];
  const values = {};
  const extents = {};
  let cur = null;
  for (let i = 0; i < hEnd; i++) {
    const m = lines[i].match(MARKER_RE);
    if (m && !(m[1] in values)) {
      cur = m[1];
      order.push(cur);
      values[cur] = m[2];
      extents[cur] = { start: i, end: i };
    } else if (cur) {
      values[cur] += `\n${lines[i]}`;
      extents[cur].end = i;
    }
  }
  // Trailing blank lines belong to the gap between markers, not to the value.
  for (const name of order) {
    const ext = extents[name];
    while (ext.end > ext.start && lines[ext.end].trim() === '') ext.end--;
    const [first, ...rest] = lines.slice(ext.start, ext.end + 1);
    values[name] = [first.match(MARKER_RE)[2], ...rest].join('\n');
  }
  return { order, values, extents, lines, headerEnd: hEnd };
}

export function getMarker(content, name) {
  const { values } = parseMarkers(content);
  return name in values ? values[name] : null;
}

function checkName(name) {
  if (!NAME_RE.test(name)) throw fail('VALIDATION_FAILED', `Invalid marker name ${JSON.stringify(name)}`, { hint: 'Marker names are letters, digits and spaces, e.g. "Lane Status".' });
}

function checkValue(name, value) {
  if (typeof value !== 'string' || /[\r\n]/.test(value)) {
    throw fail('VALIDATION_FAILED', `Marker ${name} must be a single line`, { hint: 'Put long text in spec.md or conversation.md.' });
  }
}

export function setMarker(content, name, value) {
  checkName(name);
  checkValue(name, value);
  const p = parseMarkers(content);
  const line = `**${name}**: ${value}`;
  if (name in p.values) {
    const { start, end } = p.extents[name];
    const lines = p.lines.slice();
    lines.splice(start, end - start + 1, line);
    return lines.join('\n');
  }
  const lines = p.lines.slice();
  if (p.order.length) {
    const last = p.extents[p.order[p.order.length - 1]];
    lines.splice(last.end + 1, 0, line);
  } else {
    // No markers yet: after the title line (and its blank line), or at the top if there is no title.
    const t = lines.findIndex((l) => /^# /.test(l));
    const at = t === -1 ? 0 : t + 1;
    if (t !== -1 && lines[at] === '') lines.splice(at + 1, 0, line, ...(lines[at + 1] === '' ? [] : ['']));
    else lines.splice(at, 0, ...(t === -1 ? [line] : ['', line, '']));
  }
  return lines.join('\n');
}

export function removeMarker(content, name) {
  const p = parseMarkers(content);
  if (!(name in p.values)) return content;
  const { start, end } = p.extents[name];
  const lines = p.lines.slice();
  lines.splice(start, end - start + 1);
  return lines.join('\n');
}

/** Opaque comparable form of a marker value for `base.markers` (long values are hashed). */
export function markerFingerprint(value) {
  return value.length > FINGERPRINT_OVER ? `sha:${blobSha(value)}` : value;
}

/** REQ-14: returns a list of problems (empty = valid). `lanes` comes from workflow.json plus `backlog`. */
export function validateIndex(content, lanes) {
  const { values } = parseMarkers(content);
  const problems = [];
  const allowed = [...new Set([...lanes, 'backlog'])];
  if (!('Lane' in values)) problems.push('**Lane** marker is missing');
  else if (!allowed.includes(values['Lane'].trim())) problems.push(`**Lane** "${values['Lane']}" is not one of: ${allowed.join(', ')}`);
  if (!('Lane Status' in values)) problems.push('**Lane Status** marker is missing');
  else if (!STATUSES.includes(values['Lane Status'].trim())) problems.push(`**Lane Status** "${values['Lane Status']}" is not one of: ${STATUSES.join(', ')}`);
  return problems;
}

export function trackTitle(indexContent) {
  const m = indexContent.match(/^# Track (?:[A-Za-z]+-)?\d+: (.+)$/m);
  return m ? m[1].trim() : null;
}
