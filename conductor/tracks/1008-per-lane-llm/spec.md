# Spec: per lane llm

## Problem Statement
The current global LLM configuration is too rigid. We want to be able to use different LLMs (e.g., GPT-4o for complex coding, but Llama 3 for simple status updates) depending on the development lane.

## Requirements
- **REQ-1**: `workflow.md` should support optional `primary` and `secondary` configuration for each lane.
- **REQ-2**: The `laneconductor.sync.mjs` worker must prioritize lane-level LLM overrides over project-level defaults.
- **REQ-3**: Fallback logic should still apply (if primary fails, try secondary).
- **REQ-4**: If a lane doesn't specify an override, it should continue to use the project-level defaults from `.laneconductor.json`.

## Acceptance Criteria
- [ ] A track in the `in-progress` lane can be configured to use a specific model, while other lanes use the default.
- [ ] The heartbeat worker correctly picks up the override from `workflow.md`.
- [ ] No regression for projects without per-lane configuration.

## API / Data Models
`workflow.md` should look like this:
```json
{
  "lanes": {
    "in-progress": {
      "primary": { "cli": "gemini", "model": "pro" },
      "secondary": { "cli": "claude", "model": "haiku" }
    }
  }
}
```
