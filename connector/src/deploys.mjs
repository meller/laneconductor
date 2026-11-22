// Track AM-10156: deployment in the plugin. The pure logic behind the base `deploy` text (records, status, history, rollback, release notes)
// and behind the board's Deployment tab. The base plugin has no script, so its text describes this same algorithm in words; this module is
// the executable proof of it and the board add-on's reader. Nothing here touches git, the network or the clock: a session (or the board) reads
// the records and passes in what it learned (the local build version, the live version, the commit count, `now`).
import { scanText } from './scan.mjs';

/** The header lines every record carries (REQ-1), in the order the base text writes them. `kind`, `production` and `restored record` are optional. */
export const REQUIRED_KEYS = ['environment', 'time', 'commit', 'build version', 'command', 'result', 'log', 'approved by', 'previous good record'];
const FIELD_OF = {
  environment: 'env', time: 'time', commit: 'commit', 'build version': 'version', command: 'command', result: 'result', log: 'log',
  'approved by': 'approvedBy', 'previous good record': 'previous', kind: 'kind', production: 'production', 'restored record': 'restored',
};
const DAY = 86400000;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** `prod-20261122T101500Z.md` for an environment and an ISO time. */
export function recordFileName(env, time) {
  return `${env}-${new Date(time).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}.md`;
}
const timeFromName = (file) => {
  const m = /-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.md$/.exec(String(file));
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : null;
};
const envFromName = (file) => { const m = /^(.+)-\d{8}T\d{6}Z\.md$/.exec(String(file).replace(/^.*\//, '')); return m ? m[1] : null; };

// ---- secrets: the scan every document gets, plus the shapes a deploy command can carry ---------------------------------------------------------
const EXTRA_SECRET_RULES = [
  { name: 'secret assigned in a command', re: /\b[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|KEY)=(?![$<{])\S{6,}/ },
  { name: 'secret flag in a command', re: /--(?:token|password|passwd|secret|api-key|access-key)[= ]\s*(?![$<{])\S{8,}/i },
  { name: 'payment key', re: /\bsk_(?:live|test)_[A-Za-z0-9]{10,}/ },
  { name: 'cloud login token', re: /\b(?:ya29\.|1\/\/0)[A-Za-z0-9._-]{20,}/ },
];
/** Where a text looks like it holds a secret or personal data: the board's scan plus the shapes above. Never the matched text. */
export function secretHits(text) {
  const out = [...scanText(text)];
  String(text ?? '').split(/\r\n|\r|\n/).forEach((line, i) => { for (const r of EXTRA_SECRET_RULES) if (r.re.test(line)) out.push({ line: i + 1, pattern: r.name }); });
  return out;
}

// ---- records -----------------------------------------------------------------------------------------------------------------------------------
/**
 * One record: `key: value` header lines (any order, any other text ignored). `good` is a run that succeeded. A rollback record carries the
 * version it restored, so the live version after a rollback is that version.
 */
export function parseRecord(text, file = '') {
  const r = { file: String(file).replace(/^.*\//, '') };
  for (const line of String(text ?? '').split(/\r\n|\r|\n/)) {
    const m = /^([a-z][a-z ]*?):\s*(.*?)\s*$/.exec(line);
    if (m && Object.hasOwn(FIELD_OF, m[1])) r[FIELD_OF[m[1]]] ??= m[2];
  }
  r.env ||= envFromName(file);
  r.time ||= timeFromName(file);
  r.result = (r.result ?? '').toLowerCase();
  r.kind = r.kind === 'rollback' ? 'rollback' : 'deploy';
  r.production = /^(yes|true)$/i.test(r.production ?? '');
  r.good = r.result === 'success';
  return r;
}

/** What is wrong with a record text before it is written (an empty list means fine). */
export function lintRecord(text) {
  const problems = [];
  const header = new Set();
  for (const line of String(text ?? '').split(/\r\n|\r|\n/)) { const m = /^([a-z][a-z ]*?):\s*(\S.*)$/.exec(line); if (m) header.add(m[1]); }
  for (const k of REQUIRED_KEYS) if (!header.has(k)) problems.push(`missing ${k}`);
  const r = parseRecord(text);
  if (header.has('result') && !['success', 'failed'].includes(r.result)) problems.push('result must be success or failed');
  if (header.has('time') && Number.isNaN(Date.parse(r.time))) problems.push('time is not a UTC timestamp');
  if (header.has('kind') && !['deploy', 'rollback'].includes(r.kind)) problems.push('kind must be deploy or rollback');
  const hits = secretHits(text);
  if (hits.length) problems.push(`possible secret or personal data on line ${[...new Set(hits.map((h) => h.line))].join(', ')} (${[...new Set(hits.map((h) => h.pattern))].join(', ')})`);
  return { ok: problems.length === 0, problems };
}

/** The parsed records of `[{ name, text }]`, oldest first; a file with no environment or time is skipped. */
export function parseRecords(files) {
  return (files ?? []).map((f) => parseRecord(f.text, f.name)).filter((r) => r.env && r.time && !Number.isNaN(Date.parse(r.time)))
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time) || a.file.localeCompare(b.file));
}
const forEnv = (records, env) => (records ?? []).filter((r) => r.env === env);

/** The record that is live: the newest good one (a good rollback counts), or null. */
export function liveRecord(records, env) {
  const good = forEnv(records, env).filter((r) => r.good);
  return good.length ? good[good.length - 1] : null;
}

const entryOf = (r, live) => ({ file: r.file, time: r.time, version: r.version, commit: r.commit, result: r.result, approvedBy: r.approvedBy, kind: r.kind, live, production: r.production });
/** The versions of one environment, newest first, every run (failed ones too), the live one marked. A rollback is an entry like a deploy. */
export function historyOf(records, env) {
  const live = liveRecord(records, env);
  return forEnv(records, env).slice().reverse().map((r) => entryOf(r, r === live));
}

// ---- deploy.json ---------------------------------------------------------------------------------------------------------------------------------
/**
 * One environment of deploy.json with the optional keys (D3, D10): `rollback` (a command, `{service}`, `{version}` and `{commit}` are filled),
 * `service`, `version` (a command that prints the local build version), `liveVersionUrl` (read-only GET) and `liveVersionField` (the field of
 * its answer that holds the version, default `version`). No environment given means `defaultEnvironment`, else `prod`. Null when not found.
 */
export function envConfig(config, env) {
  let c = config;
  if (typeof c === 'string') { try { c = JSON.parse(c); } catch { return null; } }
  if (!c || typeof c !== 'object' || !c.environments || typeof c.environments !== 'object') return null;
  const name = env || (typeof c.defaultEnvironment === 'string' && c.defaultEnvironment) || 'prod';
  const e = c.environments[name];
  if (!e || typeof e !== 'object' || typeof e.command !== 'string' || !e.command.trim()) return null;
  const s = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    env: name, command: e.command.trim(), rollback: s(e.rollback), service: s(e.service), version: s(e.version),
    liveVersionUrl: s(e.liveVersionUrl), liveVersionField: s(e.liveVersionField) ?? 'version', production: name === 'prod' || name === 'production',
  };
}

// ---- status --------------------------------------------------------------------------------------------------------------------------------------
const ageText = (days) => (days < 1 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`);
/**
 * `deploy status`: the local build version, the last recorded deploy and the live version side by side.
 * @param {{ env: string, records: object[], local: { version: string, commit?: string }, live?: { version?: string, error?: string } | null, ahead?: number | null, now: string }} a
 *   `live` is null when the environment has no `liveVersionUrl` (not checked), `{ version }` when it was read, `{ error }` when the read failed;
 *   `ahead` is the number of commits the local copy has beyond the last deploy's commit (null when it could not be counted).
 */
export function compareStatus({ env, records, local, live = null, ahead = null, now }) {
  const last = liveRecord(records, env);
  const newest = forEnv(records, env).at(-1) ?? null;
  const liveSeen = live && typeof live.version === 'string' && live.version ? live.version : null;
  const out = { env, state: 'no-record', local, last: null, live: { checked: Boolean(liveSeen), version: liveSeen }, ahead, lines: [] };
  const lv = local?.version ? `${local.version}${local.commit ? ` (${local.commit})` : ''}` : 'unknown';
  out.lines.push(`${env}: local build version ${lv}`);
  if (!last) {
    out.lines.push(`No deploy recorded for ${env}.${newest ? ` The only run recorded failed (${newest.file}).` : ''}`);
    out.lines.push(liveSeen ? `live version ${liveSeen} (nothing recorded to compare it with)` : 'The live version is not checked.');
    return out;
  }
  const ageDays = Math.max(0, Math.floor((Date.parse(now) - Date.parse(last.time)) / DAY));
  out.last = { file: last.file, time: last.time, version: last.version, commit: last.commit, result: last.result, ageDays, kind: last.kind };
  out.lines.push(`last good ${last.kind}: ${last.version} (${last.commit}) at ${last.time}, ${ageText(ageDays)}, by ${last.approvedBy}`);
  if (newest && newest !== last && !newest.good) out.lines.push(`The newest run (${newest.version}) failed at ${newest.time} (${newest.file}); it is not live.`);
  if (liveSeen) out.lines.push(`live version: ${liveSeen}`);
  else out.lines.push(`The live version is not checked${live?.error ? `: ${live.error}` : ' (no liveVersionUrl for this environment)'}.`);
  const versionDiffers = Boolean(local?.version) && local.version !== last.version;
  if (liveSeen && liveSeen !== last.version) {
    out.state = 'drift';
    out.lines.push(`Drift: the live version ${liveSeen} differs from the recorded ${last.version}. Someone deployed outside the records; nothing was changed.`);
  } else if ((typeof ahead === 'number' && ahead > 0) || versionDiffers) {
    out.state = 'ahead';
    if (typeof ahead === 'number' && ahead > 0) out.lines.push(`The local copy is ahead of the last deploy by ${plural(ahead, 'commit')}.`);
    if (versionDiffers) out.lines.push(`The local build version ${local.version} differs from the recorded ${last.version}.`);
  } else {
    out.state = 'in-sync';
    out.lines.push(liveSeen ? 'In sync: the local copy, the last record and the live version agree.'
      : `The local copy matches the last record${ahead === 0 ? ' and has no commits since it' : ''}; the live version is not checked, so this says nothing about the live server.`);
  }
  return out;
}

// ---- rollback --------------------------------------------------------------------------------------------------------------------------------------
const fill = (cmd, vars) => cmd.replace(/\{(service|version|commit)\}/g, (_, k) => vars[k] ?? `{${k}}`);
/**
 * `deploy rollback [env] [version]`. A version is matched against the good records of the environment (the version, a commit of at least 7
 * characters or a record file name; the newest match wins); a failed run is never a version to go back to. Without a version: the list.
 * @returns {{ action: 'list' | 'refused' | 'plan', ... }}
 */
export function rollbackPlan({ records, config, env, version }) {
  const cfg = config && config.env === env ? config : null;
  const refuse = (reason, extra = {}) => ({ action: 'refused', reason, ...extra });
  if (!cfg) return refuse(`deploy.json has no environment ${env} with a command`);
  const hist = historyOf(records, env).filter((e) => e.result === 'success');
  if (!hist.length) return refuse(`nothing is recorded as deployed to ${env}, so there is no version to go back to`);
  if (!version) return { action: 'list', versions: hist, question: `Which version should ${env} go back to? Name one from the list.` };
  const all = forEnv(records, env).filter((r) => r.good).reverse();
  const v = String(version);
  const target = all.find((r) => r.version === v) ?? all.find((r) => v.length >= 7 && r.commit && r.commit.startsWith(v)) ?? all.find((r) => r.file === v);
  if (!target) return refuse(`no good record of version ${v} for ${env}; the versions recorded are ${hist.map((h) => h.version).join(', ')}`, { versions: hist });
  const live = liveRecord(records, env);
  const vars = { service: cfg.service, version: target.version, commit: target.commit };
  let strategy;
  let steps;
  if (cfg.rollback) {
    if (/\{service\}/.test(cfg.rollback) && !cfg.service) return refuse('the rollback command needs {service} but deploy.json sets no service for this environment');
    strategy = 'command';
    steps = [fill(cfg.rollback, vars)];
  } else {
    const dir = `/tmp/deploy-${env}-${String(target.commit).slice(0, 7)}`;
    strategy = 'redeploy';
    steps = [`git worktree add --detach ${dir} ${target.commit}`, `cd ${dir} && ${cfg.command}`, `git worktree remove --force ${dir}`];
  }
  if (secretHits(steps.join('\n')).length) return refuse('the command looks like it holds a secret; keep secrets out of deploy.json and say where they come from instead');
  const command = steps.join(' && ');
  return {
    action: 'plan', strategy, target, alreadyLive: live === target, production: cfg.production, steps, command,
    yes: `yes, roll back ${env} to ${target.version} with ${command}`,
  };
}

// ---- release notes ---------------------------------------------------------------------------------------------------------------------------------
/** When a track finished: its last dated history line (`YYYY-MM-DD` counts to the end of that day, `YYYY-MM-DD HH:MMZ` to the minute); null when none. */
export function finishedAt(historyText) {
  let at = null;
  for (const line of String(historyText ?? '').split(/\r\n|\r|\n/)) {
    const m = /^\s*[-*]\s*(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2})Z?)?/.exec(line);
    if (!m) continue;
    const t = Date.parse(m[2] ? `${m[1]}T${m[2]}:00Z` : `${m[1]}T23:59:59Z`);
    if (!Number.isNaN(t)) at = t;
  }
  return at;
}
/**
 * "Shipped since the last deploy": the tracks in lane `done` whose finish time is after `since` (the previous good record's time; null means
 * every dated one), oldest first, as plain Markdown. A done track with no dated history line is named apart, never guessed.
 * @param {{ tracks: { number: number, id?: string, title: string, lane: string, history: string }[], since: string | null }} a
 */
export function shippedSince({ tracks, since }) {
  const from = since ? Date.parse(since) : -Infinity;
  const done = (tracks ?? []).filter((t) => t.lane === 'done').map((t) => ({ number: t.number, id: t.id ?? `AM-${t.number}`, title: t.title, at: finishedAt(t.history) }));
  const listed = done.filter((t) => t.at !== null && t.at > from).sort((a, b) => a.at - b.at || a.number - b.number)
    .map((t) => ({ ...t, date: new Date(t.at).toISOString().slice(0, 10) }));
  const undated = done.filter((t) => t.at === null);
  const lines = ['## Shipped since the last deploy', ''];
  lines.push(...(listed.length ? listed.map((t) => `- ${t.id}: ${t.title} (${t.date})`) : ['Nothing finished since the last deploy.']));
  if (undated.length) lines.push('', `Finished tracks not placed in time (no dated history line): ${undated.map((t) => t.id).join(', ')}.`);
  return { tracks: listed, undated, markdown: `${lines.join('\n')}\n` };
}

// ---- the board -------------------------------------------------------------------------------------------------------------------------------------
const ENV_SAFE = /^[a-z0-9][a-z0-9-]{0,30}$/;
const cell = (v) => String(v ?? '').replace(/[|\r\n]+/g, ' ').trim();
/**
 * What the Deployment tab shows, from the record files (`[{ name, text }]`, already read): Markdown with, per environment, the live (newest
 * good) entry and the history, newest first, plus the environment names (for the Copy buttons). Null when there are no records, so a project
 * with none is unchanged. Each record is scanned on its own: one that looks like it holds a secret is withheld with the standard placeholder
 * and contributes nothing but its file name and time (`withheld` names it for the build's log). An environment whose name is not lower-case
 * letters, digits and dashes is left out, because its name goes into a copied prompt.
 * @returns {{ md: string, envs: string[], withheld: { file: string, matches: number, lines: number[] }[] } | null}
 */
export function deploysForBoard(files) {
  const named = (files ?? []).filter((f) => f && typeof f.name === 'string' && typeof f.text === 'string' && /^[^/\\]+-\d{8}T\d{6}Z\.md$/.test(f.name));
  if (!named.length) return null;
  const clean = [];
  const held = [];
  for (const f of named) {
    const hits = secretHits(f.text);
    if (hits.length) held.push({ file: f.name, env: envFromName(f.name), time: timeFromName(f.name), matches: hits.length, lines: [...new Set(hits.map((h) => h.line))].slice(0, 10) });
    else clean.push(f);
  }
  const records = parseRecords(clean);
  const envs = [...new Set([...records.map((r) => r.env), ...held.map((w) => w.env)])].filter((e) => e && ENV_SAFE.test(e)).sort();
  if (!envs.length) return null;
  const out = ['# Deploys', '', 'What the deploy records in `conductor/deploys/` say, read when this board was built. The live server is not asked here: ask Claude for `deploy status`.'];
  for (const env of envs) {
    const live = liveRecord(records, env);
    const production = records.some((r) => r.env === env && r.production);
    out.push('', `## ${env}${production ? ' (production)' : ''}`, '');
    out.push(live
      ? `Live: version ${cell(live.version)}, deployed ${cell(live.time)}, ${live.kind === 'rollback' ? 'success (rollback)' : 'success'}, commit ${cell(live.commit)}, approved by ${cell(live.approvedBy)}.`
      : 'Live: nothing is recorded as live (no successful deploy).');
    const rows = [
      ...historyOf(records, env).map((e) => ({ time: e.time, file: e.file, cols: [cell(e.version), cell(e.commit), `${cell(e.result)}${e.kind === 'rollback' ? ' (rollback)' : ''}`, cell(e.approvedBy), e.live ? 'live' : ''] })),
      ...held.filter((w) => w.env === env).map((w) => ({ time: w.time, file: w.file, cols: [`withheld: possible secret or personal data (${w.matches} match${w.matches === 1 ? '' : 'es'})`, '', '', '', ''] })),
    ].sort((a, b) => Date.parse(b.time) - Date.parse(a.time) || b.file.localeCompare(a.file));
    out.push('', '| Time | Version | Commit | Result | Approved by | Live |', '| --- | --- | --- | --- | --- | --- |', ...rows.map((r) => `| ${cell(r.time)} | ${r.cols.join(' | ')} |`));
  }
  return { md: `${out.join('\n')}\n`, envs, withheld: held.map(({ file, matches, lines }) => ({ file, matches, lines })) };
}
