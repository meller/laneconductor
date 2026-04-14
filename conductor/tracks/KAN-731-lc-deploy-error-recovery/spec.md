# Spec: Track 1065 — lc deploy AI Error Recovery

## Problem Statement

When `lc deploy` fails mid-step (e.g. Docker build error, gcloud auth issue, Firebase deploy fail), the user is dumped back to the CLI with a raw error. There is no guidance on what went wrong or how to fix it. The user has to context-switch to figure out the problem, apply a fix, and manually re-run the deploy.

## Core Concept

On failure, `lc deploy` enters an **interactive recovery loop**:

1. Captures the error output from the failed step
2. Opens a brainstorm loop with the LLM: shows error, asks for diagnosis and fix
3. User can apply fixes, ask follow-up questions, iterate
4. **Verification gate**: before marking the step as recovered, re-run the failed command to confirm it actually passes
5. On verification success, continue with remaining deploy steps
6. On verification failure, stay in the loop

This follows the same interactive pattern as `lc setup-deploy` (CLI handles interaction, LLM advises).

## Requirements

### REQ-1: Capture failure output
- When a deploy step exits non-zero, capture the last N lines of output (stderr + stdout)
- Store in memory for the recovery session (not persisted)
- Show the error context to the user before entering recovery mode

### REQ-2: Recovery brainstorm loop
- Call LLM with: error output + `conductor/deployment-stack.md` context + `conductor/deploy.json` step info
- LLM diagnoses the error and suggests a fix (concrete commands or file changes)
- User can:
  - Apply the suggested fix (run suggested commands)
  - Type follow-up questions or alternative approaches
  - Press Enter to trigger **verification**
  - Type `q` to abort the deploy

### REQ-3: LLM system prompt rules (same pattern as setup-deploy)
- Focus on the specific error — do not suggest unrelated changes
- Provide concrete shell commands the user can copy/paste
- When ready to verify, end with: "✅ Ready to verify. Press Enter to re-run the failed step."
- STOP after that line — no follow-up options

### REQ-4: Verification gate
- Re-run the exact failed step command
- Show output live (stdio: inherit)
- If passes: print `✅ Verification passed. Continuing deploy...` and resume remaining steps
- If fails again: show new error output, re-enter brainstorm loop with updated context
- Max 3 verification attempts before suggesting the user fix manually and aborting

### REQ-5: Context provided to LLM
- Failed step label and command
- Last ~50 lines of captured output (stdout + stderr)
- `conductor/deployment-stack.md` content (if present) — for infra context
- `conductor/deploy.json` environments config
- Previous conversation history (for multi-turn refinement)

### REQ-6: Output capture
- `lc deploy` currently uses `stdio: inherit` (streams live)
- For recovery to work, we need to capture output AND stream it live
- Use a tee approach: stream to terminal + capture in buffer
- Only the last N lines are needed for the error context

## Acceptance Criteria

- [ ] Deploy failure triggers recovery mode automatically (no flag needed)
- [ ] LLM receives error output + deployment context
- [ ] User can iterate in the brainstorm loop before attempting verification
- [ ] Verification re-runs the exact failed command
- [ ] Verification success continues remaining deploy steps
- [ ] Max 3 retries before clean abort with instructions
- [ ] LLM stops after "Ready to verify" — no follow-up options offered
- [ ] Works for both single `command` and `commands` array in deploy.json
