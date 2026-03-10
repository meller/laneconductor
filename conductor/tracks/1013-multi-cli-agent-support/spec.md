# Spec: Multi-CLI Agent Support (Gemini, Codex, Amp)

## Problem Statement
The Sync Worker already has partial multi-CLI support — `buildCliArgs()` handles `claude` and `gemini` explicitly, and `spawnCli()` manages process lifecycle. However:

1. **Codex and Amp fall through to an untested generic path** — no verified invocation format
2. **Skill path is hardcoded**: `const skillPath = '/home/meller/Code/laneconductor/.claude/skills/...'` — breaks on any other machine
3. **Exhaustion detection** only fires for `claude` and `gemini` patterns; Codex/Amp errors are silently swallowed
4. **`setup collection`** model discovery uses `npx @google/gemini-cli` but has no counterpart for Codex or Amp
5. **Context injection** (how the skill definition is passed to the agent) is Claude-specific — other CLIs need equivalent context delivery

## What Already Works (Do Not Break)
- `claude` invocation: `claude --dangerously-skip-permissions -p {prompt} --model {model}`
- `gemini` invocation: `npx @google/gemini-cli --approval-mode yolo -p {context}{prompt} --model {model}`
- Provider exhaustion detection for both Claude and Gemini
- Per-lane `primary_cli` / `primary_model` override from `workflow.md` (via `laneConfig`)
- Fallback from primary to secondary when primary is exhausted

## CLI Invocation Formats

### Codex (OpenAI Codex CLI)
```bash
codex --approval-mode full-auto --model {model} "{context}{prompt}"
```
- CLI command: `codex`
- Context injection: prepend to the prompt string (same as Gemini)
- Auto-approval flag: `--approval-mode full-auto`
- Model flag: `--model {model}`
- Reachability check: `codex --version`

### Amp (Sourcegraph Amp CLI)
```bash
amp run --yes --model {model} "{context}{prompt}"
```
- CLI command: `amp`
- Context injection: prepend to the prompt string
- Auto-approval flag: `--yes`
- Model flag: `--model {model}`
- Reachability check: `amp --version`

> Note: Amp and Codex invocation formats must be verified against actual CLI docs/behavior during implementation. The formats above are best-effort based on available information and should be updated if wrong.

## Skill Path Resolution (Bug Fix)

**Current (broken on other machines):**
```js
const skillPath = `/home/meller/Code/laneconductor/.claude/skills/${skill}/SKILL.md`;
```

**Fixed:**
```js
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import os from 'os';

function resolveSkillPath(skill) {
  const rcPath = join(os.homedir(), '.laneconductorrc');
  const skillBase = existsSync(rcPath)
    ? readFileSync(rcPath, 'utf8').trim()
    : join(os.homedir(), 'Code', 'laneconductor', '.claude', 'skills');
  return join(skillBase, skill, 'SKILL.md');
}
```

`~/.laneconductorrc` already stores the install path (written by `make install`). Use it.

## Exhaustion Detection

### Codex error patterns to detect
- `"rate_limit_exceeded"` in stderr/stdout JSON
- `"You exceeded your current quota"` string
- HTTP 429 in output

### Amp error patterns to detect
- `"rate limit"` (case-insensitive)
- `"quota exceeded"` (case-insensitive)

Both should call `detectExhaustion(output, 'codex')` / `detectExhaustion(output, 'amp')` and POST to `/provider-status` with `provider: 'codex'` or `provider: 'amp'`.

## Setup Collection — Model Discovery

| CLI | Discovery command | Parse strategy |
|-----|------------------|----------------|
| codex | `codex models` or `codex --list-models` | newline-separated IDs |
| amp | `amp models list` | parse model names from output |

If discovery fails: fall back to free-text entry ("Model name:").

## Context Injection per CLI

Each CLI needs the skill context delivered differently:

| CLI | Context injection |
|-----|------------------|
| claude | Prompt only — Claude loads skills from `.claude/skills/` automatically |
| gemini | Prepend: `"Use the /{skill} skill. Skill definition is at: {skillPath}. "` |
| codex | Prepend: `"You are using the LaneConductor skill. Read {skillPath} first, then: "` |
| amp | Prepend: `"You are using the LaneConductor skill. Read {skillPath} first, then: "` |

## Requirements
- REQ-1: Codex CLI is invocable via `buildCliArgs` when `primary_cli = 'codex'`
- REQ-2: Amp CLI is invocable via `buildCliArgs` when `primary_cli = 'amp'`
- REQ-3: Skill path is resolved dynamically from `~/.laneconductorrc`, not hardcoded
- REQ-4: Exhaustion detection fires for Codex and Amp stderr patterns
- REQ-5: `setup collection` can discover and configure Codex + Amp models
- REQ-6: No regression for `claude` and `gemini` (existing tests / behavior unchanged)
- REQ-7: Per-lane override (track 1008) continues to work for all 4 CLIs

## Acceptance Criteria
- [ ] Setting `primary.cli = "codex"` in `.laneconductor.json` causes the sync worker to spawn `codex` when auto-actioning tracks
- [ ] Setting `primary.cli = "amp"` similarly spawns `amp`
- [ ] Skill path in log output matches actual file location on any machine (not `/home/meller/...`)
- [ ] Codex quota errors are logged as `[exhaustion] Codex exhausted` and posted to `/provider-status`
- [ ] Amp rate limit errors are logged and posted similarly
- [ ] `setup collection` presents discovered Codex/Amp models instead of requiring manual entry
- [ ] A project with `claude` primary + `gemini` secondary continues to work unchanged
