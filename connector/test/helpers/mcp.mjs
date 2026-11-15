// Drives the real stdio server through the SDK's own client. Always closes (kills) the child.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

export const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'lc-connector.mjs');

export async function connect(repoArgs, { extraArgs = [], clientName = 'connector-test' } = {}) {
  const repos = Array.isArray(repoArgs) ? repoArgs : [repoArgs];
  const args = [BIN, ...repos.flatMap((r) => ['--repo', r]), ...extraArgs];
  const transport = new StdioClientTransport({ command: process.execPath, args, stderr: 'pipe' });
  const stderr = [];
  transport.stderr?.on('data', (d) => stderr.push(d));
  const client = new Client({ name: clientName, version: '0.0.0' });
  await client.connect(transport);
  const call = async (name, a = {}) => {
    const res = await client.callTool({ name, arguments: a });
    const env = res.structuredContent;
    return { res, env, text: res.content.map((c) => c.text).join(''), isError: !!res.isError };
  };
  return { client, call, pid: transport.pid, stderr: () => Buffer.concat(stderr).toString('utf8'), close: () => client.close() };
}
