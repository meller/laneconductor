# Plan: Track 1065 — lc deploy AI Error Recovery

## Phase 1: Output capture with live streaming

- [ ] Replace `stdio: inherit` with a tee approach in the deploy step runner
    - [ ] Pipe stdout/stderr through a PassThrough stream that both writes to terminal and buffers last 100 lines
    - [ ] Keep `runCommand()` signature compatible — returns `{ code, outputTail }` instead of just `code`
    - [ ] Test that live streaming still works (output appears as it comes)

## Phase 2: Recovery brainstorm loop

- [ ] On non-zero exit from a step, enter `deployRecoveryLoop(cfg, step, outputTail, history)`
    - [ ] Print captured error tail: `\n❌ Step failed: [label]\n\n[last 50 lines]\n`
    - [ ] Build `callLLMConversational` prompt with: error output + deployment-stack.md + step context
    - [ ] Stream LLM response to terminal
    - [ ] Prompt: `[Enter] Verify fix   [r] Discuss more   [q] Abort`
    - [ ] Loop: collect user input, add to history, call LLM again if refining
    - [ ] On Enter: return `'verify'`; on `q`: return `'abort'`

## Phase 3: Verification gate

- [ ] After brainstorm loop returns `'verify'`, re-run the exact failed command
    - [ ] Show: `\n🔄 Verifying fix — re-running: [command]\n`
    - [ ] If passes: print `✅ Verification passed. Continuing deploy...` and resume next steps
    - [ ] If fails: capture new `outputTail`, re-enter brainstorm loop with updated history
    - [ ] Track attempt count — after 3 failures print manual instructions and `process.exit(1)`

## Phase 4: LLM system prompt

- [ ] Write `buildDeployRecoveryPrompt(step, outputTail, deployStackMd, history)`
    - [ ] System context: failed step, command, error output, deployment-stack.md, deploy.json env config
    - [ ] Rules: diagnose the specific error, give concrete shell commands, stop after "Ready to verify"
    - [ ] Multi-turn: include full conversation history for refinement rounds

## Phase 5: Integration + edge cases

- [ ] Works for both `command` string and `commands` array in deploy.json
- [ ] Skips recovery if `--no-recovery` flag passed (for CI use)
- [ ] `lc deploy --no-recovery` exits immediately on failure with non-zero code
- [ ] Graceful handling if deployment-stack.md doesn't exist (omit from LLM context)
