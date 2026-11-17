import { z } from 'zod';
import { readLog } from '../advice-log.mjs';
import { fail } from '../errors.mjs';
import { projectField } from './common.mjs';

const MAX_REASON = 500;

const input = z.object({
  project: projectField,
  serve_id: z.string().min(1).describe('The serve_id of the lane guide or context you were given.'),
  outcome: z.enum(['followed', 'deviated', 'failed']).describe('followed: you used the advice. deviated: you chose differently. failed: you followed it and it did not work.'),
  reason: z.string().optional().describe('One line. Required unless followed: why you deviated, or what failed.'),
  track: z.union([z.string(), z.number()]).transform(String).optional().describe('Track number the work was about, e.g. 10110.'),
});

export const reportOutcome = {
  name: 'report_outcome',
  title: 'Report what happened to a piece of advice',
  description: 'Record whether you followed, deviated from, or failed with a lane guide or context you got from get_context (by its serve_id). Deviating is fine; the one-line reason is how bad advice gets fixed. Appends one line to the advice log; it does not change track files.',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  input,
  async run({ store, ctx, args }) {
    const reason = args.reason?.replace(/\s+/g, ' ').trim();
    if (args.outcome !== 'followed' && !reason) throw fail('VALIDATION_FAILED', `A reason is required when the outcome is ${args.outcome}`, { hint: 'Give one line: why you deviated, or what failed.' });
    if (reason && reason.length > MAX_REASON) throw fail('VALIDATION_FAILED', `reason is ${reason.length} characters; the limit is ${MAX_REASON}`, { hint: 'Shorten it to one line.' });
    if (args.track !== undefined && !/^(?:[A-Za-z]+-)?\d+$/.test(args.track)) throw fail('VALIDATION_FAILED', 'track must be a track number such as 10110 or AM-10110');
    const known = (await readLog(store)).lines.some((l) => l.kind === 'serve' && l.id === args.serve_id);
    ctx.record({ kind: 'outcome', serve_id: args.serve_id, outcome: args.outcome, ...(reason ? { reason } : {}), ...(args.track ? { track: args.track } : {}), ...(known ? {} : { orphan: true }) });
    return {
      data: { recorded: true, ...(known ? {} : { orphan: true }) },
      warnings: known ? [] : [`serve_id ${args.serve_id} is not in the advice log; the outcome was recorded anyway, marked as an orphan.`],
      summary: `Recorded: ${args.outcome}.`,
    };
  },
};
