# Spec: Track 1065 — lc deploy AI Error Recovery

## Problem Statement

When `lc deploy` fails mid-step (Docker build error, gcloud auth issue, Firebase
deploy fail), the user is dumped back to the CLI with a raw error. There is no
guidance on what went wrong or how to fix it. The user has to context-switch to
diagnose the problem, apply a fix, and manually re-run the whole deploy from the
first step — even when only the last step failed.

## Current State (verified 2026-09-11, not assumed)

`lc deploy` (`bin/lc.mjs`, the `command === 'deploy'` branch) delegates to
`runDeploy()` in `conductor/deploy-runner.mjs`. On a non-zero step it returns
`{ ok: false, exitCode, failedStep, logFile }`; the CLI prints the error and
`process.exit`s. There is no recovery path anywhere: no `deployRecoveryLoop`,
no `buildDeployRecoveryPrompt`, no `--no-recovery` flag, no per-step output tail.

Two things about today's code shape drive the design below:

1. **Output is already captured, but at the wrong granularity.** `runDeploy`
   accumulates the *whole run* into `capturedOutput` for
   `resolveDeployedUrl()` (track AM-1119). Recovery needs the tail of the
   **one failing step**, so a per-step buffer is still needed. The
   tee-vs-`stdio: inherit` problem the original spec described (REQ-6) no
   longer exists — `runDeploy` already pipes and re-emits when `echo: true`.
2. **`runDeploy` is shared, and one of its two callers has no human.**
   Track 1085 Phase 5 extracted it so `lc deploy` *and* the worker's
   dispatch handler (`conductor/laneconductor.sync.mjs`, two call sites) run
   identical code. The worker path passes `echo: false` and
   `stdio[0]: 'ignore'` precisely so nothing can block on input. An
   interactive brainstorm loop reached from inside `runDeploy`
   unconditionally would hang a dispatched deploy worker forever. Recovery
   must therefore be **opt-in by the caller**, not triggered by failure alone.

## Core Concept

On failure of an *interactive* `lc deploy`, enter a recovery loop:

1. Capture the failed step's output tail (last 100 lines of interleaved
   stdout+stderr).
2. Ask the LLM to diagnose and propose a concrete fix.
3. The user iterates — follow-up questions, alternative approaches — applying
   fixes in another terminal.
4. **Verification gate**: re-run the exact failed command. The fix is not
   believed until the command that failed actually passes.
5. On verification success, continue with the *remaining* steps — the earlier
   successful steps are not re-run.
6. On verification failure, re-enter the loop with the new error appended.
7. After 3 failed verification attempts, abort cleanly with manual instructions.

## Requirements

### REQ-1: Per-step failure output capture
- `runCommand()` inside `runDeploy` returns `{ code, outputTail }` instead of a
  bare exit code. `outputTail` is the last 100 lines of that step's interleaved
  stdout+stderr, held in a bounded ring buffer (memory only, never persisted
  beyond the existing deploy log file).
- `runDeploy`'s failure return value gains `outputTail`, so even the
  non-interactive worker path can surface the error tail rather than only a
  log-file path.
- Live streaming behavior for `echo: true` is unchanged — output still appears
  as it arrives, not at step end.

### REQ-2: Recovery is caller-opt-in, never implicit
- `runDeploy` accepts a new option `onStepFailure` — an async callback
  `({ label, command, outputTail, attempt, maxAttempts }) => 'verify' | 'abort'`.
- When `onStepFailure` is absent (the worker's two dispatch call sites, and
  every existing test), `runDeploy` behaves **exactly** as it does today. This
  is the compatibility guarantee that keeps a dispatched deploy from ever
  blocking on a prompt.
- `bin/lc.mjs`'s `deploy` command supplies the callback, so from the user's
  point of view recovery still needs no flag (satisfying the original intent).

### REQ-3: Retry happens inside the step loop
- On `'verify'`, `runDeploy` re-runs the **exact same command** for the failed
  step and, on success, continues to the *remaining* steps in the same run.
  Recovery cannot be implemented after `runDeploy` returns without re-running
  the already-successful steps.
- On `'abort'`, `runDeploy` returns the existing failure shape, with
  `aborted: true` added.
- Max 3 verification attempts per step (`maxAttempts`, default 3). On
  exhaustion `runDeploy` returns failure with `attemptsExhausted: true`.

### REQ-4: The loop itself lives in its own module
- New `conductor/deploy-recovery.mjs` exports:
  - `buildDeployRecoveryPrompt({ step, command, outputTail, deployStackMd, deployEnvConfig, history })`
    → prompt string.
  - `deployRecoveryLoop(ctx, { callLLM, ask, write })` → `'verify' | 'abort'`.
- `callLLM`, `ask` and `write` are **injected**, not imported. `deploy-runner.mjs`
  must stay dependency-free of `bin/lc.mjs` (which already imports it —
  importing back would be circular), and injection is what makes the loop
  unit-testable without spawning a real CLI or owning a TTY.
- `bin/lc.mjs` wires in its existing `callLLMConversational` and a `readline`
  `ask`.

### REQ-5: Context provided to the LLM
- Failed step label and exact command.
- The step's `outputTail`.
- `conductor/deployment-stack.md` content when present; omitted entirely when
  absent (no placeholder text, no error).
- The `deploy.json` entry for the environment being deployed.
- Full prior conversation history for multi-turn refinement rounds.

### REQ-6: LLM prompt rules
- Diagnose *this* error; do not propose unrelated refactors or changes.
- Give concrete copy-pasteable shell commands.
- End with exactly `✅ Ready to verify. Press Enter to re-run the failed step.`
  and stop there — no menu of follow-up options (the CLI owns the menu).

### REQ-7: Non-interactive safety
- `lc deploy --no-recovery` skips the loop and exits non-zero immediately, for
  CI and scripted use.
- Recovery is also skipped when `process.stdin.isTTY` is falsy, so
  `lc deploy` inside a pipeline or cron job fails fast instead of blocking on a
  prompt nobody can answer. A one-line notice says why it was skipped.

### REQ-8: Both `command` and `commands` shapes
- Works for a single `command` string and a `commands` array, unchanged from how
  `runDeploy` already normalizes them. A mid-array failure recovers and then
  continues with the steps after it.

## Acceptance Criteria

- [ ] An interactive `lc deploy` whose step fails shows the error tail and an AI
      diagnosis, without the user passing any flag.
- [ ] The user can ask follow-up questions and get further responses before
      verifying.
- [ ] Pressing Enter re-runs the exact failed command and the user sees its
      output live.
- [ ] A verification that passes continues the deploy from the *next* step; the
      already-successful earlier steps do not re-run.
- [ ] A verification that fails returns the user to the loop with the new error
      in context.
- [ ] After 3 failed verifications the command aborts with a non-zero exit and
      prints manual next steps.
- [ ] `q` at the loop prompt aborts with a non-zero exit.
- [ ] `lc deploy --no-recovery` on a failing step exits non-zero with no prompt.
- [ ] `lc deploy` with stdin not a TTY exits non-zero with no prompt, and says
      recovery was skipped.
- [ ] A worker-dispatched deploy (no `onStepFailure`) behaves exactly as before —
      no prompt, no hang, same return shape plus `outputTail`.
- [ ] A missing `conductor/deployment-stack.md` omits that section from the
      prompt and does not throw.
