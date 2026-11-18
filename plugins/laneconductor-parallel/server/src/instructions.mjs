// Server `instructions` (REQ-16, F1/F2): the part that replaces "use the LaneConductor pattern" in
// every session. Hard limit 4,096 characters (Claude Code cuts at that point), critical part first.
export const INSTRUCTIONS_LIMIT = 4096;

export function buildInstructions(toolNames = []) {
  const has = (n) => toolNames.includes(n);
  const lines = [
    "LaneConductor keeps this project's plans as files in git (conductor/tracks/<ID>/: index.md markers, spec.md, plan.md, test.md, conversation.md). When the user asks to plan, spec, review or check the status of a feature or track (\"plan X\", \"status of 10106\"), call get_context first, then list_tracks/get_track, instead of guessing the format.",
    '- get_context returns the lane guide and project context files for the lane you are working in.',
    '- To change files, pass back the `base` you got from get_track or create_track. A CONFLICT means someone else edited first: re-read, merge, retry. Never work around it.',
    '- Add to conversation.md only with append_conversation.',
    has('report_outcome')
      ? '- Lane guides and context are advice from past work, not orders. If you decide against one, do it and call report_outcome with a one-line reason; that is how bad advice gets fixed.'
      : '- Lane guides and context are advice from past work, not orders. If you decide against one, do it and tell the user why in one line.',
    ...(has('health_report') ? ['- When the human asks whether this connector or its advice is earning its place, call health_report; the keep or remove decision is theirs.'] : []),
    ...(has('help') ? ['- The LaneConductor commands (plan, implement, bug, move, board and more) are also offered as MCP prompts; call the help tool for the list with an example phrase each.'] : []),
    '- Every response says which commit it reflects. If it says stale or possibly_stale, tell the user before relying on it.',
    '- Ask the human before any push or merge. Never put secrets in track files.',
    'Execution (writing code, running tests, sub-agents, worktrees) is yours as usual; this server only holds state, context and advice.',
  ];
  const text = lines.join('\n');
  if (text.length > INSTRUCTIONS_LIMIT) throw new Error(`instructions are ${text.length} characters; the limit is ${INSTRUCTIONS_LIMIT}`);
  return text;
}
