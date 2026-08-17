# Tests: Track 1077 — Migrate Gemini CLI support to Antigravity

## Test Commands

```bash
# Syntax check
node --check bin/lc.mjs

# Confirm agy binary is reachable on this machine (sanity check, not part of the fix)
agy --version

# Confirm SKILL.md still parses as valid markdown structure (no broken tables)
grep -A3 "| Agent  | Check command" .claude/skills/laneconductor/SKILL.md
```

## Test Cases

### Feature: Setup wizard deprecation signal (bin/lc.mjs)
- [x] TC-1: Primary agent menu text includes `gemini (retired` — expected: label present in the prompt string.
- [x] TC-2: Selecting `gemini` (choice `3`) as primary prints a warning mentioning "retired" and "antigravity" — expected: warning line present in stdout, wizard does not abort or re-prompt.
- [x] TC-3: Selecting `antigravity`/`agy` (choice `2`) as primary prints no deprecation warning — expected: unchanged behavior from before this track.
- [x] TC-4: Selecting `claude` (choice `1`) as primary still defaults the secondary-agent suggestion to antigravity (choice `2`) — expected: `secAgentChoice === '2'` when `primaryCli === 'claude'`.
- [x] TC-5: Selecting `gemini` as secondary agent also prints the retirement warning (mirrors TC-2 for the secondary path).

### Feature: SKILL.md documentation sync
- [x] TC-6: Reachability-check table under `/laneconductor setup collection` step 4 includes an `agy`/antigravity row with check command `agy --version`.
- [x] TC-7: Model-discovery table includes an `agy` row (falls back to asking the user for a model name, no invented discovery command).
- [x] TC-8: The agent-choice summary line documents 4 options (claude / antigravity (agy) / gemini (retired) / other), matching `bin/lc.mjs`'s real menu.

### Feature: Backward compatibility
- [x] TC-9: A project with `.laneconductor.json` containing `"primary": { "cli": "gemini" }` still runs an AI-agent-driven command (e.g. `runAIAgent`/`callLLMConversational` path, or `lc start`) without throwing — expected: no runtime dispatch code was removed or altered, only setup-time UX/docs. Verified live against track 10014 (dispatch exited 0, advanced lanes).

## Acceptance Criteria
- [x] All test cases above pass.
- [x] `node --check bin/lc.mjs` passes (no syntax errors introduced).
- [x] No existing test suite regressions (`npm test` if applicable to touched files) — full worker/server/frontend/E2E suites run; all failures confirmed pre-existing (see quality-gate comment in conversation.md, 2026-08-17).
- [x] `SKILL.md` changes reviewed for accuracy against `bin/lc.mjs`'s actual current menu/logic (not aspirational).
