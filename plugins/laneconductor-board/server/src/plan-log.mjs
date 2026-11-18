// Track AM-10146: plan.md is the task tracker (phases and checkbox tasks). Dated status, releases and incidents belong in history.md. The lint
// `plan_has_log` finds a plan that has become a log: two or more headings that are dated or start with STATUS, RELEASE, INCIDENT, UPDATE or
// LOG, or a plan over 60 KB. It never counts checkboxes: a plan with many tasks is a plan, not a log. Pure: text in, findings out.

export const PLAN_LOG_BYTES = 60 * 1024;
export const PLAN_LOG_HEADINGS = 2;

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
const DATED = new RegExp(`^(?:\\d{4}[-/.]\\d{2}[-/.]\\d{2}|\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}\\b|${MONTH}\\s+(?:\\d{1,2}(?:st|nd|rd|th)?|\\d{4})\\b)`, 'i');
const LOGWORD = /^(?:status|release|incident|update|log)s?\b/i;

/** The heading texts of a Markdown file, outside fenced code blocks. */
function headingsOf(content) {
  const out = [];
  let fence = null;
  for (const line of content.split('\n')) {
    const f = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (f) {
      if (fence === null) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const h = line.match(/^#{1,6}\s+(.*?)\s*#*\s*$/);
    if (h) out.push(h[1]);
  }
  return out;
}

/** Leading emoji, brackets and punctuation are not part of what a heading says. */
const bare = (h) => h.replace(/^[^\p{L}\p{N}]+/u, '');

/** `{ headings, bytes, oversized, flagged }`: `headings` counts the dated and STATUS/RELEASE/INCIDENT/UPDATE/LOG ones; `flagged` is the verdict. */
export function planLogFindings(content) {
  const text = typeof content === 'string' ? content : '';
  const headings = headingsOf(text).map(bare).filter((h) => DATED.test(h) || LOGWORD.test(h)).length;
  const bytes = Buffer.byteLength(text);
  const oversized = bytes > PLAN_LOG_BYTES;
  return { headings, bytes, oversized, flagged: headings >= PLAN_LOG_HEADINGS || oversized };
}

/** The get_track warning for a flagged plan: names the file and the count, at most 200 characters. */
export function planLogWarning(f) {
  const kb = Math.round(f.bytes / 1024);
  const what = f.headings >= PLAN_LOG_HEADINGS
    ? `plan.md has ${f.headings} dated or STATUS/RELEASE/INCIDENT headings${f.oversized ? ` and is ${kb} KB` : ''}`
    : `plan.md is ${kb} KB (over ${PLAN_LOG_BYTES / 1024} KB)`;
  return `plan_has_log: ${what}. Ask, then move the dated sections to history.md (see "Splitting a plan that holds a log" in ops/tracks.md).`.slice(0, 200);
}

/** The summary lint problem: no count and no size, so the generated file changes only when a plan starts or stops being a log. */
export const PLAN_LOG_PROBLEM = 'plan_has_log: plan.md holds a log (dated or STATUS/RELEASE/INCIDENT/UPDATE/LOG headings, or over 60 KB)';
