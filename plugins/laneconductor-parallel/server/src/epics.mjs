// Epics without stored status (track AM-10145). A track names its epic with the optional marker `**Part Of**: <epic number>`. The epic
// itself holds no child status: every table below is derived from the children's own index.md rows, the way tracks-summary.md is, so a
// child finishing never edits the epic and parallel writers never race on it. Pure functions over the rows of summary.mjs `rowOf`.
import { dependencyState } from './dependencies.mjs';

/** The children of one epic, lowest number first, as compact table rows. Empty when nothing is part of it. */
export function childrenOf(rows, epicNumber, deps = dependencyState(rows)) {
  return rows
    .filter((r) => r.part_of === epicNumber && r.number !== epicNumber)
    .sort((a, b) => a.number - b.number)
    .map((r) => ({
      id: r.id,
      title: r.title,
      lane: r.lane,
      lane_status: r.lane_status,
      progress: r.progress,
      ...(r.waiting_for_reply ? { waiting_for_reply: true } : {}),
      ...(deps.get(r.number)?.blocked_by?.length ? { blocked_by: deps.get(r.number).blocked_by } : {}),
    }));
}

const isShipped = (c) => c.lane === 'done' && c.lane_status === 'success';

/** The derived table of an epic: the children and a one-line count, or null when the track has no children. */
export function epicTable(rows, epicNumber, deps) {
  const children = childrenOf(rows, epicNumber, deps);
  if (!children.length) return null;
  const done = children.filter(isShipped).length;
  return { children, done, total: children.length, line: `${done} of ${children.length} children done:success` };
}

/** Every epic among the rows (a track that others name with Part Of), lowest number first: [{ row, table }]. */
export function epicsOf(rows) {
  const deps = dependencyState(rows);
  const epicNumbers = [...new Set(rows.map((r) => r.part_of).filter((n) => Number.isInteger(n)))].sort((a, b) => a - b);
  const byNumber = new Map();
  for (const r of rows) if (!byNumber.has(r.number)) byNumber.set(r.number, r);
  return epicNumbers.filter((n) => byNumber.has(n)).map((n) => ({ row: byNumber.get(n), table: epicTable(rows, n, deps) })).filter((e) => e.table);
}
