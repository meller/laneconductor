import { z } from 'zod';
import { BETA_PATH, parseBeta, readLog } from '../advice-log.mjs';
import { fail } from '../errors.mjs';
import { computeHealth, renderHealth } from '../health.mjs';
import { generateSummary } from '../summary.mjs';
import { projectField, readEntries, readOnly, workflowLanes } from './common.mjs';

const DAY = 86_400_000;

const input = z.object({
  project: projectField,
  since: z.string().optional().describe('ISO date to report from (default: beta start, else 30 days ago).'),
  format: z.enum(['summary', 'json']).optional().describe('summary (default) adds a report; json is data only.'),
});

export const healthReport = {
  name: 'health_report',
  title: 'Health report',
  description: 'How the advice and the connector are doing over a window: per advice item (served, followed, deviated, override rate, top reasons), connector error, conflict and stale-read rates, and each kill criterion with its verdict. Use it when the human asks whether the connector is earning its place. The decision is theirs.\nExample: "is the connector worth keeping" -> health_report {}',
  annotations: readOnly,
  input,
  async run({ store, ctx, args }) {
    const now = ctx.now();
    const betaFile = (await store.readFiles([BETA_PATH])).get(BETA_PATH);
    const beta = parseBeta(betaFile?.content ?? null);
    const warnings = beta.problems.map((p) => `${BETA_PATH}: ${p}`);
    let sinceMs;
    let source;
    if (args.since !== undefined) {
      sinceMs = Date.parse(args.since);
      if (Number.isNaN(sinceMs)) throw fail('VALIDATION_FAILED', `since is not an ISO date: ${JSON.stringify(args.since)}`);
      source = 'since argument';
    } else if (beta.start !== null) {
      sinceMs = beta.start;
      source = 'beta_start';
    } else {
      sinceMs = now - 30 * DAY;
      source = 'default: last 30 days (no beta_start recorded)';
    }
    const untilMs = beta.end !== null && beta.end > sinceMs ? Math.min(beta.end, now) : now;
    const windowClosed = beta.end !== null && beta.end <= now;
    const log = await readLog(store);
    if (log.malformed) warnings.push(`${log.malformed} malformed advice-log line(s) were skipped.`);
    const health = computeHealth(log.lines, { sinceMs, untilMs, windowClosed, contextTokens: ctx.contextTokens?.() ?? null });
    const lanes = await workflowLanes(store);
    const needs = generateSummary(await readEntries(store), { lanes, generatedAt: '' }).attention;
    if (health.items.length > 50) warnings.push(`Showing 50 of ${health.items.length} advice items.`);
    if (needs.length > 50) warnings.push(`Showing 50 of ${needs.length} tracks needing attention.`);
    health.items = health.items.slice(0, 50);
    const data = {
      window: { since: new Date(sinceMs).toISOString(), until: new Date(untilMs).toISOString(), source, closed: windowClosed },
      ...health,
      needs_attention: needs.slice(0, 50),
    };
    return { data, warnings, summary: args.format === 'json' ? undefined : renderHealth(data) };
  },
};
