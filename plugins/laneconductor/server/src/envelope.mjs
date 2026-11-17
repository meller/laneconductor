// Common response envelope (spec "Common response envelope"): every tool result, errors included,
// carries `provenance`, and the first line of its text is the provenance line (REQ-10). The text
// also holds the full JSON (F5 back-compat) and stays under 40,000 characters (REQ-18).
import { ConnectorError } from './errors.mjs';
import { buildProvenance, withReasons } from './provenance.mjs';
import { pushWarnings } from './push-policy.mjs';

export const MAX_TEXT_CHARS = 40_000;
/** Room tools should leave for the provenance block, error fields and warnings when sizing `data`. */
export const ENVELOPE_RESERVE = 6_000;
const MAX_WARNINGS = 10;
const MAX_WARNING_CHARS = 200;

/** Warnings appear in the text and in the JSON, so they are bounded to keep the budget predictable. */
export function boundWarnings(ws) {
  const cut = ws.slice(0, MAX_WARNINGS).map((w) => (w.length > MAX_WARNING_CHARS ? `${w.slice(0, MAX_WARNING_CHARS - 1)}…` : w));
  if (ws.length > MAX_WARNINGS) cut.push(`…and ${ws.length - MAX_WARNINGS} more warnings.`);
  return cut;
}

function renderText(envelope, summary) {
  const parts = [envelope.provenance.line];
  if (envelope.error) parts.push(`ERROR ${envelope.error.code}: ${envelope.error.message}${envelope.error.hint ? `\nHint: ${envelope.error.hint}` : ''}`);
  else if (summary) parts.push(summary);
  if (envelope.warnings.length) parts.push(`Warnings:\n${envelope.warnings.map((w) => `- ${w}`).join('\n')}`);
  parts.push(JSON.stringify(envelope));
  return parts.join('\n\n');
}

export function toResult(envelope, summary) {
  let text = renderText(envelope, summary);
  if (text.length > MAX_TEXT_CHARS) {
    // Last line of defence; tools size their own data and should never get here.
    const dropped = { ...envelope, data: { truncated: true, original_chars: text.length }, warnings: [...envelope.warnings, `Response exceeded ${MAX_TEXT_CHARS} characters and its data was dropped. Ask for less (fewer files, a smaller limit).`] };
    envelope = dropped;
    text = renderText(dropped, summary);
  }
  return { content: [{ type: 'text', text }], structuredContent: envelope, ...(envelope.ok ? {} : { isError: true }) };
}

const UNAVAILABLE = (err) => ({
  backend: 'unknown', repo: null, branch: null, commit: null, commit_time: null, read_at: new Date().toISOString(),
  dirty_paths: [], upstream: null, cache: { served_from_cache: false, age_s: 0 }, freshness: 'possibly_stale',
  stale_reasons: ['provenance_unavailable'], line: `LaneConductor state: provenance unavailable (${err.message}).`,
});

/** Runs one tool definition against a store and wraps the outcome. Never throws. */
export async function runTool(def, ctx, args) {
  const started = Date.now();
  const recorded = [];
  const callCtx = { ...ctx, record: (e) => recorded.push(e) };
  let store = null;
  let repoOk = true;
  let outcome;
  try {
    store = ctx.resolveStore(args?.project);
    if (def.repoOptional) await ctx.assertConductorRepo(store).catch(() => { repoOk = false; });
    else await ctx.assertConductorRepo(store);
    const r = await def.run({ store, ctx: callCtx, args });
    outcome = { ok: true, data: r.data ?? {}, error: null, warnings: r.warnings ?? [], summary: r.summary, staleReasons: r.staleReasons ?? [], empty: Boolean(r.empty) };
  } catch (err) {
    const ce = err instanceof ConnectorError ? err : null;
    if (!ce) process.stderr.write(`[lc-connector] unexpected error in ${def.name}: ${err?.stack ?? err}\n`);
    outcome = {
      ok: false, data: {}, summary: null, warnings: [], staleReasons: [], empty: false,
      error: ce ? ce.toJSON() : { code: 'INTERNAL_ERROR', message: String(err?.message ?? err), details: null, hint: 'This is a bug in the connector, not in your request.' },
    };
  }
  let provenance;
  try {
    provenance = store ? await buildProvenance(store, { now: ctx.now() }) : UNAVAILABLE(new Error('no repository'));
  } catch (err) {
    provenance = UNAVAILABLE(err);
  }
  if (outcome.staleReasons.length) provenance = withReasons(provenance, outcome.staleReasons, ctx.now());
  const ps = store?.pushStatus?.();
  const hints = ps ? pushWarnings({ policy: ps.policy, ahead: provenance.upstream?.ahead ?? 0, last: ps.last }) : [];
  const envelope = { ok: outcome.ok, data: outcome.data, error: outcome.error, warnings: boundWarnings([...outcome.warnings, ...hints]), provenance };
  // The provenance line already carries `Freshness: ...` when the state is not fresh (REQ-10/11).
  const result = toResult(envelope, outcome.summary);
  if (store && repoOk) {
    await ctx.log?.(store, {
      tool: def.name, readOnly: Boolean(def.annotations?.readOnlyHint), ok: outcome.ok, code: outcome.error?.code ?? null,
      latencyMs: Date.now() - started, chars: result.content[0].text.length, freshness: provenance.freshness, staleReasons: provenance.stale_reasons,
      empty: outcome.empty, recorded: outcome.ok ? recorded : [], commit: provenance.commit,
    });
  }
  return result;
}
