import { z } from 'zod';
import { ENVELOPE_RESERVE, MAX_TEXT_CHARS } from '../envelope.mjs';
import { fail } from '../errors.mjs';
import { LANES, framing, guideSources, loadGuide, newServeId } from '../guides.mjs';
import { projectField, readOnly, sizeOf } from './common.mjs';

const CONTEXT_FILES = ['product.md', 'product-guidelines.md', 'tech-stack.md', 'workflow.md', 'quality-gate.md', 'kpis.md'];
const STYLEGUIDE_DIR = 'conductor/code_styleguides';
const CONTENT_BUDGET = 30_000;

const input = z.object({
  project: projectField,
  files: z.array(z.string()).optional().describe('Context files to return in full, by name from the manifest, e.g. "tech-stack.md".'),
  lane: z.enum(['plan', 'implement', 'review', 'quality-gate', 'merge', 'brainstorm']).optional().describe('Return the guide for this lane, framed as advice.'),
});

function describeFile(name, content, sha) {
  const lines = content.split('\n');
  const headings = lines.filter((l) => /^## /.test(l)).map((l) => l.slice(3).trim()).slice(0, 20);
  let first = '';
  let para = [];
  for (const l of lines) {
    if (/^#{1,6} /.test(l)) { if (para.length) break; else continue; }
    if (l.trim() === '') { if (para.length) break; else continue; }
    para.push(l.trim());
  }
  first = para.join(' ').slice(0, 300);
  return { name, bytes: Buffer.byteLength(content), sha, headings, first_paragraph: first };
}

export const getContext = {
  name: 'get_context',
  title: 'Get project context and lane guide',
  description: 'Start here when planning or working a track. With no arguments: a manifest of the project context files (product, tech-stack, workflow, quality-gate, kpis, styleguides) and the lane transitions. `files` returns chosen files in full; `lane` returns that lane\'s guide, framed as advice you may decline.',
  annotations: readOnly,
  input,
  async run({ store, ctx, args }) {
    const warnings = [];
    const styleEntries = (await store.listDir(STYLEGUIDE_DIR)).filter((e) => e.type === 'file' && e.name.endsWith('.md')).map((e) => `code_styleguides/${e.name}`);
    const known = [...CONTEXT_FILES, ...styleEntries];
    const wantFiles = args.files ?? [];
    for (const n of wantFiles) {
      if (!known.includes(n) && !CONTEXT_FILES.includes(n)) {
        throw fail('VALIDATION_FAILED', `Unknown context file ${JSON.stringify(n)}`, { hint: `Call get_context with no arguments for the manifest. Known names: ${known.join(', ')}.` });
      }
    }
    const paths = known.map((n) => `conductor/${n}`);
    const got = await store.readFiles(paths);
    const present = known.filter((n, i) => got.get(paths[i]));

    const data = {};
    if (!args.files && !args.lane) {
      data.manifest = present.map((n) => describeFile(n, got.get(`conductor/${n}`).content, got.get(`conductor/${n}`).sha));
      let transitions = null;
      const wf = (await store.readFiles(['conductor/workflow.json'])).get('conductor/workflow.json');
      if (wf) {
        try {
          const lanes = JSON.parse(wf.content).lanes ?? {};
          transitions = Object.fromEntries(Object.entries(lanes).map(([k, v]) => [k, { on_success: v.on_success ?? null, on_failure: v.on_failure ?? null }]));
        } catch {
          warnings.push('conductor/workflow.json is not valid JSON');
        }
      } else {
        warnings.push('conductor/workflow.json is missing; lane transitions unknown');
      }
      data.workflow_transitions = transitions;
      data.lane_guides = await guideSources(store);
      data.hint = 'Call get_context with `lane` for a lane guide and `files` for any file above in full.';
    }
    if (args.files) {
      let used = 0;
      data.files = [];
      for (const n of wantFiles) {
        const f = got.get(`conductor/${n}`);
        if (!f) {
          warnings.push(`${n} does not exist in this project`);
          data.files.push({ name: n, content: null });
          continue;
        }
        const room = Math.max(0, CONTENT_BUDGET - used);
        const truncated = f.content.length > room;
        const content = truncated ? f.content.slice(0, room) : f.content;
        used += content.length;
        data.files.push({ name: n, content, sha: f.sha, bytes: Buffer.byteLength(f.content), truncated });
        if (truncated) warnings.push(`${n} was truncated to fit the response limit; request it on its own.`);
      }
    }
    if (args.lane) {
      if (!LANES.includes(args.lane)) throw fail('VALIDATION_FAILED', `Unknown lane ${JSON.stringify(args.lane)}`, { hint: `Lanes: ${LANES.join(', ')}.` });
      const g = await loadGuide(store, args.lane, ctx.version);
      const serveId = newServeId();
      const room = Math.max(2000, CONTENT_BUDGET - sizeOf(data.files ?? []) );
      const truncated = g.content.length > room;
      data.lane_guide = {
        lane: args.lane,
        serve_id: serveId,
        source: g.source,
        advice: framing({ serveId, hasOutcomeTool: ctx.hasTool('report_outcome'), lane: args.lane }) + (truncated ? g.content.slice(0, room) : g.content),
        truncated,
      };
      if (truncated) warnings.push('The lane guide was truncated to fit the response limit.');
      ctx.record?.({ kind: 'serve', id: serveId, tool: 'get_context', item: `lane:${args.lane}`, source: g.source, chars: g.content.length });
    }
    if (sizeOf(data) > MAX_TEXT_CHARS - ENVELOPE_RESERVE) warnings.push('Response is close to the size limit; request fewer files.');
    const parts = [];
    if (data.manifest) parts.push(`${data.manifest.length} context file${data.manifest.length === 1 ? '' : 's'}`);
    if (data.files) parts.push(`${data.files.length} file${data.files.length === 1 ? '' : 's'}`);
    if (data.lane_guide) parts.push(`${args.lane} guide (${data.lane_guide.source})`);
    return { data, warnings, summary: `Context: ${parts.join(', ')}.` };
  },
};
