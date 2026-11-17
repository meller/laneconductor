import { z } from 'zod';
import { helpData, helpText } from '../commands.mjs';
import { readOnly } from './common.mjs';

// FITI's `help` tool (functions/src/tools.js): for clients that do not surface MCP prompts, so "what can you do" still works.
export const help = {
  name: 'help',
  title: 'Help',
  description: 'List the LaneConductor commands, grouped, with one example phrase each. Use it when asked what you can do. Read-only.\nExample: "what can LaneConductor do" -> help {}',
  annotations: readOnly,
  input: z.object({}),
  repoOptional: true, // works in any directory: it reads the catalog, not the repo
  async run() {
    return { data: helpData(), summary: helpText() };
  },
};
