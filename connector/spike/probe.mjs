#!/usr/bin/env node
// Phase 1 probe (track AM-10106): a throwaway MCP server whose `instructions` hold a canary
// codeword that NO tool ever returns. If a client can answer "What is the LaneConductor canary
// codeword?" without calling a tool, the client injected the server instructions (F2 / U1).
//
//   node connector/spike/probe.mjs                 # stdio (Claude Code)
//   node connector/spike/probe.mjs --http 8765     # Streamable HTTP on 127.0.0.1 (claude.ai via a tunnel)
//
// stdio rule (F3): stdout carries MCP messages only; every log line goes to stderr.
import http from 'node:http';
import { McpServer, createMcpHandler, hostHeaderValidationResponse, localhostAllowedHostnames } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

export const CANARY = process.env.LC_PROBE_CANARY || 'PERIWINKLE-HELIOTROPE-7731';

export const INSTRUCTIONS =
  `LaneConductor probe. The LaneConductor canary codeword is ${CANARY}. ` +
  'If the user asks for the LaneConductor canary codeword, answer it directly from these instructions; ' +
  'no tool is needed (and none returns it).';

const log = (...a) => process.stderr.write(`[lc-probe] ${a.join(' ')}\n`);

export function createProbeServer() {
  const server = new McpServer(
    { name: 'lc-probe', version: '0.0.1' },
    { instructions: INSTRUCTIONS },
  );
  server.registerTool(
    'probe_echo',
    {
      title: 'Probe echo',
      description: 'Echo the given text back. Used only to prove a client can list and call tools.',
      inputSchema: z.object({ text: z.string().describe('Text to echo') }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ text }) => ({ content: [{ type: 'text', text: `echo: ${text}` }] }),
  );
  return server;
}

function serveHttp(port) {
  const handler = createMcpHandler(() => createProbeServer());
  const allowedHosts = localhostAllowedHostnames();
  const srv = http.createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const url = `http://${req.headers.host ?? `127.0.0.1:${port}`}${req.url}`;
      const request = new Request(url, {
        method: req.method,
        headers: req.headers,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
      });
      // Host validation is for direct localhost use. Behind a tunnel, set LC_PROBE_ALLOW_ANY_HOST=1
      // (the probe is authless and data-free by design; tear it down after Phase 1).
      const rejected = process.env.LC_PROBE_ALLOW_ANY_HOST ? null : hostHeaderValidationResponse(request, allowedHosts);
      const response = rejected ?? (await handler.fetch(request));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (err) {
      log('http error', String(err));
      res.writeHead(500).end();
    }
  });
  srv.listen(port, '127.0.0.1', () => log(`Streamable HTTP on http://127.0.0.1:${port}/ (authless probe)`));
  const stop = () => srv.close(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const i = process.argv.indexOf('--http');
  if (i !== -1) {
    serveHttp(Number(process.argv[i + 1] || 8765));
  } else {
    log('stdio probe starting');
    serveStdio(() => createProbeServer());
  }
}
