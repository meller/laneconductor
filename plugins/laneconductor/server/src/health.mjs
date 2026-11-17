// Health report (REQ-20): per-advice-item and connector metrics from the advice log, plus the kill
// criteria verdicts. Pure: takes parsed log lines.
import { COUNTED_CODES } from './errors.mjs';
import { READ_TOOLS, THRESHOLDS, evaluateKillCriteria } from './kill-criteria.mjs';

const ORPHAN_ITEM = '(orphan)';

function percentile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

const rate = (num, den) => (den ? Math.round((num / den) * 1000) / 1000 : null);

export function computeHealth(allLines, { sinceMs, untilMs, windowClosed = false, contextTokens = null }) {
  const inWindow = (l) => {
    const t = Date.parse(l.ts);
    return t >= sinceMs && t <= untilMs;
  };
  const lines = allLines.filter(inWindow);
  const of = (kind) => lines.filter((l) => l.kind === kind);
  const itemOfServe = new Map(allLines.filter((l) => l.kind === 'serve').map((l) => [l.id, l.item]));
  const reported = new Set(allLines.filter((l) => l.kind === 'outcome').map((l) => l.serve_id));

  // per advice item
  const items = new Map();
  const item = (name) => {
    if (!items.has(name)) items.set(name, { item: name, served: 0, followed: 0, deviated: 0, failed: 0, unreported: 0, reasons: new Map() });
    return items.get(name);
  };
  for (const s of of('serve')) {
    const it = item(s.item);
    it.served++;
    if (!reported.has(s.id)) it.unreported++;
  }
  for (const o of of('outcome')) {
    const it = item(itemOfServe.get(o.serve_id) ?? ORPHAN_ITEM);
    it[o.outcome] = (it[o.outcome] ?? 0) + 1;
    if (o.outcome === 'deviated' && o.reason) {
      const key = o.reason.trim().toLowerCase();
      it.reasons.set(key, (it.reasons.get(key) ?? 0) + 1);
    }
  }
  const itemRows = [...items.values()].map((it) => {
    const decided = it.followed + it.deviated;
    return {
      item: it.item, served: it.served, followed: it.followed, deviated: it.deviated, failed: it.failed, unreported: it.unreported,
      override_rate: rate(it.deviated, decided),
      top_deviation_reasons: [...it.reasons].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([reason, count]) => ({ reason, count })),
      flagged: decided >= THRESHOLDS.itemOverrideMinOutcomes && it.deviated / decided > THRESHOLDS.overrideRate,
    };
  }).sort((a, b) => b.served - a.served || a.item.localeCompare(b.item));

  // connector
  const calls = of('call');
  const counted = of('tool_error').filter((l) => COUNTED_CODES.includes(l.code));
  const perSession = new Map();
  for (const e of counted) perSession.set(e.session, (perSession.get(e.session) ?? 0) + 1);
  const latencies = calls.map((c) => c.latency_ms).filter(Number.isFinite).sort((a, b) => a - b);
  const reads = calls.filter((c) => READ_TOOLS.includes(c.tool));
  const remoteReads = reads.filter((c) => c.backend === 'github');
  const remoteStale = of('stale_read').filter((l) => l.backend === 'github' && READ_TOOLS.includes(l.tool));
  const remoteSessions = new Set(calls.filter((c) => c.backend === 'github').map((c) => c.session));
  const serves = of('serve');
  const outcomes = of('outcome');
  const connector = {
    calls: calls.length,
    tool_errors: of('tool_error').length,
    counted_errors: counted.length,
    error_rate: rate(counted.length, calls.length),
    conflicts: of('conflict').length,
    stale_reads: of('stale_read').length,
    stale_read_rate: rate(of('stale_read').length, reads.length),
    empty_results: of('empty_result').length,
    empty_result_rate: rate(of('empty_result').length, calls.filter((c) => c.tool === 'list_tracks').length),
    latency_ms: { p50: percentile(latencies, 50), p95: percentile(latencies, 95) },
    sessions: new Set(calls.map((c) => c.session)).size,
    tokens_added_estimate: { per_session_static: contextTokens, responses_total: Math.ceil(calls.reduce((n, c) => n + (c.chars ?? 0), 0) / 4) },
    serves: serves.length,
    outcomes: outcomes.length,
    log_lines: lines.length,
  };
  const flaggedItems = itemRows.filter((i) => i.flagged).map((i) => i.item);
  const kill = evaluateKillCriteria({
    calls: calls.length,
    countedErrors: counted.length,
    worstSession: Math.max(0, ...perSession.values()),
    serves: serves.length,
    servesReported: serves.filter((s) => reported.has(s.id)).length,
    followed: itemRows.reduce((n, i) => n + i.followed, 0),
    deviated: itemRows.reduce((n, i) => n + i.deviated, 0),
    flaggedItems,
    remoteReads: remoteReads.length,
    remoteStaleReads: remoteStale.length,
    remoteSessions: remoteSessions.size,
    windowClosed,
    contextTokens,
  });
  return { items: itemRows, connector, kill_criteria: kill };
}

const fmt = (v, unit = '') => (v === null || v === undefined ? '-' : `${v}${unit}`);

export function renderHealth({ window, items, connector, kill_criteria, needs_attention }) {
  const out = [`Window: ${window.since} to ${window.until} (${window.source}${window.closed ? ', closed' : ''}).`, '', 'Kill criteria:'];
  for (const k of kill_criteria) out.push(`- ${k.id} ${k.verdict.toUpperCase()}: ${k.metric}; threshold ${k.threshold}; value ${fmt(k.value)} (n=${k.n})${k.note ? `; ${k.note}` : ''}`);
  out.push('', `Connector: ${connector.calls} calls in ${connector.sessions} session(s); counted errors ${connector.counted_errors} (rate ${fmt(connector.error_rate)}); conflicts ${connector.conflicts}; stale reads ${connector.stale_reads}; empty results ${connector.empty_results}; latency p50 ${fmt(connector.latency_ms.p50, ' ms')}, p95 ${fmt(connector.latency_ms.p95, ' ms')}; about ${fmt(connector.tokens_added_estimate.per_session_static)} tokens of instructions and tool list per session.`);
  out.push('', 'Advice items:');
  if (!items.length) out.push('- none served in this window');
  for (const i of items.slice(0, 25)) {
    out.push(`- ${i.item}${i.flagged ? ' [FLAGGED: overridden most of the time; rewrite or delete]' : ''}: served ${i.served}, followed ${i.followed}, deviated ${i.deviated}, failed ${i.failed}, unreported ${i.unreported}, override rate ${fmt(i.override_rate)}${i.top_deviation_reasons.length ? `; reasons: ${i.top_deviation_reasons.map((r) => `"${r.reason.slice(0, 80)}" x${r.count}`).join('; ')}` : ''}`);
  }
  if (needs_attention.length) {
    out.push('', 'Tracks needing attention:');
    for (const a of needs_attention.slice(0, 15)) out.push(`- ${a.folder}: ${a.problems.join('; ')}`);
  }
  return out.join('\n');
}
