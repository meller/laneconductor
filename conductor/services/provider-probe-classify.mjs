// conductor/services/provider-probe-classify.mjs
// Pure classification of a `claude -p test` capacity probe's result
// (checkClaudeCapacity() in laneconductor.sync.mjs). Previously every
// non-zero exit code collapsed into a single 'exhausted' bucket with a
// hardcoded Date.now() + 60000 guess — including an expired OAuth login
// (confirmed live 2026-09-04: 'Failed to authenticate: OAuth session
// expired and could not be refreshed', exit 1), which is unrelated to
// usage and does not self-heal by waiting. No I/O — mirrors this
// codebase's other pure extractions (capacity-probe-throttle.mjs,
// exhaustion-detector.mjs) so the decision is testable without spawning a
// real CLI process.
import { isProviderExhausted } from './exhaustion-detector.mjs';

export const PROVIDER_STATUS = {
  OK: 'ok',
  EXHAUSTED: 'exhausted',
  AUTH_REQUIRED: 'auth_required',
  PROBE_FAILED: 'probe_failed',
};

const BLOCKING_STATUSES = new Set([
  PROVIDER_STATUS.EXHAUSTED,
  PROVIDER_STATUS.AUTH_REQUIRED,
  PROVIDER_STATUS.PROBE_FAILED,
]);

// Replaces every `status !== 'exhausted'` comparison that used to mean
// "available" (capacity-probe-throttle.mjs, and both branches of
// isProviderAvailable() in laneconductor.sync.mjs) — without this, a new
// auth_required/probe_failed value would read as available at those
// sites, strictly worse than today's behaviour.
export function isBlockingProviderStatus(status) {
  return BLOCKING_STATUSES.has(status);
}

// Tight, explicitly enumerated list — deliberately not a catch-all, and
// deliberately not a bare `401` substring, which collides with ordinary
// log content (a byte count, a URL query param, etc).
const AUTH_PATTERNS = [
  /failed to authenticate/i,
  /oauth session expired/i,
  /could not be refreshed/i,
  /invalid api key/i,
  /authentication_error/i,
  /\bunauthorized\b/i,
  /not logged in/i,
  /\brun\b[^\n]{0,20}\/login\b/i, // a "run ... /login" remedy prompt
];

function matchesAuthFailure(output) {
  return AUTH_PATTERNS.some(re => re.test(output));
}

function truncateFirstLine(output, maxLen = 200) {
  const firstLine = (output || '').split('\n').find(l => l.trim().length > 0) || '';
  return firstLine.length > maxLen ? `${firstLine.slice(0, maxLen)}…` : firstLine;
}

function parseResetTime(output, nowMs) {
  const match = output.match(/resets\s+(\d{1,2})(:?\d{2})?(am|pm)/i);
  if (!match) return new Date(nowMs + 15 * 60000).toISOString();

  let h = parseInt(match[1], 10);
  const isPM = match[3].toLowerCase() === 'pm';
  if (isPM && h !== 12) h += 12;
  if (!isPM && h === 12) h = 0;

  const now = new Date(nowMs);
  const resetAt = new Date(now);
  resetAt.setHours(h, match[2] ? parseInt(match[2].slice(1), 10) : 0, 0, 0);

  // If the time parsed is in the past, it resets tomorrow.
  if (resetAt.getTime() <= nowMs) {
    resetAt.setDate(resetAt.getDate() + 1);
  }
  return resetAt.toISOString();
}

/**
 * @param {object} opts
 * @param {number} opts.code - the probe process's exit code
 * @param {string} opts.output - combined stdout+stderr from the probe
 * @param {number} [opts.nowMs]
 * @returns {{status: string, available: boolean, reset_at: string|null, last_error: string|null, remedy: string|null}}
 */
export function classifyClaudeProbe({ code, output = '', nowMs = Date.now() }) {
  if (code === 0) {
    return { status: PROVIDER_STATUS.OK, available: true, reset_at: null, last_error: null, remedy: null };
  }

  // Auth is matched BEFORE rate limiting (REQ-2) — an auth failure and the
  // word "exhausted" can co-occur (e.g. an error page mentioning quota
  // terminology), and this is not a rate limit.
  if (matchesAuthFailure(output)) {
    return {
      status: PROVIDER_STATUS.AUTH_REQUIRED,
      available: false,
      reset_at: null,
      last_error: "Claude CLI login expired — run `claude login` to re-authenticate. This will not recover on its own.",
      remedy: "Run `claude login` to re-authenticate the standalone Claude CLI. This is separate from a Claude Code app session's own SDK-hosted auth.",
    };
  }

  // Rate-limit gate reuses the shared detector rather than a third private
  // substring list (REQ-3), ORed with the probe's own broader trigger set
  // so no case that is 'exhausted' today narrows into 'probe_failed'.
  const isExhausted = isProviderExhausted(output, 'claude')
    || /\bresets\b/i.test(output)
    || /\bexhausted\b/i.test(output);

  if (isExhausted) {
    return {
      status: PROVIDER_STATUS.EXHAUSTED,
      available: false,
      reset_at: parseResetTime(output, nowMs),
      last_error: 'Capacity exhausted',
      remedy: null,
    };
  }

  return {
    status: PROVIDER_STATUS.PROBE_FAILED,
    available: false,
    reset_at: null,
    last_error: truncateFirstLine(output) || 'Probe failed with no output',
    remedy: null,
  };
}

// Track 10062 REQ-9: formats WHY a provider is unavailable from the same
// cache entry the block decision came from, so every buildCliArgs()===null
// site can say more than the bare 'no provider available' that hid an
// expired login until a dispatch was manually chased down. Pure — the
// caller (laneconductor.sync.mjs's providerBlockReason) supplies the cache
// entry, keeping this testable without the module-level cache Map.
export function formatProviderBlockReason(cli, cached) {
  if (!cached) return `${cli} is unavailable`;
  if (cached.status === PROVIDER_STATUS.AUTH_REQUIRED) {
    return `${cli} login expired — run \`claude login\` to re-authenticate`;
  }
  if (cached.status === PROVIDER_STATUS.EXHAUSTED && cached.reset_at) {
    return `${cli} capacity exhausted — resets at ${cached.reset_at}`;
  }
  if (cached.last_error) {
    return `${cli} unavailable — ${cached.last_error}`;
  }
  return `${cli} is unavailable`;
}
