# Spec: Per-lane model stickiness, correct reset, and auto-update

## Problem Statement

`workflow.json` already supports a different model per lane while
holding the CLI/provider fixed (needed for session continuity —
`--resume` is provider-specific, see
[1086](../1086-persistent-track-sessions/index.md)/[1096](../1096-worker-cli-model-picker/index.md)
Phase 6) — but the field is configured nowhere, verified by inspecting
this project's own `workflow.json`. Three further gaps: the chat dispatch
path ignores per-lane models entirely; the precedence between a lane's
configured model and a human's manual per-worker override
(track 1096's "Change Model") has never been tested; and nothing detects
or updates a `workflow.json` model string once a provider ships a newer
version, despite [1099](../1099-dynamic-worker-model-discovery/index.md)
already knowing what's currently available.

## Requirements

- REQ-1: `workflow.json`'s per-lane `primary_model` must be actually
  populated in every actively-used LaneConductor project, starting with
  this repo's own.
- REQ-2: A worker running an automated lane action MUST use that lane's
  configured model when set, regardless of any manual per-worker model
  override in effect — verified by an automated test, not code reading
  alone.
- REQ-3: The CLI/provider (`primary.cli`) MUST NOT vary per lane —
  only the model does. Automated lane actions never request a provider
  switch mid-track.
- REQ-4: `track_chat`'s model resolution is an explicit, documented
  decision (follow the track's current lane's model, or always use
  project default) — not silent project-default-always behavior left
  unexamined.
- REQ-5: When a `workflow.json` entry's `primary_model` no longer
  appears in that project's most recently discovered `available_models`
  (per [1099](../1099-dynamic-worker-model-discovery/index.md)) for the
  same provider, this is detectable and surfaced — at minimum a
  notification naming the stale lane/model/project.
- REQ-6: Any auto-update of a stale model string preserves the model's
  *tier* (sonnet stays sonnet, opus stays opus) and is reversible/
  opt-out per project — never a silent, un-audited rewrite.

## Acceptance Criteria

- [ ] This project's `conductor/workflow.json` has a real `primary_model`
      set on every lane, and a live dispatch through each lane uses that
      model (observed, not assumed — e.g. via the transcript/log showing
      the actual `--model` flag passed).
- [ ] A test proves REQ-2: a worker with a manual model override active
      (via 1096's `set_model` dispatch) still uses the lane's configured
      model for an automated action, and falls back to the override only
      when the lane has no `primary_model` set.
- [ ] REQ-4's decision is implemented and covered by a test — a
      `track_chat` dispatch demonstrably uses whichever model the
      decision specifies.
- [ ] Given a project whose `workflow.json` names a model not present in
      that worker's latest `available_models` report, the staleness is
      surfaced somewhere a human will actually see it (UI badge, log
      line, or dispatch/notification — decided at planning).
- [ ] If Phase 6 (auto-update) is implemented: a same-tier newer model
      replaces the stale one only for projects that opted in, and the
      change is visible in `workflow.json`'s git history / audit trail,
      not silently applied with no record.

## Non-goals

- Redesigning worker CLI/model selection UI from scratch — builds on
  [1096](../1096-worker-cli-model-picker/index.md)'s existing "Change
  Model" mechanism rather than replacing it.
- Model *discovery* itself — that's
  [1099](../1099-dynamic-worker-model-discovery/index.md) (done); this
  track only consumes its `available_models` data.
- Cross-provider model equivalence mapping (e.g. "what's Gemini's
  equivalent of Claude Opus") — out of scope; auto-update only operates
  within one provider's own model family.
