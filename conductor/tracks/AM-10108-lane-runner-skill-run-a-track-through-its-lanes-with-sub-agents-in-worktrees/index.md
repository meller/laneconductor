# Track AM-10108: Lane runner skill: run a track through its lanes with sub-agents in worktrees

**Lane**: done
**Lane Status**: success
**Progress**: 100%
**Phase**: Closed as superseded: the minimal lane-runner note was folded into the laneconductor skill (ops/working-a-track.md, routed from the index and the 'run track N' trigger) and delivered with track 10109 (merged 260c9c6e). Verified: routing and a simulated plan run read only the index + lane file; the user reports the skill works as usual. Not built: any scheduler/orchestration (withdrawn by decision).
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

## Findings from the first manual run (track 10109, 2026-11-15)

1. **New tracks are untracked, so a fresh worktree cannot see its own folder.** The daemon's "sync files before worktree" commit is a required preflight step: commit the track folder (only) to main locally, then create the worktree. Add it to the skill.
2. **`.gitignore:90` (`.claude/skills/*/`) ignores any new skill directory**, so `.claude/skills/lane-runner/` is untracked and cannot be committed without `-f` or an ignore exception. Decide where the skill ships (un-ignore, or deliver through the connector library).
3. **A multi-line shell chain kept going after a failed `git add`** and created an empty worktree. Deterministic steps need `set -e` scripts (or `lc` subcommands), not prose - this supports open question 2.
4. **Plan docs location.** The daemon landed plan docs on main (via sync commits); a runner writing them inside the worktree puts them on the track branch until merge. Decide which, since the connector design assumes planning docs live on main.

## SCOPE CHANGE (2026-11-15) - supersedes the design above

Decision: be minimal and let Claude do its default thing; its own sub-agent, worktree and orchestration behaviour keeps improving and we must not out-engineer it or limit the work to LaneConductor's machinery. So there is NO scheduler, no sub-agent manager and no lane-by-lane orchestration script. The "lane runner" is now only a ~25-line note (.claude/skills/lane-runner/SKILL.md): what a track is, the index.md markers, and the guardrails that came from real incidents. The daemon-duty parity list, the open design questions above, and the long runner procedure are withdrawn.
New acceptance: a plain "plan/implement/run track N" request, with only that note available, yields correct marker/lane transitions and respects the guardrails on a throwaway track. A guardrail line is added ONLY when an observed run actually breaks it, and removed when a model release makes it unnecessary.

## PRINCIPLE (2026-11-15): LaneConductor is a second opinion, never a controller

LaneConductor advises; Claude may always decide against it. Recipes, lane order, conventions and tool results are phrased as recommendations with their reasoning ("this worked for you because..."), never as orders. Only two things are firm, and neither is LaneConductor outranking Claude: (a) mechanical integrity - file formats and the base-commit check that prevents silent overwrites; (b) the human's authority - ask before merge/push, never handle secrets (Claude may disagree, but says so and asks). When Claude deviates from advice it says why, and that deviation is recorded so the recipe can be improved or pruned; a recipe Claude keeps overriding is a bad recipe.

## Update (2026-11-15): folded into the laneconductor skill

Decision: saying "laneconductor skill" must find everything, so the separate lane-runner note was removed. Its content now lives at `.claude/skills/laneconductor/ops/working-a-track.md` (routed from the index and the "run track N" trigger; delivered with track 10109). No separate skill remains; the second-opinion framing and the incident lessons are unchanged.
