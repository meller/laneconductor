// Phase 1 (code side): verify the probe with the MCP SDK's own client and with a raw 2025-era
// JSON-RPC client. TC-1.1 / 1.2 / 1.3 against REAL Claude Code and claude.ai remain HUMAN steps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { spawnRaw } from './helpers/rawstdio.mjs';

const PROBE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'spike', 'probe.mjs');
const CANARY = 'PERIWINKLE-HELIOTROPE-7731';

test('probe over stdio via the SDK v2 client: instructions visible, tool listed and callable (TC-1.3)', async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: [PROBE], stderr: 'pipe' });
  const client = new Client({ name: 'probe-test', version: '0' });
  try {
    await client.connect(transport);
    assert.match(client.getInstructions() ?? '', new RegExp(CANARY), 'instructions carry the canary');
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name), ['probe_echo']);
    assert.equal(tools[0].annotations.readOnlyHint, true);
    assert.equal(tools[0].annotations.destructiveHint, false);
    const res = await client.callTool({ name: 'probe_echo', arguments: { text: 'ping' } });
    const text = res.content.map((c) => c.text).join('');
    assert.equal(text, 'echo: ping');
    assert.ok(!text.includes(CANARY), 'no tool returns the canary');
  } finally {
    await client.close();
  }
});

for (const version of ['2025-06-18', '2025-03-26']) {
  test(`probe answers a raw ${version} initialize with instructions, stdout is MCP-only (TC-1.4)`, async () => {
    const raw = spawnRaw(process.execPath, [PROBE]);
    try {
      const init = await raw.initialize(version);
      assert.ok(init.result, JSON.stringify(init));
      assert.match(init.result.instructions ?? '', new RegExp(CANARY));
      const list = await raw.request('tools/list', {});
      assert.deepEqual(list.result.tools.map((t) => t.name), ['probe_echo']);
      const call = await raw.request('tools/call', { name: 'probe_echo', arguments: { text: 'x' } });
      assert.equal(call.result.content[0].text, 'echo: x');
      for (const line of raw.stdoutLines) {
        const msg = JSON.parse(line); // throws on any non-JSON stdout line
        assert.equal(msg.jsonrpc, '2.0', `stdout line is not a JSON-RPC message: ${line}`);
      }
    } finally {
      await raw.kill();
    }
  });
}
