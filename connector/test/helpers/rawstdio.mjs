// Minimal raw JSON-RPC-over-stdio driver, independent of any SDK. It simulates what Claude Code
// (a 2025-era client) sends: `initialize` with an older protocolVersion, then `initialized`.
import { spawn } from 'node:child_process';

export function spawnRaw(command, args, opts = {}) {
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], ...opts });
  const stdoutLines = [];
  const stderrChunks = [];
  const waiters = new Map();
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d.toString('utf8');
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      stdoutLines.push(line);
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && waiters.has(msg.id)) {
          waiters.get(msg.id)(msg);
          waiters.delete(msg.id);
        }
      } catch { /* a non-JSON line is recorded in stdoutLines; tests assert on it */ }
    }
  });
  child.stderr.on('data', (d) => stderrChunks.push(d));
  let nextId = 1;
  const api = {
    child,
    stdoutLines,
    stderr: () => Buffer.concat(stderrChunks).toString('utf8'),
    request(method, params, timeoutMs = 10_000) {
      const id = nextId++;
      const p = new Promise((resolve, reject) => {
        const t = setTimeout(() => { waiters.delete(id); reject(new Error(`timeout waiting for ${method}`)); }, timeoutMs);
        waiters.set(id, (m) => { clearTimeout(t); resolve(m); });
      });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      return p;
    },
    notify(method, params) {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
    },
    async initialize(protocolVersion = '2025-06-18') {
      const r = await api.request('initialize', {
        protocolVersion, capabilities: {}, clientInfo: { name: 'raw-test-client', version: '0' },
      });
      api.notify('notifications/initialized');
      return r;
    },
    async kill() {
      if (child.exitCode !== null || child.signalCode) return;
      const exited = new Promise((r) => child.once('exit', r));
      child.stdin.end();
      child.kill('SIGTERM');
      const t = setTimeout(() => child.kill('SIGKILL'), 2000);
      await exited;
      clearTimeout(t);
    },
  };
  return api;
}
