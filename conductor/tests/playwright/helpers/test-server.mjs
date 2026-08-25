// conductor/tests/playwright/helpers/test-server.mjs
// Track 10021 Phase 5: a dedicated PW_TEST_MODE API server for
// track-1033-sharing.spec.js, on its own port, so exercising the 6
// auth-bypass sharing tests never requires restarting the LIVE shared
// ui/server/index.mjs instance on :8091 that every other in-flight track
// depends on.

import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = join(__dirname, '../../../..');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
  });
}

async function assertPortFree(port, { timeoutMs = 5000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortFree(port)) return;
    await sleep(200);
  }
  throw new Error(`stopTestServer: port ${port} is still in use ${timeoutMs}ms after shutdown — a child process may have leaked`);
}

/**
 * REQ-10: starts ui/server/index.mjs as a child process with
 * PW_TEST_MODE=true on its own port, for this spec file's isolated use.
 *
 * COLLECTOR_URL is set to this server's OWN address — ui/server/index.mjs
 * defaults it to http://127.0.0.1:8091, so a second server left at the
 * default would write straight back through the shared instance and the
 * isolation would be fictional.
 *
 * Spawns the script directly (not via `lc api start`), which already keeps
 * this off ui/.api.pid and ui/.api.log — that file is only written by the
 * `lc api start` / systemd code paths, never by index.mjs itself.
 */
export async function startTestServer({ port, projectRoot = PROJECT_ROOT, readyTimeoutMs = 20000 } = {}) {
  const resolvedPort = port ?? await getFreePort();
  const serverScript = join(projectRoot, 'ui/server/index.mjs');
  const apiUrl = `http://127.0.0.1:${resolvedPort}`;

  const proc = spawn('node', [serverScript], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PW_TEST_MODE: 'true',
      API_PORT: String(resolvedPort),
      COLLECTOR_URL: apiUrl,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  let stdout = '';
  proc.stderr.on('data', d => { stderr += d.toString(); });
  proc.stdout.on('data', d => { stdout += d.toString(); });

  const deadline = Date.now() + readyTimeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    // A server that dies on EADDRINUSE (or any other startup failure) must
    // say so — surfacing its stderr — rather than the caller waiting out a
    // silent readiness timeout (TC-22).
    if (proc.exitCode !== null) {
      throw new Error(
        `startTestServer: server process exited early (code ${proc.exitCode}) on port ${resolvedPort} before becoming ready.\n` +
        `stderr:\n${stderr}\nstdout:\n${stdout}`
      );
    }
    try {
      const r = await fetch(`${apiUrl}/api/health`);
      if (r.ok) return { proc, port: resolvedPort, apiUrl, projectRoot };
    } catch (err) {
      lastErr = err;
    }
    await sleep(300);
  }

  proc.kill('SIGKILL');
  throw new Error(
    `startTestServer: /api/health did not respond within ${readyTimeoutMs}ms on port ${resolvedPort}.\n` +
    `last connect error: ${lastErr?.message}\nstderr:\n${stderr}\nstdout:\n${stdout}`
  );
}

/**
 * REQ-10/AC-8: SIGTERM, then SIGKILL after a grace period, then confirms the
 * port is actually free — a leaked child process is exactly the failure
 * mode this whole module exists to avoid reintroducing.
 */
export async function stopTestServer(handle, { graceMs = 3000 } = {}) {
  if (!handle?.proc) return;

  if (handle.proc.exitCode === null && handle.proc.signalCode === null) {
    handle.proc.kill('SIGTERM');
    await Promise.race([
      new Promise(resolve => handle.proc.once('exit', resolve)),
      sleep(graceMs),
    ]);
    if (handle.proc.exitCode === null && handle.proc.signalCode === null) {
      handle.proc.kill('SIGKILL');
      await new Promise(resolve => handle.proc.once('exit', resolve));
    }
  }

  if (handle.port) await assertPortFree(handle.port);
}
