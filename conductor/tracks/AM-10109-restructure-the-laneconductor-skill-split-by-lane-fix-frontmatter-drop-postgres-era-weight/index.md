# Track AM-10109: Restructure the laneconductor skill: split by lane, fix frontmatter, drop Postgres-era weight

**Lane**: plan
**Lane Status**: queue
**Progress**: 90%
**Phase**: Implemented; Phase 5 live verification (daemon suites, claude -p runs, trigger check) still open
**Type**: dev
**Merge Mode**: direct
**Auto Run**: no
**Author**: AM
**Created By**: 2565050+meller@users.noreply.github.com
**Problem**: Restructure the laneconductor skill (.claude/skills/laneconductor/SKILL.md), written long ago, to match current official skill guidance and to stop loading ~32k tokens for every use.

FINDINGS (measured, and checked against https://code.claude.com/docs/en/skills):
- Size: 2,392 lines / 130 KB / ~32k tokens in ONE file, no supporting files. Official guidance: "Keep SKILL.md under 500 lines. Move detailed reference material to separate files."
- Breakdown by purpose: lane commands (plan, brainstorm, implement, review, quality-gate, merge) 22%; setup + scaffold + templates + collection 27%; DB/daemon-era (activate, deactivate, workflow commands, syncdb, remote-sync listed twice, DB schema reference) 13%; templates and notes 11%; deploy 5%; protocols 5%; modes/CLI/architecture 8%; filesystem-as-API, move, pulse, new, lock 8%.
- Compaction: invoked skills are re-attached after compaction keeping only "the first 5,000 tokens of each" within a 25,000-token combined budget. The lane command bodies start at line 1,411, so after a compaction they are dropped - the part that matters most is the part that does not survive.
- Frontmatter: there is NO `parameters` field in the documented list; our ~30-command block is dead weight. The description ("Use this skill when the user invokes /laneconductor commands... live Kanban dashboard backed by local Postgres") fires only on explicit slash commands and sells the retiring architecture. Description plus `when_to_use` is truncated at 1,536 characters; put the key use case first.
- Every sub-agent in the lane runner (track 10108) would load all 32k tokens to use one lane's section.

PLAN: (1) SKILL.md becomes an index of at most ~200 lines: command table, the protocol essentials (conversation.md format, session continuity, locating tracks, lane/workflow rules), pointers. (2) Per-lane files lanes/{plan,brainstorm,implement,review,quality-gate,merge}.md, each self-contained and read fresh by whoever runs that lane. (3) setup/ (scaffold + templates), deploy/, and legacy/ (DB, daemon, syncdb, remote-sync, schema) - kept for the parked legacy system but never loaded by default. (4) Consider two skills: `laneconductor` (track + lane commands, model-invocable) and `laneconductor-setup` (setup, scaffold, deploy: side effects, so disable-model-invocation). (5) Rewrite description + when_to_use with natural triggers ("plan this", "run track N", "create a track"); drop `parameters`. (6) Delete the duplicate remote-sync section.

RISKS: the skill is symlinked into every project, so a change propagates everywhere. The daemon's prompts call `/laneconductor <lane> <n>`, so command names and the lane/marker semantics must not change; audit conductor/tests for anything that reads SKILL.md text. Do the work on a branch; verify with the existing mock-cli test suites and one real lane run before merging.

ACCEPTANCE: SKILL.md under 500 lines (target 200 or less); each lane file self-contained; a per-lane run loads a small fraction of today's 32k tokens; description triggers on natural phrasing (spot-check); behaviour unchanged for the daemon path (tests green); the lane files can later be served on demand by the connector (10106).
**Summary**: Restructure the laneconductor skill (.claude/skills/laneconductor/SKILL.md), written long ago, to match current official skill guidance and to stop loading ~32k tokens for every use.

## Pruning rule (2026-11-15)

Every line kept in the restructured skill and its lane files must carry either a project-specific fact or a lesson from a real incident. Generic instructions Claude follows well unaided are deleted, not moved. Re-check this as models improve; the skill should shrink over time, not grow.

## PRINCIPLE (2026-11-15): LaneConductor is a second opinion, never a controller

LaneConductor advises; Claude may always decide against it. Recipes, lane order, conventions and tool results are phrased as recommendations with their reasoning ("this worked for you because..."), never as orders. Only two things are firm, and neither is LaneConductor outranking Claude: (a) mechanical integrity - file formats and the base-commit check that prevents silent overwrites; (b) the human's authority - ask before merge/push, never handle secrets (Claude may disagree, but says so and asks). When Claude deviates from advice it says why, and that deviation is recorded so the recipe can be improved or pruned; a recipe Claude keeps overriding is a bad recipe.
