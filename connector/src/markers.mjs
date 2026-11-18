// Marker lines in a track's index.md: `**Name**: value`. Only the HEADER BLOCK counts: everything
// before the first `## ` heading (markers further down are prose, not state). A marker's value may
// continue over following lines (e.g. **Problem**) until the next marker or the first `## `.
//
// Reads are lenient, writes are strict (Track AM-10139): the first line of a name wins when a header is repeated, names match
// case-insensitively, CRLF files read like LF files, and the words in Lane and Lane Status compare lower-cased. Writes put the
// canonical spelling back and keep the file's line ending.
import { blobSha } from './blob.mjs';
import { fail } from './errors.mjs';

const MARKER_RE = /^\*\*([A-Za-z][A-Za-z0-9 ]{0,39})\*\*: ?(.*)$/;
const NAME_RE = /^[A-Za-z][A-Za-z0-9 ]{0,39}$/;
export const STATUSES = ['queue', 'running', 'success', 'failure', 'waiting'];
const FINGERPRINT_OVER = 200;
// Names the tools read by their exact spelling. A hand-edited file may spell one `**lane**` or `**Lane status**`: reads accept that.
const CANONICAL = ['Lane', 'Lane Status', 'Progress', 'Phase', 'Type', 'Track Kind', 'Merge Mode', 'Auto Run', 'Author', 'Problem', 'Summary', 'Run Started', 'Run By', 'Owner Action', 'Owner Action Due', 'Result', 'KPI Check After'];
const CANON_BY_LOWER = new Map(CANONICAL.map((n) => [n.toLowerCase(), n]));
// Values the tools compare as words are compared lower-cased and trimmed on read ("Plan" is the lane plan).
const WORD_VALUED = new Set(['Lane', 'Lane Status']);

const nameKey = (raw) => raw.replace(/ +/g, ' ').trim();

function headerEnd(lines) {
  const i = lines.findIndex((l) => /^## /.test(l));
  return i === -1 ? lines.length : i;
}

/** The file's line ending: CRLF when most of its lines end that way (a stray CR does not convert a file). */
export function detectEol(content) {
  const crlf = (content.match(/\r\n/g) ?? []).length;
  const lf = (content.match(/\n/g) ?? []).length - crlf;
  return crlf > 0 && crlf >= lf ? '\r\n' : '\n';
}

/**
 * Reads the header block. First match wins: a header repeated further down is not folded into the marker above it; it is listed
 * in `damaged` ({ name, line (1-based), start, end }) and its lines are skipped.
 * @returns {{ order: string[], values: Record<string,string>, extents: Record<string,{start:number,end:number}>, lines: string[], headerEnd: number, eol: string, byLower: Record<string,string>, damaged: {name:string,line:number,start:number,end:number}[] }}
 */
export function parseMarkers(content) {
  const eol = detectEol(content);
  const lines = content.split(/\r?\n/);
  const hEnd = headerEnd(lines);
  const order = [];
  const values = {};
  const extents = {};
  const byLower = {};
  const damaged = [];
  let cur = null;
  let dup = null;
  for (let i = 0; i < hEnd; i++) {
    const m = lines[i].match(MARKER_RE);
    if (m) {
      const raw = nameKey(m[1]);
      const lower = raw.toLowerCase();
      if (lower in byLower) {
        dup = { name: byLower[lower], line: i + 1, start: i, end: i };
        damaged.push(dup);
        cur = null;
      } else {
        const name = CANON_BY_LOWER.get(lower) ?? raw;
        cur = name;
        dup = null;
        byLower[lower] = name;
        order.push(name);
        values[name] = m[2];
        extents[name] = { start: i, end: i };
      }
    } else if (cur && (WORD_VALUED.has(cur) || /^# /.test(lines[i]))) {
      // Lane and Lane Status are one line, and a title line ends any value: what follows is not part of the marker.
      cur = null;
      dup = null;
    } else if (cur) {
      values[cur] += `\n${lines[i]}`;
      extents[cur].end = i;
    } else if (dup) {
      dup.end = i;
    }
  }
  // Trailing blank lines belong to the gap between markers, not to the value.
  const trim = (ext) => { while (ext.end > ext.start && lines[ext.end].trim() === '') ext.end--; };
  for (const name of order) {
    const ext = extents[name];
    trim(ext);
    const [first, ...rest] = lines.slice(ext.start, ext.end + 1);
    values[name] = [first.match(MARKER_RE)[2], ...rest].join('\n');
    if (WORD_VALUED.has(name)) values[name] = values[name].trim().toLowerCase();
  }
  for (const d of damaged) trim(d);
  return { order, values, extents, lines, headerEnd: hEnd, eol, byLower, damaged };
}

export function getMarker(content, name) {
  const { values, byLower } = parseMarkers(content);
  const key = byLower[name.toLowerCase()];
  return key !== undefined ? values[key] : null;
}

/** Repeated header lines of an index.md, as `[{ name, line }]` (empty when the header is intact). */
export function damagedHeaders(content) {
  return parseMarkers(content).damaged.map(({ name, line }) => ({ name, line }));
}

/**
 * The `header_damaged` warning text for an index.md, or null when no marker is repeated. At most 200 characters (the envelope's
 * warning bound) with its final period: it names up to 4 repeats and drops names from the end until it fits.
 */
export function headerDamagedWarning(content) {
  const d = damagedHeaders(content);
  if (!d.length) return null;
  const tail = '; the first wins. Ask the human, then update_track repair_index true.';
  let text = '';
  for (let shown = Math.min(d.length, 4); shown >= 1; shown--) {
    const more = d.length > shown ? ` (+${d.length - shown})` : '';
    text = `header_damaged: repeats ${d.slice(0, shown).map((x) => `${x.name} (l.${x.line})`).join(', ')}${more}${tail}`;
    if (text.length <= 200) break;
  }
  return text;
}

/** One write that fixes the header: keeps the first of each marker (canonical spelling) and moves the repeated lines below a heading. */
export function repairIndex(content) {
  const p = parseMarkers(content);
  const spell = new Map(); // line index -> canonical line
  for (const name of p.order) {
    const { start } = p.extents[name];
    const m = p.lines[start].match(MARKER_RE);
    if (m && nameKey(m[1]) !== name && CANON_BY_LOWER.has(name.toLowerCase())) spell.set(start, `**${name}**: ${m[2]}`);
  }
  if (!p.damaged.length && !spell.size) return content;
  const drop = new Set();
  const moved = [];
  for (const d of p.damaged) {
    for (let i = d.start; i <= d.end; i++) { drop.add(i); moved.push(p.lines[i]); }
  }
  const kept = [];
  p.lines.forEach((l, i) => { if (!drop.has(i)) kept.push(spell.get(i) ?? l); });
  if (moved.length) {
    const block = ['## Repeated header lines (moved by repair_index)', '', ...moved, ''];
    let at = headerEnd(kept);
    if (at === kept.length) {
      while (at > 0 && kept[at - 1].trim() === '') at--;
      kept.splice(at, kept.length - at, '', ...block);
    } else {
      if (at > 0 && kept[at - 1].trim() !== '') kept.splice(at++, 0, '');
      kept.splice(at, 0, ...block);
    }
  }
  return kept.join(p.eol);
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
  const key = p.byLower[name.toLowerCase()];
  const line = `**${CANON_BY_LOWER.get(name.toLowerCase()) ?? name}**: ${value}`;
  if (key !== undefined) {
    const { start, end } = p.extents[key];
    const lines = p.lines.slice();
    lines.splice(start, end - start + 1, line);
    return lines.join(p.eol);
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
  return lines.join(p.eol);
}

export function removeMarker(content, name) {
  const p = parseMarkers(content);
  const key = p.byLower[name.toLowerCase()];
  if (key === undefined) return content;
  const { start, end } = p.extents[key];
  const lines = p.lines.slice();
  lines.splice(start, end - start + 1);
  return lines.join(p.eol);
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
  else if (!allowed.some((l) => l.toLowerCase() === values['Lane'])) problems.push(`**Lane** "${values['Lane']}" is not one of: ${allowed.join(', ')}`);
  if (!('Lane Status' in values)) problems.push('**Lane Status** marker is missing');
  else if (!STATUSES.includes(values['Lane Status'])) problems.push(`**Lane Status** "${values['Lane Status']}" is not one of: ${STATUSES.join(', ')}`);
  return problems;
}

export function trackTitle(indexContent) {
  const m = indexContent.match(/^# Track (?:[A-Za-z]+-)?\d+: (.+)$/m);
  return m ? m[1].trim() : null;
}
