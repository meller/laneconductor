// conductor/services/slash-commands.mjs
// Track 10080 (REQ-13): the `/laneconductor` command surface as plain data,
// so the Chat composer's slash-command menu (ui/src/lib/useComposerAutocomplete.js)
// cannot drift from a hand-maintained copy inside a component. Sourced from
// the laneconductor skill's own Core Commands / Quick Reference sections
// (.claude/skills/laneconductor/SKILL.md) — kept here rather than parsed
// out of the skill file at runtime because the skill's markdown is prose,
// not a stable data format.

export const SLASH_COMMANDS = [
  { name: 'plan', args: '[track-number]', description: 'Scaffold or refine the planning phase of a track (spec.md, plan.md, test.md).' },
  { name: 'brainstorm', args: '[track-number]', description: 'Deepen requirements via Q&A dialogue before implementing.' },
  { name: 'implement', args: '[track-number]', description: 'Execute the track\'s plan.md, phase by phase.' },
  { name: 'review', args: '[track-number]', description: 'Review a track against its plan and product guidelines, then auto-transition its lane.' },
  { name: 'qualityGate', args: '[track-number]', description: 'Run automated quality checks and (on pass) queue the track for merge.' },
  { name: 'merge', args: '[track-number]', description: 'Done-lane merge action: direct merge to main or open a PR, in the primary checkout.' },
  { name: 'move', args: '[track-number] [lane:status]', description: 'Move a track to a different lane and status.' },
  { name: 'pulse', args: '[track-number] [status] [progress%] [summary?]', description: 'Update a track\'s status, progress and summary.' },
  { name: 'comment', args: '[track-number] [body]', description: 'Post a comment on a track\'s conversation.' },
  { name: 'newTrack', args: '[name] [description]', description: 'Create a new track and queue it for the worker to register.' },
  { name: 'updateTrack', args: '[track-number] [what]', description: 'Add work/bug/feature detail to an existing track and move it back to backlog.' },
  { name: 'reportaBug', args: '[description]', description: 'Smart bug intake — updates an existing track or creates a new bug track.' },
  { name: 'featureRequest', args: '[description]', description: 'Smart feature intake — updates an existing track or creates a new feature track.' },
  { name: 'revert', args: '[track-number] [phase] [task?]', description: 'Safe undo at track/phase/task level, with DB sync.' },
  { name: 'delete', args: '[track-number]', description: 'Hard-delete a track: removes its folder, DB row and any git lock.' },
  { name: 'status', args: '', description: 'Show a Kanban board of tracks in the terminal.' },
  { name: 'workflow', args: '', description: 'Display the current lane automation config.' },
  { name: 'workflow set', args: '[lane] [key] [value]', description: 'Edit a single field in conductor/workflow.json.' },
  { name: 'start', args: '', description: 'Start the heartbeat worker.' },
  { name: 'stop', args: '', description: 'Stop the heartbeat worker.' },
  { name: 'setup', args: '', description: 'Initialize LaneConductor in the current project.' },
  { name: 'setup-deploy', args: '', description: 'AI-guided deployment setup — writes deployment-stack.md and deploy.json.' },
  { name: 'deploy', args: '[env]', description: 'Execute the deployment command for the given environment.' },
  { name: 'remote-sync', args: '[track-number?]', description: 'Sync track changes from the Collector API back to local files.' },
  { name: 'init-tracks-summary', args: '', description: 'Regenerate conductor/tracks.md from all track files.' },
];

/** The text inserted into the composer when a slash command is accepted. */
export function commandInsertText(cmd) {
  return `/laneconductor ${cmd.name} `;
}
