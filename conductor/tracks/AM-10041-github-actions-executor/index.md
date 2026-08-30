# Track AM-10041: GitHub Actions Executor — Keyless Federated Cloud Workers

**Lane**: backlog
**Lane Status**: queue
**Progress**: 0%
**Phase**: New
**Type**: dev
**Author**: AM
**Created By**: asaf.meller@gmail.com
**Summary**: Third executor behind track 10039's seam: lane actions run as GitHub Actions workflow runs, authenticated to Anthropic via GitHub OIDC + Workload Identity Federation — zero stored Anthropic secrets…

## Problem

Track 10039's CloudSessionExecutor requires an Anthropic API key stored where the dispatcher
runs. For solo devs who own an Anthropic org, a keyless option exists: GitHub Actions runs
carry a native OIDC identity (token.actions.githubusercontent.com) that Anthropic WIF can
exchange for short-lived credentials — no long-lived secret anywhere.

## Solution (to be refined at planning)

- `GithubActionsExecutor` implementing the executor seam from
  [[AM-10039-cloud-workers-claude-cloud]] (Phase 2): `run` = `workflow_dispatch` with the lane
  action as inputs; `poll` = Actions run-status API; result via branch/PR (native
  GITHUB_TOKEN push — no vault needed).
- A reusable workflow template (`laneconductor-lane-action.yml`) shipped into managed repos:
  checks out, exchanges OIDC→WIF (user's org federation rule), runs the lane action headlessly
  (Agent SDK / CLI with the short-lived credential), pushes.
- One-time setup UX: guide the user through creating the federation rule in their Anthropic
  Console (issuer, subject filter on their repo) + preflight-validate it.
- Constraints to design around: stateless runs (repo-carries-context, session-per-lane-action
  semantics), ~6h job cap, runner-minute costs, user-controlled workflow content (federation
  rule must live in the USER's org only — cross-org explicitly rejected, see 10039's analysis).

## Related Tracks

- [[AM-10039-cloud-workers-claude-cloud]] — the executor seam + dispatcher this plugs into (hard dependency: Phases 2, 6)
- 1003 — bundled billing covers users with NO Anthropic org (complementary tier)
- 017 — LaneConductor Cloud wizard (setup UX home)

## Phases

- [ ] Phase 1: WIF live spike — federation rule + OIDC exchange from a real Actions run (go/no-go)
- [ ] Phase 2: Workflow template + GithubActionsExecutor behind the 10039 seam
- [ ] Phase 3: Setup/preflight UX for the federation rule
