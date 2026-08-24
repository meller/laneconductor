#!/usr/bin/env node
// conductor/tests/fake-claude-recorder.mjs
// Substitute `claude` binary for track-1111-model-precedence.test.mjs.
//
// Why not LC_MOCK_CLI (mock-cli.mjs): buildCliArgs returns early for
// LC_MOCK_CLI BEFORE resolving laneConfig.primary_model / proj.primary.model
// at all — it hardcodes model='default' unconditionally. That path is fine
// for lane-transition tests (local-fs-e2e.test.mjs) but structurally cannot
// observe which --model flag a real claude-shaped invocation would receive.
// This binary instead sits where the REAL `claude` executable would, so the
// worker's actual chosenCli==='claude' branch (buildClaudeArgs, --model
// included) runs for real and reaches this recorder.
//
// Several call shapes hit this binary once it's on PATH — not just the one
// this test cares about:
//   1. checkClaudeCapacity's probe: `claude -p test`.
//   2. 1099's model-discovery calls: `claude models list [--json]`.
//   3. A real lane/chat dispatch: buildClaudeArgs' full argv, identified by
//      the `--output-format` flag that ONLY that call shape sets — this is
//      the one shape recorded to FAKE_CLAUDE_RECORD_FILE (one JSON line per
//      invocation). Everything else just exits 0 without recording, so
//      startup-time discovery/probe traffic can't inflate the dispatch
//      count a test is asserting on.

import { appendFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const isDispatch = argv.includes('--output-format');

if (!isDispatch) {
  console.log('ok');
  process.exit(0);
}

const modelIdx = argv.indexOf('--model');
const model = modelIdx !== -1 ? argv[modelIdx + 1] : null;

const recordFile = process.env.FAKE_CLAUDE_RECORD_FILE;
if (recordFile) {
  appendFileSync(recordFile, JSON.stringify({ model, argv }) + '\n');
}

// Plain text is fine — parseNewJsonlLines skips lines it can't parse as
// JSON, and spawnCli determines success purely from exit code.
console.log('fake claude dispatch complete');
process.exit(0);
