// LocalGitStore: the StateStore backend behind the stdio server (spec "Storage interface").
// Reads the working tree; every write is serialised (in-process mutex + .git/lc-connector.lock),
// checked against its preconditions, written atomically (tmp + rename) and committed with
// `git commit -- <exactly the written paths>` so unrelated staged or dirty files are never swept in.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isLogFile, logFile } from './advice-log.mjs';
import { blobSha } from './blob.mjs';
import { fail } from './errors.mjs';
import { PUSH_IDLE_MS } from './push-policy.mjs';

const STATE_ROOT = 'conductor/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function git(cwd, args, { input, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-c', 'core.quotepath=off', ...args], {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const out = [];
    const err = [];
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', (e) => reject(fail('BACKEND_UNAVAILABLE', `git could not be run: ${e.message}`)));
    child.on('close', (code) => resolve({ code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') }));
    child.stdin.on('error', () => {});
    child.stdin.end(input ?? '');
  });
}

export class LocalGitStore {
  constructor({ repo, stateBranch = 'main', stateBranchSource = 'default', now = Date.now, lockTimeoutMs = 10_000, lockStaleMs = 30_000, indexLockRetries = 3, indexLockBackoffMs = 200, pushPolicy = 'ask', pushIdleMs = PUSH_IDLE_MS, timers = { set: setTimeout, clear: clearTimeout } }) {
    this.repo = path.resolve(repo);
    this.stateBranch = stateBranch;
    this.stateBranchSource = stateBranchSource;
    this.now = now;
    this.lockTimeoutMs = lockTimeoutMs;
    this.lockStaleMs = lockStaleMs;
    this.indexLockRetries = indexLockRetries;
    this.indexLockBackoffMs = indexLockBackoffMs;
    this.pushPolicy = pushPolicy;
    this.pushIdleMs = pushIdleMs;
    this.timers = timers;
    this._pushTimer = null;
    this._lastPush = null;
    this._chain = Promise.resolve();
    this._lockPath = null;
    this._realRepo = null;
  }

  describe() {
    return { backend: 'local', repo: this.repo, branch: this.stateBranch, branchSource: this.stateBranchSource };
  }

  _git(args, opts) {
    return git(this.repo, args, opts);
  }

  async _gitOk(args, opts) {
    const r = await this._git(args, opts);
    if (r.code !== 0) throw fail('BACKEND_UNAVAILABLE', `git ${args[0]} failed: ${r.stderr.trim().split('\n')[0] || `exit ${r.code}`}`);
    return r.stdout;
  }

  async isRepo() {
    const r = await this._git(['rev-parse', '--is-inside-work-tree']);
    return r.code === 0 && r.stdout.trim() === 'true';
  }

  async currentBranch() {
    const r = await this._git(['symbolic-ref', '--short', '-q', 'HEAD']);
    return r.code === 0 ? r.stdout.trim() : null;
  }

  async head() {
    const r = await this._git(['rev-parse', '--verify', '-q', 'HEAD']);
    if (r.code !== 0) return { commit: null, commitTime: null };
    const commit = r.stdout.trim();
    const t = await this._git(['log', '-1', '--format=%cI', commit]);
    return { commit, commitTime: t.code === 0 ? t.stdout.trim() : null };
  }

  async freshness() {
    const checkoutBranch = await this.currentBranch();
    const dirtyPaths = await this._dirtyPaths();
    return { dirtyPaths, upstream: await this._upstream(), checkoutBranch };
  }

  async _dirtyPaths() {
    const r = await this._git(['status', '--porcelain=v1', '-z', '-uall', '--', 'conductor']);
    if (r.code !== 0) return [];
    const fields = r.stdout.split('\0');
    const paths = [];
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (f.length < 4) continue;
      paths.push(f.slice(3));
      if (f[0] === 'R' || f[0] === 'C' || f[1] === 'R' || f[1] === 'C') i++;
    }
    // The advice log changes on every call; it is not plan state that a remote surface is missing.
    return paths.filter((p) => !isLogFile(p));
  }

  /** Advice-log lines are appended to the working tree at once (D3-a) and committed with the next connector commit. */
  async appendLog(lines) {
    const byFile = new Map();
    for (const l of lines) byFile.set(logFile(l.ts), `${byFile.get(logFile(l.ts)) ?? ''}${JSON.stringify(l)}\n`);
    for (const [rel, text] of byFile) {
      const abs = path.join(this.repo, rel);
      await this._assertInside(abs);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.appendFile(abs, text, 'utf8');
    }
  }

  /** Uncommitted advice-log files, so a connector commit can carry them along. */
  async _dirtyLogPaths() {
    const r = await this._git(['status', '--porcelain=v1', '-z', '-uall', '--', 'conductor/advice-log']);
    if (r.code !== 0) return [];
    return r.stdout.split('\0').filter((f) => f.length > 3).map((f) => f.slice(3)).filter((p) => isLogFile(p));
  }

  async _upstream() {
    const ref = await this._git(['rev-parse', '--abbrev-ref', '-q', `${this.stateBranch}@{upstream}`]);
    if (ref.code !== 0 || !ref.stdout.trim()) return null;
    const counts = await this._git(['rev-list', '--left-right', '--count', `refs/heads/${this.stateBranch}...${this.stateBranch}@{upstream}`]);
    let ahead = 0;
    let behind = 0;
    if (counts.code === 0) [ahead, behind] = counts.stdout.trim().split(/\s+/).map(Number);
    return { ref: ref.stdout.trim(), ahead, behind, lastFetchAt: await this._lastFetchAt() };
  }

  async _lastFetchAt() {
    const r = await this._git(['rev-parse', '--git-path', 'FETCH_HEAD']);
    if (r.code !== 0) return null;
    try {
      const st = await fs.stat(path.resolve(this.repo, r.stdout.trim()));
      return new Date(st.mtimeMs).toISOString();
    } catch {
      return null;
    }
  }

  /** Names of the directories under `dir` on the state branch's upstream ref ([] when none). */
  async upstreamDirs(dir) {
    const r = await this._git(['ls-tree', '-d', '--name-only', `${this.stateBranch}@{upstream}`, `${dir.replace(/\/?$/, '/')}`]);
    if (r.code !== 0) return [];
    return r.stdout.split('\n').filter(Boolean).map((p) => path.posix.basename(p));
  }

  // ---- push policy (D4) -----------------------------------------------------------------------

  pushStatus() {
    return { policy: this.pushPolicy, last: this._lastPush };
  }

  /** `auto-state` only: restart the idle countdown after every connector commit (a write burst pushes once). */
  _schedulePush() {
    if (this.pushPolicy !== 'auto-state') return;
    if (this._pushTimer) this.timers.clear(this._pushTimer);
    this._pushTimer = this.timers.set(() => this.pushState().catch(() => {}), this.pushIdleMs);
    this._pushTimer?.unref?.();
  }

  /**
   * Fast-forward push of the state branch, only when every unpushed commit touches nothing outside
   * conductor/. Never forces. The outcome is remembered (for response warnings) and logged as a `push` line.
   */
  async pushState() {
    this._pushTimer = null;
    const result = await this._tryPush();
    this._lastPush = result;
    const lines = [{ v: 1, ts: new Date(this.now()).toISOString().replace(/\.\d{3}Z$/, 'Z'), kind: 'push', session: 'store', surface: 'lc-connector', ok: result.ok, ...(result.reason ? { reason: result.reason } : {}), commits: result.commits }];
    await this.appendLog(lines).catch(() => {});
    return result;
  }

  async _tryPush() {
    const up = await this._upstream();
    if (!up) return { ok: false, reason: 'no_upstream', commits: [] };
    if (up.behind > 0) return { ok: false, reason: 'behind_upstream', commits: [] };
    if (up.ahead === 0) return { ok: true, commits: [] };
    const range = `${up.ref}..refs/heads/${this.stateBranch}`;
    const merges = (await this._git(['rev-list', '--merges', '--abbrev-commit', range])).stdout.split('\n').filter(Boolean);
    if (merges.length) return { ok: false, reason: 'merge_commit', commits: merges };
    const log = (await this._git(['log', '--format=@%h', '--name-only', range])).stdout.split('\n');
    const commits = [];
    const outside = new Set();
    let cur = null;
    for (const l of log) {
      if (l.startsWith('@')) { cur = l.slice(1); commits.push(cur); } else if (l && !l.startsWith(STATE_ROOT)) outside.add(cur);
    }
    if (outside.size) return { ok: false, reason: 'non_state_commit', commits: [...outside] };
    const remote = (await this._git(['config', `branch.${this.stateBranch}.remote`])).stdout.trim();
    const mergeRef = (await this._git(['config', `branch.${this.stateBranch}.merge`])).stdout.trim();
    if (!remote || !mergeRef) return { ok: false, reason: 'no_upstream', commits: [] };
    const r = await this._git(['push', '-q', remote, `refs/heads/${this.stateBranch}:${mergeRef}`]);
    return r.code === 0 ? { ok: true, commits } : { ok: false, reason: 'push_rejected', commits };
  }

  async isAncestor(commit) {
    if (!/^[0-9a-f]{7,40}$/i.test(commit)) return false;
    const exists = await this._git(['cat-file', '-e', `${commit}^{commit}`]);
    if (exists.code !== 0) return false;
    const ref = (await this._git(['rev-parse', '--verify', '-q', `refs/heads/${this.stateBranch}`])).code === 0 ? `refs/heads/${this.stateBranch}` : 'HEAD';
    return (await this._git(['merge-base', '--is-ancestor', commit, ref])).code === 0;
  }

  // ---- path safety -------------------------------------------------------------------------

  _normalize(rel, { writing = false } = {}) {
    if (typeof rel !== 'string' || rel === '' || rel.includes('\0') || rel.includes('\\') || path.posix.isAbsolute(rel)) {
      throw fail('VALIDATION_FAILED', `Invalid path ${JSON.stringify(rel)}`);
    }
    const norm = path.posix.normalize(rel);
    if (norm === '..' || norm.startsWith('../') || norm === '.git' || norm.startsWith('.git/') || norm.includes('/.git/')) {
      throw fail('VALIDATION_FAILED', `Path escapes the repository or targets .git: ${rel}`);
    }
    if (writing && !norm.startsWith(STATE_ROOT)) {
      throw fail('VALIDATION_FAILED', `The connector only writes under ${STATE_ROOT} (got ${rel})`);
    }
    return norm;
  }

  async _realRoot() {
    this._realRepo ??= await fs.realpath(this.repo);
    return this._realRepo;
  }

  /** Throws when the nearest existing ancestor of `abs` resolves outside the repo (symlink escape). */
  async _assertInside(abs) {
    const root = await this._realRoot();
    let cur = abs;
    for (;;) {
      try {
        const real = await fs.realpath(cur);
        if (real !== root && !real.startsWith(root + path.sep)) throw fail('VALIDATION_FAILED', 'Path resolves outside the repository (symlink)');
        return;
      } catch (e) {
        if (e.code === 'ENOENT') {
          const parent = path.dirname(cur);
          if (parent === cur) return;
          cur = parent;
        } else throw e;
      }
    }
  }

  // ---- reads --------------------------------------------------------------------------------

  async listDir(rel) {
    const norm = this._normalize(rel);
    const abs = path.join(this.repo, norm);
    await this._assertInside(abs);
    let entries;
    try {
      entries = await fs.readdir(abs, { withFileTypes: true });
    } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return [];
      throw e;
    }
    return entries
      .filter((d) => d.isDirectory() || d.isFile())
      .map((d) => ({ name: d.name, type: d.isDirectory() ? 'dir' : 'file', sha: '' }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Paths under `prefix` that are in the tree of HEAD (Set; empty when there is no commit yet). Local git only, no network. */
  async trackedFiles(prefix) {
    const norm = this._normalize(prefix.replace(/\/+$/, ''));
    const r = await this._git(['ls-tree', '-r', '--name-only', '-z', 'HEAD', '--', `${norm}/`]);
    if (r.code !== 0) return new Set();
    return new Set(r.stdout.split('\0').filter(Boolean));
  }

  async _read(rel) {
    const norm = this._normalize(rel);
    const abs = path.join(this.repo, norm);
    await this._assertInside(abs);
    try {
      const buf = await fs.readFile(abs);
      return { content: buf.toString('utf8'), sha: blobSha(buf) };
    } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'EISDIR' || e.code === 'ENOTDIR') return null;
      throw e;
    }
  }

  async readFiles(paths) {
    const out = new Map();
    const results = await Promise.all(paths.map((p) => this._read(p)));
    paths.forEach((p, i) => out.set(p, results[i]));
    return out;
  }

  // ---- writes -------------------------------------------------------------------------------

  async _lockFile() {
    if (!this._lockPath) {
      const r = await this._gitOk(['rev-parse', '--git-path', 'lc-connector.lock']);
      this._lockPath = path.resolve(this.repo, r.trim());
    }
    return this._lockPath;
  }

  async _acquire() {
    const lock = await this._lockFile();
    const deadline = Date.now() + this.lockTimeoutMs;
    for (;;) {
      try {
        const fh = await fs.open(lock, 'wx');
        await fh.writeFile(`${process.pid} ${Date.now()}\n`);
        await fh.close();
        return lock;
      } catch (e) {
        if (e.code !== 'EEXIST') throw fail('WRITE_FAILED', `Could not create the write lock: ${e.message}`);
        if (await this._lockIsStale(lock)) {
          await fs.rm(lock, { force: true });
          continue;
        }
        if (Date.now() > deadline) throw fail('WRITE_FAILED', 'Timed out waiting for another connector write to finish', { hint: `If no other session is writing, remove ${lock}.` });
        await sleep(20);
      }
    }
  }

  async _lockIsStale(lock) {
    try {
      const st = await fs.stat(lock);
      if (Date.now() - st.mtimeMs > this.lockStaleMs) return true;
      const pid = Number((await fs.readFile(lock, 'utf8')).split(' ')[0]);
      if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) {
        try { process.kill(pid, 0); } catch (e) { if (e.code === 'ESRCH') return true; }
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Runs `fn(tx)` while holding the write lock. `tx` has the read methods plus `commitFiles`, so
   * a tool can read, decide and write as one unit (create_track numbering, update_track checks).
   */
  async transaction(fn) {
    const run = async () => {
      const lock = await this._acquire();
      try {
        return await fn({
          listDir: (p) => this.listDir(p),
          readFiles: (p) => this.readFiles(p),
          trackedFiles: (p) => this.trackedFiles(p),
          upstreamDirs: (p) => this.upstreamDirs(p),
          head: () => this.head(),
          isAncestor: (c) => this.isAncestor(c),
          commitFiles: (req) => this._commitFiles(req),
        });
      } finally {
        await fs.rm(lock, { force: true });
      }
    };
    const next = this._chain.then(run, run);
    this._chain = next.catch(() => {});
    return next;
  }

  commitFiles(req) {
    return this.transaction((tx) => tx.commitFiles(req));
  }

  async _withIndexLockRetry(args) {
    let r;
    for (let attempt = 0; attempt <= this.indexLockRetries; attempt++) {
      r = await this._git(args, { env: { GIT_OPTIONAL_LOCKS: '1' } });
      if (r.code === 0 || !/index\.lock/.test(r.stderr)) return r;
      if (attempt < this.indexLockRetries) await sleep(this.indexLockBackoffMs * 2 ** attempt);
    }
    return r;
  }

  async _isIgnored(rel) {
    const r = await this._git(['check-ignore', '-q', '--', rel]);
    return r.code === 0;
  }

  async _commitFiles({ preconditions = [], changes, message }) {
    const branch = await this.currentBranch();
    if (branch !== this.stateBranch) {
      throw fail('NOT_ON_STATE_BRANCH', `Checkout is on ${branch ?? 'a detached HEAD'}, but state lives on ${this.stateBranch}`, {
        hint: `Writes are refused off the state branch. Switch to ${this.stateBranch} (git switch ${this.stateBranch}) or start the server with --state-branch ${branch ?? '<branch>'}.`,
      });
    }
    const norm = changes.map((c) => ({ ...c, path: this._normalize(c.path, { writing: true }) }));
    if (new Set(norm.map((c) => c.path)).size !== norm.length) throw fail('VALIDATION_FAILED', 'Duplicate path in one write');
    // 1. preconditions, against the bytes on disk right now
    const conflict = [];
    for (const pre of preconditions) {
      const cur = await this._read(this._normalize(pre.path, { writing: true }));
      const actual = cur ? cur.sha : null;
      if (actual !== pre.sha) conflict.push({ path: pre.path, expected: pre.sha, actual });
    }
    if (conflict.length) return { ok: false, conflict };
    // 2. snapshot, then write atomically
    const snapshot = new Map();
    for (const c of norm) {
      const abs = path.join(this.repo, c.path);
      await this._assertInside(abs);
      try { snapshot.set(c.path, await fs.readFile(abs)); } catch { snapshot.set(c.path, null); }
    }
    const rollback = async () => {
      for (const [rel, buf] of snapshot) {
        const abs = path.join(this.repo, rel);
        if (buf === null) await fs.rm(abs, { force: true });
        else await fs.writeFile(abs, buf);
      }
    };
    try {
      for (const c of norm) {
        const abs = path.join(this.repo, c.path);
        if (c.delete) {
          await fs.rm(abs, { force: true });
          continue;
        }
        await fs.mkdir(path.dirname(abs), { recursive: true });
        const tmp = `${abs}.lc-tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
        try {
          await fs.writeFile(tmp, c.content, 'utf8');
          await fs.rename(tmp, abs);
        } catch (e) {
          await fs.rm(tmp, { force: true });
          throw e;
        }
      }
    } catch (e) {
      await rollback().catch(() => {});
      throw fail('WRITE_FAILED', `Could not write files: ${e.message}`);
    }
    // 3. stage and commit only these paths (gitignored ones, e.g. conversation.md under D5, are written but not committed)
    const ignored = [];
    const commitPaths = [];
    for (const c of norm) {
      if (!c.delete && (await this._isIgnored(c.path))) ignored.push(c.path);
      else commitPaths.push(c.path);
    }
    if (commitPaths.length === 0) {
      return { ok: true, commit: null, commitError: `${ignored.join(', ')} is gitignored (decision D5); written but not committed`, ignored };
    }
    for (const lp of await this._dirtyLogPaths()) if (!commitPaths.includes(lp) && !(await this._isIgnored(lp))) commitPaths.push(lp);
    const add = await this._withIndexLockRetry(['add', '-A', '--', ...commitPaths]);
    if (add.code !== 0) {
      await rollback().catch(() => {});
      throw fail('WRITE_FAILED', `git add failed: ${add.stderr.trim().split('\n')[0]}`, { hint: 'The write was rolled back; nothing changed on disk. Retry shortly (another git process may hold the index).' });
    }
    return this._commit(message, commitPaths, ignored);
  }

  async _commit(message, commitPaths, ignored) {
    let r;
    for (let attempt = 0; attempt <= this.indexLockRetries; attempt++) {
      r = await this._git(['commit', '-q', '-F', '-', '--', ...commitPaths], { input: message, env: { GIT_OPTIONAL_LOCKS: '1' } });
      if (r.code === 0 || !/index\.lock/.test(r.stderr)) break;
      if (attempt < this.indexLockRetries) await sleep(this.indexLockBackoffMs * 2 ** attempt);
    }
    if (r.code !== 0) {
      await this._git(['reset', '-q', '--', ...commitPaths]);
      const detail = (r.stderr.trim() || r.stdout.trim()).split('\n').slice(0, 5).join(' | ').slice(0, 500);
      return { ok: true, commit: null, commitError: `git commit failed: ${detail || `exit ${r.code}`}`, ignored };
    }
    const sha = (await this._gitOk(['rev-parse', 'HEAD'])).trim();
    this._schedulePush();
    return { ok: true, commit: sha, ...(ignored.length ? { ignored } : {}) };
  }
}
