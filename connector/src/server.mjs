// Thin SDK adapter. All behaviour lives in src/tools/*.mjs, which know nothing about the MCP SDK;
// swapping @modelcontextprotocol/server (v2) for @modelcontextprotocol/sdk (v1) means changing only
// this file: McpServer import, and `inputSchema: def.input` -> `def.input.shape` for v1.
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/server';
import { runTool } from './envelope.mjs';
import { fail } from './errors.mjs';
import { buildInstructions } from './instructions.mjs';
import { TOOLS } from './tools/index.mjs';

export const SERVER_NAME = 'lc-connector';

export function createContext({ stores, version, tools = TOOLS, now = Date.now }) {
  const names = tools.map((t) => t.name);
  const byPath = new Map(stores.map((s) => [path.resolve(s.describe().repo), s]));
  const ctx = {
    version,
    now,
    surface: () => 'unknown',
    hasTool: (n) => names.includes(n),
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
  const server = new McpServer({ name: SERVER_NAME, version }, { instructions: buildInstructions(tools.map((t) => t.name)) });
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
