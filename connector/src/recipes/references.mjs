// Reference resolution and recipe freshness (spec REQ-9, REQ-10). A reference names `owner/name`; the
// local checkout is found by its `origin` URL, never by folder name (V6). Nothing here fetches or
// writes: it only reads objects already in the reference repo.
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const DAY = 86_400_000;
const INDEX_TTL_MS = 60_000;

function git(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', ['-c', 'core.quotepath=off', ...args], { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' }, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout ?? '') });
    });
  });
}

/** `git@github.com:o/r.git`, `https://github.com/o/r/`, `ssh://git@github.com/o/r.git` -> `o/r` (lower-case), else null. */
export function normalizeRepoUrl(url) {
  if (typeof url !== 'string') return null;
  const m = /^(?:[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?[^/:]+(?::\d+)?\/|[^@/\s]+@[^:/\s]+:)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(url.trim());
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}

export const defaultRoots = () => [path.join(os.homedir(), 'Code')];

/**
 * Maps `owner/name` to a local checkout: every immediate subfolder of the roots whose `origin` URL
 * normalizes to it. The scan is cached briefly so a find over many recipes spawns git once per repo.
 */
export function createRefResolver({ roots = defaultRoots(), now = Date.now } = {}) {
  let cached = null;
  async function scan() {
    const index = new Map();
    for (const root of roots) {
      let entries;
      try {
        entries = await fs.readdir(root, { withFileTypes: true });
      } catch {
        continue;
      }
      const dirs = entries.filter((d) => (d.isDirectory() || d.isSymbolicLink()) && !d.name.startsWith('.'));
      const found = await Promise.all(dirs.map(async (d) => {
        const dir = path.join(root, d.name);
        if (!(await fs.stat(path.join(dir, '.git')).catch(() => null))) return null; // not itself a checkout
        const r = await git(dir, ['config', '--get', 'remote.origin.url']);
        return r.code === 0 ? [normalizeRepoUrl(r.stdout.trim()), dir] : null;
      }));
      for (const f of found) if (f?.[0] && !index.has(f[0])) index.set(f[0], f[1]);
    }
    return index;
  }
  return {
    roots,
    /** @returns {Promise<string|null>} the checkout directory, or null when no root holds it */
    async resolve(ownerName) {
      if (!cached || now() - cached.at > INDEX_TTL_MS) cached = { at: now(), index: await scan() };
      return cached.index.get(String(ownerName).toLowerCase()) ?? null;
    },
  };
}

async function blobAt(dir, rev, file) {
  const r = await git(dir, ['rev-parse', '--verify', '-q', `${rev}:${file}`]);
  return r.code === 0 ? r.stdout.trim() : null;
}

/**
 * Checks one reference against its repo. status:
 *   ok | changed (blob at HEAD differs from the blob at the cited commit) | missing_at_head |
 *   missing_at_commit (the cited commit lacks the path, or is unknown here: the recipe itself is wrong) | unresolvable
 */
export async function checkReference(ref, resolver) {
  const dir = resolver ? await resolver.resolve(ref.repo) : null;
  if (!dir) return { ...pick(ref), status: 'unresolvable' };
  const atCommit = await blobAt(dir, ref.commit, ref.path);
  const atHead = await blobAt(dir, 'HEAD', ref.path);
  if (atCommit === null) return { ...pick(ref), status: 'missing_at_commit', at_head: atHead !== null };
  if (atHead === null) return { ...pick(ref), status: 'missing_at_head' };
  return { ...pick(ref), status: atCommit === atHead ? 'ok' : 'changed' };
}

const pick = (r) => ({ repo: r.repo, path: r.path, commit: r.commit });

/**
 * REQ-9 freshness of one recipe from its `metadata`. `resolver` may be null (a surface that cannot read
 * the reference repos): every reference is then `reference_unresolvable`.
 * @returns {Promise<{ freshness: 'fresh'|'possibly_stale'|'stale', stale_reasons: string[], references: object[] }>}
 */
export async function recipeFreshness(metadata, { resolver, now = Date.now() } = {}) {
  const md = metadata ?? {};
  const stale = [];
  const possibly = [];
  const refs = await Promise.all((Array.isArray(md.reference) ? md.reference : []).map((r) => checkReference(r, resolver)));
  if (md.verified === null || md.verified === undefined) stale.push('verified_missing');
  else if (now - Date.parse(md.verified) > 90 * DAY) possibly.push('verified_older_than_90d');
  if (refs.some((r) => r.status === 'missing_at_head')) stale.push('reference_missing');
  // A cited commit that lacks the path means the recorded evidence no longer matches; treat it like a change.
  if (refs.some((r) => r.status === 'changed' || r.status === 'missing_at_commit')) possibly.push('reference_changed_since_verified');
  if (refs.some((r) => r.status === 'unresolvable')) possibly.push('reference_unresolvable');
  const reasons = [...stale, ...possibly];
  return { freshness: stale.length ? 'stale' : possibly.length ? 'possibly_stale' : 'fresh', stale_reasons: reasons, references: refs };
}
