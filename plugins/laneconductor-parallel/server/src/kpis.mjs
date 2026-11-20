// KPI focus (track AM-10152). `conductor/kpis.md` lists the project's KPIs in tables with a `Metric` column; an optional `ID` column (KPI-1) names them and an optional
// `Focus` column says which are being worked on: active, future, done or dropped. A track names the KPIs it serves in `**Serves**` (ids or metric names, comma
// separated). A KPI is never ranked above another and none depends on another: a track is `active` when it serves at least one active KPI, `future` when every KPI it
// serves is not active, and `unmapped` when it names none, or none that can be found. Nothing here reads a number from a KPI: the measured value stays in kpis.md.
export const FOCUS = ['active', 'future', 'done', 'dropped'];
const MAX_SERVES = 12;
const clean = (s) => String(s ?? '').replace(/`/g, '').replace(/\s+/g, ' ').trim();
const norm = (s) => clean(s).toLowerCase();

/** The KPIs of a kpis.md text: [{ id: 'KPI-1' | null, metric, focus }]. With no Focus column every KPI is active (an old file behaves as before). */
export function parseKpis(text) {
  const out = [];
  let cols = null;
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (!/^\s*\|/.test(line)) { cols = null; continue; }
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map(clean);
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
    if (!cols) {
      const names = cells.map(norm);
      if (names.includes('metric')) cols = { metric: names.indexOf('metric'), id: names.indexOf('id'), focus: names.indexOf('focus') };
      continue;
    }
    const metric = cells[cols.metric] ?? '';
    if (!metric || /^\(.*\)$/.test(metric)) continue;
    const f = cols.focus >= 0 ? norm(cells[cols.focus]) : '';
    out.push({ id: cols.id >= 0 && cells[cols.id] ? cells[cols.id] : null, metric, focus: FOCUS.includes(f) ? f : 'active' });
  }
  return out;
}

/** The names in a `**Serves**` value, each at most 60 characters, at most 12. */
export const servesList = (value) => String(value ?? '').split('\n')[0].split(/[,;]/).map(clean).filter(Boolean).map((s) => s.slice(0, 60)).slice(0, MAX_SERVES);

const find = (kpis, name) => kpis.find((k) => (k.id && norm(k.id) === norm(name)) || norm(k.metric) === norm(name));

/** 'active' | 'future' | 'unmapped' for the KPIs a track serves, judged against the parsed kpis.md. */
export function kpiFocus(serves, kpis) {
  const found = (serves ?? []).map((n) => find(kpis ?? [], n)).filter(Boolean);
  if (!found.length) return 'unmapped';
  return found.some((k) => k.focus === 'active') ? 'active' : 'future';
}
