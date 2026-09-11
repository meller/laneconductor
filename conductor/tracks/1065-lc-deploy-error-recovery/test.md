# Tests: Track 1065 — lc deploy AI Error Recovery

## Test Commands

```bash
# This track's own suite (new)
env -u NODE_TEST_CONTEXT node --test conductor/tests/deploy-recovery.test.mjs

# Existing shared-runner suite — must stay green (the worker calls runDeploy too)
env -u NODE_TEST_CONTEXT node --test conductor/tests/deploy-runner.test.mjs

# Syntax check on touched files
node --check conductor/deploy-runner.mjs
node --check conductor/deploy-recovery.mjs
node --check bin/lc.mjs
```

`env -u NODE_TEST_CONTEXT` is required — see `conductor/quality-gate.md`.

Test harness notes: the deploy steps are **real** child processes (shell
one-liners writing to stdout/stderr and exiting with a chosen code) against a
temp `conductor/deploy.json`, following the fixture style of
`deploy-runner.test.mjs`. The LLM and the prompt reader are **fakes** injected
via `callLLM` / `ask`, so no CLI is spawned and no TTY is needed.

## Test Cases

### Phase 1 — Per-step output tail (`runDeploy`)
- [ ] TC-1: A step printing 250 numbered lines then exiting 1 — expected:
      `result.outputTail` contains the last 100 lines, including the final line,
      and does **not** contain line 1.
- [ ] TC-2: A step writing to **stderr** then exiting 1 — expected: the stderr
      text appears in `outputTail` (stdout and stderr are interleaved, not
      stdout-only).
- [ ] TC-3: A step exiting 0 — expected: `result.ok === true` and the return
      shape is unchanged from today (`exitCode`, `logFile`, `url`).
- [ ] TC-4: Live streaming with `echo: true` — a step printing a line, sleeping
      ~300ms, then printing another: expected: the first line is observed on the
      captured stdout stream *before* the process exits (not flushed only at
      step end).
- [ ] TC-5: The existing `deploy-runner.test.mjs` suite passes unchanged —
      expected: same pass count as before this track's changes.

### Phase 2 — `buildDeployRecoveryPrompt`
- [ ] TC-6: Prompt includes the failed step label, the exact command string, and
      the output tail — expected: all three substrings present.
- [ ] TC-7: `deployStackMd` provided — expected: its content appears in the
      prompt.
- [ ] TC-8: `deployStackMd` null/empty (no `conductor/deployment-stack.md`) —
      expected: no throw, and no empty "Deployment Stack" heading left behind.
- [ ] TC-9: `deployEnvConfig` provided — expected: the environment's
      `deploy.json` entry appears in the prompt.
- [ ] TC-10: `history` with two prior turns — expected: both turns appear, in
      order, so a refinement round is multi-turn.
- [ ] TC-11: Rules block — expected: prompt instructs ending with exactly
      `✅ Ready to verify. Press Enter to re-run the failed step.` and contains
      an instruction to stop after that line.

### Phase 2 — `deployRecoveryLoop`
- [ ] TC-12: Fake `ask` returns `''` (Enter) on the first prompt — expected:
      returns `'verify'` after exactly one `callLLM` call.
- [ ] TC-13: Fake `ask` returns `'q'` — expected: returns `'abort'`.
- [ ] TC-14: Fake `ask` returns `'why does auth fail?'` then `''` — expected:
      `callLLM` called twice, the second prompt contains the follow-up text, and
      the loop then returns `'verify'`.
- [ ] TC-15: Fake `ask` returns `'r'` then a question then `''` — expected: `r`
      is treated as "discuss more" and prompts for the question rather than being
      sent verbatim as the refinement.
- [ ] TC-16: The captured output tail is written through the injected `write` —
      expected: the failure header and the tail both reach `write`.

### Phase 3 — Verification gate
- [ ] TC-17: Two-step `commands` array, step 1 passes, step 2 fails once then
      passes (a marker file flips its exit code); hook returns `'verify'` —
      expected: `result.ok === true`, step 2 ran twice, and **step 1 ran exactly
      once** (not re-run).
- [ ] TC-18: Three-step array, step 2 fails then passes on verify — expected:
      step 3 runs afterward and `result.ok === true`.
- [ ] TC-19: Step always fails, hook always returns `'verify'` — expected: the
      hook is called exactly 3 times, the command ran 4 times total (initial plus
      3 verifications), and the result carries `attemptsExhausted: true` with
      `ok: false`.
- [ ] TC-20: Hook returns `'abort'` on the first call — expected: `ok: false`,
      `aborted: true`, the command ran exactly once, and later steps did not run.
- [ ] TC-21: Single `command` string (not an array) that fails then passes on
      verify — expected: `ok: true`, recovers identically to the array shape.
- [ ] TC-22: **No `onStepFailure` passed** (the worker-dispatch path) on a
      failing step — expected: returns immediately with
      `{ ok: false, exitCode, failedStep, logFile, outputTail }`, no hook
      invoked, and `ask` never called (nothing can block).
- [ ] TC-23: Hook throws — expected: `runDeploy` does not leave the log stream
      open or hang; it returns a failure result.

### Phase 4 — CLI integration
- [ ] TC-24: `lc deploy <env> --no-recovery` against a failing step — expected:
      non-zero exit, no prompt, error and log path printed. Run as a real
      subprocess with stdin closed.
- [ ] TC-25: `lc deploy <env>` with stdin **not** a TTY against a failing step —
      expected: non-zero exit, no prompt, and a line stating recovery was
      skipped because the session is non-interactive.
- [ ] TC-26: `lc --help` — expected: the `deploy` entry documents
      `--no-recovery`.

### Manual / real-product check (required before quality-gate)
- [ ] TC-27: With a temp `deploy.json` whose step runs a command that fails for a
      fixable reason, run `lc deploy` in a real terminal: confirm the diagnosis
      renders, fix the cause in a second terminal, press Enter, and record the
      observed `✅ Verification passed` plus continuation to the next step.

## Acceptance Criteria
- [ ] All test cases above pass.
- [ ] `conductor/tests/deploy-runner.test.mjs` shows no new failures versus
      `main` (diff-confirmed, not assumed).
- [ ] No recovery prompt can ever be reached on the worker's dispatch path.
- [ ] TC-27 performed, with the observation recorded in `conversation.md`.
