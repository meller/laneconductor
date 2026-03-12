# Spec: Track 1061: CLI gaps with worker

## Problem Statement
The `lc` CLI currently only transitions tracks by updating their `index.md` files (setting lane and status to `queue`). It relies on a background heartbeat worker to notice these changes and execute the corresponding AI agent (e.g., Claude or Gemini). For users who don't want to run a background worker, or who are using LLMs that don't have seamless "skill" integration, there's no way to trigger the work directly from the CLI.

## Requirements
- REQ-1: Support `--run` (or `-r`) flag for `lc` commands: `plan`, `implement`, `review`, `quality-gate`, and `rerun`.
- REQ-2: (Optional) Support `--run` for `move` to immediately execute the target lane action.
- REQ-3: When `--run` is used, the CLI should immediately transition the track to `running` and spawn the appropriate AI agent.
- REQ-4: The CLI should use the project's primary agent configuration (from `.laneconductor.json`).
- REQ-5: Support execution in the foreground (showing output) or background (defaulting to foreground for CLI feedback).
- REQ-6: Handle git locking (if configured) similar to the heartbeat worker to avoid conflicts.
- REQ-7: Update the track's lane status to `success` or `failure` upon completion.

## Acceptance Criteria
- [ ] Running `lc plan 1061 --run` starts the planning phase immediately.
- [ ] Output from the AI agent is visible in the terminal (for foreground mode).
- [ ] Track status in the DB (for `local-api`) and file (`index.md`) is updated to `running` while active.
- [ ] Final status is updated to `success` or `failure` based on the agent's exit code.
- [ ] Works correctly in both `local-fs` and `local-api` modes.

