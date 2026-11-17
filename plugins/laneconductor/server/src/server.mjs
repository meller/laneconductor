// Thin SDK adapter. All behaviour lives in src/tools/*.mjs, which know nothing about the MCP SDK;
// swapping @modelcontextprotocol/server (v2) for @modelcontextprotocol/sdk (v1) means changing only
// this file: McpServer import, and `inputSchema: def.input` -> `def.input.shape` for v1.
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/server';
import { callEvents } from './advice-log.mjs';
import { runTool } from './envelope.mjs';
import { fail } from './errors.mjs';
import { buildInstructions } from './instructions.mjs';
import { TOOLS } from './tools/index.mjs';
import { z } from 'zod';

export const SERVER_NAME = 'lc-connector';

export function createContext({ stores, version, tools = TOOLS, now = Date.now }) {
  const names = tools.map((t) => t.name);
  const instructions = buildInstructions(names);
  const session = `c_${randomBytes(6).toString('hex')}`;
  const byPath = new Map(stores.map((s) => [path.resolve(s.describe().repo), s]));
  const ctx = {
    version,
    now,
    session,
    instructions,
    surface: () => 'unknown',
    hasTool: (n) => names.includes(n),
    /** Rough tokens (characters / 4) of what a session pays for: the instructions plus the tool list (KC-8). */
    contextTokens: () => {
      const list = tools.map((t) => ({ name: t.name, description: t.description, inputSchema: z.toJSONSchema(t.input, { io: 'input', unrepresentable: 'any' }) }));
      return Math.ceil((instructions.length + JSON.stringify(list).length) / 4);
    },
    /** Appends this call's advice-log lines. Never throws: a log failure must not fail the tool call. */
    async log(store, info) {
      if (info.code === 'NOT_A_LANECONDUCTOR_REPO' || !store.appendLog) return;
      try {
        const meta = { now: now(), session, surface: ctx.surface() };
        await store.appendLog(callEvents({ ...info, backend: store.describe().backend }, meta));
      } catch (e) {
        process.stderr.write(`[lc-connector] advice log write failed: ${e.message}\n`);
      }
    },
    resolveStore(project) {
      if (project === undefined || project === null || project === '') return stores[0];
      const s = byPath.get(path.resolve(project));
      if (!s) {
        throw fail('VALIDATION_FAILED', `project ${JSON.stringify(project)} is not served by this connector`, {
          hint: `Served: ${[...byPath.keys()].join(', ')}. Omit project to use the default, or start the server with another --repo.`,
        });
      }
      return s;
    },
    async assertConductorRepo(store) {
      if (!(await store.isRepo?.() ?? true)) {
        throw fail('NOT_A_LANECONDUCTOR_REPO', `${store.describe().repo} is not a git repository`, { hint: 'Start the connector with --repo pointing at a git checkout that has conductor/tracks/.' });
      }
      const top = await store.listDir('conductor');
      if (!top.some((e) => e.name === 'tracks' && e.type === 'dir')) {
        throw fail('NOT_A_LANECONDUCTOR_REPO', `No conductor/tracks/ in ${store.describe().repo}`, { hint: 'This project has no LaneConductor tracks folder. Ask the user before creating one.' });
      }
    },
  };
  return ctx;
}

export function createConnectorServer({ stores, version, tools = TOOLS, now }) {
  const ctx = createContext({ stores, version, tools, now });
  const server = new McpServer({ name: SERVER_NAME, version }, { instructions: ctx.instructions });
  ctx.surface = () => server.server.getClientVersion?.()?.name ?? 'unknown';
  for (const def of tools) {
    server.registerTool(
      def.name,
      { title: def.title, description: def.description, inputSchema: def.input, annotations: def.annotations },
      async (args) => runTool(def, ctx, args),
    );
  }
  return server;
}
