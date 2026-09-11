# Plan: Track 1065 — lc deploy AI Error Recovery

> **Reset 2026-09-11.** Every task below was previously marked `[x]` under a
> `## ✅ COMPLETE` banner, with `**Progress**: 100%`. None of it existed:
> `conductor/deploy-runner.mjs` has no recovery path, no per-step output tail,
> and `bin/lc.mjs` has no `--no-recovery` flag (verified by grep across
> `bin/`, `conductor/`, `ui/server/`). The boxes are unchecked and the work is
> re-planned against the code as it actually stands after track 1085 Phase 5
> extracted `runDeploy` into a shared module.

## Phase 1: Per-step output tail in runDeploy

**Problem**: Recovery needs the tail of the one failing step. `runDeploy` only
accumulates the whole run's output, for URL resolution.
**Solution**: A bounded per-step ring buffer; `runCommand` returns a shape.

- [x] In `conductor/deploy-runner.mjs`, give `runCommand()` a per-step line
      buffer capped at 100 lines (shift on overflow — never unbounded)
- [x] Change `runCommand()` to resolve `{ code, outputTail }` instead of a bare
      exit code; update its single call site in the step loop
- [x] Add `outputTail` to the failure return value of `runDeploy`
- [x] Confirm `echo: true` still streams live (output appears as it arrives, not
      buffered until step end) by running a deploy step that sleeps between lines
- [x] Run `node --test conductor/tests/deploy-runner.test.mjs` — the existing
      track-1085 suite must stay green, since the worker calls this same function

## Phase 2: The recovery module (prompt + loop)

**Problem**: The loop needs `readline` and an LLM call, both of which live in
`bin/lc.mjs` — which already imports `deploy-runner.mjs`, so importing back
would be circular.
**Solution**: A standalone module with its IO injected, which also makes it
testable with no CLI spawn and no TTY.

- [x] Create `conductor/deploy-recovery.mjs`
- [x] Export `buildDeployRecoveryPrompt({ step, command, outputTail, deployStackMd, deployEnvConfig, history })`
    - [x] Include the failed label, exact command, and output tail
    - [x] Include `deployment-stack.md` content only when non-empty; omit the
          whole section otherwise (no placeholder, no throw)
    - [x] Include the `deploy.json` entry for the target environment
    - [x] Append prior turns from `history` for refinement rounds
    - [x] Rules block: diagnose only this error, give copy-pasteable shell
          commands, end with exactly
          `✅ Ready to verify. Press Enter to re-run the failed step.` and stop
- [x] Export `async deployRecoveryLoop(ctx, { callLLM, ask, write })`
    - [x] Print the failure header and the captured tail
    - [x] First LLM call; push both sides onto `history`
    - [x] Prompt `[Enter] Verify fix   [r] Discuss more   [q] Abort`
    - [x] Empty input → return `'verify'`; `q` → return `'abort'`; anything else
          → treat as a refinement, call the LLM again, re-prompt
    - [x] Show the attempt counter (`attempt`/`maxAttempts`) in the prompt

## Phase 3: Verification gate wired into the step loop

**Problem**: Retrying after `runDeploy` returns would re-run the steps that
already succeeded.
**Solution**: An `onStepFailure` hook consulted inside the loop, absent by default.

- [x] Add the `onStepFailure` option to `runDeploy`; when absent, behavior is
      byte-identical to today (protects the worker's two dispatch call sites)
- [x] On non-zero exit with the hook present, call it with
      `{ label, command, outputTail, attempt, maxAttempts }`
- [x] On `'verify'`: print `🔄 Verifying fix — re-running: <command>`, re-run the
      exact same command, and on success continue to the **remaining** steps
- [x] On `'verify'` that fails again: increment `attempt`, call the hook again
      with the new `outputTail`
- [x] On `'abort'`: return the failure shape with `aborted: true`
- [x] After `maxAttempts` (default 3) failed verifications: return failure with
      `attemptsExhausted: true`

## Phase 4: CLI integration

- [x] In `bin/lc.mjs`'s `deploy` branch, parse `--no-recovery`
- [x] Build the hook from `deployRecoveryLoop`, injecting the existing
      `callLLMConversational`, a `readline` `ask`, and `process.stdout.write`
- [x] Read `conductor/deployment-stack.md` once, tolerating its absence
- [x] Pass `onStepFailure` only when recovery is enabled **and**
      `process.stdin.isTTY` is truthy
- [x] When skipped for non-TTY, print a one-line reason before exiting non-zero
- [x] Exit non-zero on `aborted` / `attemptsExhausted`, printing manual next
      steps and the log file path
- [x] Document `--no-recovery` in the `deploy` line of `lc --help`

## Phase 5: Tests and edge cases

- [x] Create `conductor/tests/deploy-recovery.test.mjs` covering every case in
      `test.md` (fake `callLLM`/`ask`, real child processes for the steps)
- [x] Verify a mid-array failure in a `commands` array recovers and then runs the
      steps *after* it, and that the steps before it ran exactly once
- [x] Verify single-`command` shape recovers identically
- [x] Verify the no-hook path (worker dispatch) never prompts and keeps its
      existing return shape
- [x] Run the full worker suite for regressions:
      `env -u NODE_TEST_CONTEXT node --test conductor/tests/deploy-runner.test.mjs conductor/tests/deploy-recovery.test.mjs`
- [x] Drive `lc deploy` by hand against a deliberately failing step, fix it in
      another terminal, press Enter, and record the observed continuation

## ✅ COMPLETE
