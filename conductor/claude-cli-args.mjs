#!/usr/bin/env node
// conductor/claude-cli-args.mjs
// Track 1087 Phase 1: builds the args array for claude spawns, switching to
// stream-json output so the worker can parse structured events (assistant
// text, tool_use, tool_result) as they're written instead of tailing plain
// text every 5s. Extracted from buildCliArgs (laneconductor.sync.mjs) so it's
// unit-testable without spawning a real process.
//
// --verbose is required alongside --print --output-format=stream-json —
// confirmed against the real claude CLI (not in the original plan; it exits
// with "Error: When using --print, --output-format=stream-json requires
// --verbose" otherwise).

export function buildClaudeArgs({ sessionArgs = [], freshnessMarker = '', prompt, model } = {}) {
  const args = [
    '--dangerously-skip-permissions',
    ...sessionArgs,
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--verbose',
    '-p', `${freshnessMarker}${prompt}`,
  ];
  if (model) args.push('--model', model);
  return args;
}
