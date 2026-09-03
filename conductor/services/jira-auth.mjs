// conductor/services/jira-auth.mjs
// Track TU-10049 Phase 2 (Task 2.2): jiraProjectExists() and
// resolveJiraToken() extracted out of bin/lc.mjs (originally L513/L563,
// where `lc add-target --type jira` used them inline) so the Collector
// API's credential-status endpoint can reuse the exact same check instead
// of re-implementing Jira auth a second time. bin/lc.mjs now imports these
// rather than defining its own copies — there is exactly one
// implementation of each.

import { execSync } from 'node:child_process';

/**
 * Resolves a Jira API token in priority order: named env var, GCP Secret
 * Manager, plain-text fallback. Never throws — a failed `gcloud` lookup
 * resolves to null, same as an unset env var, so callers can treat "no
 * token" uniformly as NOT CONFIGURED rather than an error.
 */
export function resolveJiraToken(tokenEnv, token, tokenSecret, tokenStore) {
  if (tokenEnv && process.env[tokenEnv]) {
    return process.env[tokenEnv];
  }
  if (tokenStore === 'gcp-secret' && tokenSecret) {
    try {
      return execSync(`gcloud secrets versions access latest --secret="${tokenSecret}"`, { encoding: 'utf8' }).trim();
    } catch {
      return null;
    }
  }
  return token || null;
}

/**
 * Checks a Jira project is reachable with the given credentials. Never
 * throws — network/auth failures resolve to `false`, the same as a
 * genuinely missing project, so callers render both as NOT CONFIGURED.
 */
export async function jiraProjectExists(domain, email, token, projectKey) {
  try {
    const auth = Buffer.from(`${email}:${token}`).toString('base64');
    const url = `https://${domain}/rest/api/3/project/${projectKey}`;
    const response = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(10000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
