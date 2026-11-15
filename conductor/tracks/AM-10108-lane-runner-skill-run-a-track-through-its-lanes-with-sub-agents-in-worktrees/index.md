# Track AM-10108: Lane runner skill: run a track through its lanes with sub-agents in worktrees

**Lane**: plan
**Lane Status**: queue
**Progress**: 0%
**Phase**: New
**Type**: dev
**Merge Mode**: direct
**Auto Run**: no
**Author**: AM
**Created By**: 2565050+meller@users.noreply.github.com
**Problem**: Turn the v0 draft at .claude/skills/lane-runner/SKILL.md into a tested way to run a track through its lanes (plan, implement, review, quality-gate, done) with Claude sub-agents in an isolated git worktree - the worker/daemon pattern without the daemon. The main Claude session is the scheduler; sub-agents are the workers.

WHY: the daemon/worker layer is being retired (see tracks 10106/10107); sub-agents already do that job. The lane commands in the laneconductor skill already claim the track and move it per workflow.json when they finish, so the daemon only added gating, the worktree, spawning, verification/retry and merge. The runner supplies exactly that and nothing else.

DAEMON DUTIES TO REPLACE: gating (Depends On, Waiting for reply, live-run check, workspace main dirty-checkout guard); worktree .worktrees/N on branch track-N; spawn; session continuity (SendMessage to the same agent for plan -> implement, new agent for review/quality-gate); verify the transition equals workflow.json on_success; retries up to max_retries; parallel_limit / total_parallel_limit; merge on done by Merge Mode (direct or pr); legacy-daemon double-launch guard when Auto Run is yes.

OPEN DESIGN QUESTIONS (verified against current official docs unless noted):
1. Skills support `context: fork` + `agent`, so a lane could be a forked-context skill instead of an Agent-tool spawn - evaluate which is simpler and whether the worktree cwd can be honoured.
2. Move the deterministic steps (preflight, worktree creation, marker checks, transition verification, merge guards) out of prose into scripts or `lc` subcommands; keep the skill to judgement.
3. After compaction only the first 5,000 tokens of an invoked skill are re-attached (25,000 combined): critical rules must be at the top, per-lane detail in files each sub-agent reads fresh.
4. Side effects (worktrees, spawned agents, merge): the docs recommend disable-model-invocation for such skills, but the goal is natural-language "run track N". Decide, and keep merge/push gated on explicit user confirmation either way.
5. Fresh agent for review/quality-gate (independent eyes) vs one continuous session as the daemon did.

ACCEPTANCE: dry run on a THROWAWAY track through every lane to done in a worktree; a parity checklist against the daemon's duties above; failure injection (agent ends mid-work, duplicate run, dirty primary checkout, waiting-for-reply); two tracks in parallel within the limits; a written list of what is not covered. Soft dependency on the skill restructure track, since per-lane files make each sub-agent cheaper.

OUT OF SCOPE: deleting the daemon (parked until the beta earns it); the connector (10106).
**Summary**: Turn the v0 draft at .claude/skills/lane-runner/SKILL.md into a tested way to run a track through its lanes (plan, implement, review, quality-gate, done) with Claude sub-agents in an isolated git worktree - the worker/daemon pattern without the daemon. The main Claude session is the scheduler; sub-agents are the workers.

## Acceptance addition (2026-11-15): beat the baseline

Claude can already orchestrate sub-agents and worktrees unaided; this skill only earns its place where it adds safety or consistency. The dry run must include a BASELINE: the same throwaway track run by plain Claude given only the track files and a one-line request ("run this track through its lanes in a worktree with sub-agents"). Compare guardrail hits (dirty-checkout guard, duplicate-run guard, Waiting-for-reply, no secrets, merge confirmation), correct lane transitions, retries, and token cost. Anything the baseline already does as well gets removed from the skill. Re-run the comparison as models improve.
