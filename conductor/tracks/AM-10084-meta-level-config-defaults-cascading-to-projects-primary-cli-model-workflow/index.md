# Track AM-10084: Meta-level config defaults cascading to projects (primary CLI/model, workflow)

**Lane**: review
**Lane Status**: queue
**Progress**: 100%
**Last Run**: claude/claude-sonnet-5 (primary)
**Phase**: New
**Type**: dev
**Track Kind**: feature
**Merge Mode**: direct
**Auto Run**: yes
**Author**: AM
**Created By**: 2565050+meller@users.noreply.github.com
**Problem**: Setup gaps flagged livingwork's primary CLI as unconfigured/unreachable even though .laneconductor.json and the DB both correctly have primary.cli='claude' (verified) — root cause: livingwork has never had its own dedicated LaneConductor worker process (lc worker start was never run for it; all its actual plan/implement work has run as the manager's own ad-hoc subagent Task calls cd'd into its directory), so no provider_status row for its project_id has ever been reported, and computeSetupGaps (conductor/services/setup-gaps.mjs) has no way to distinguish 'never verified because no worker has ever run' from 'genuinely broken.' Underlying feature request from this: today every setting (primary.cli/model, workflow.json's lanes/parallel_limit/quality-gate config) is defined strictly per-project with no shared default — every new project must independently configure and verify everything from scratch, even ones like livingwork that are effectively always driven by the manager itself rather than having their own standing worker. Requested: a meta-level defaults mechanism — the meta project (conductor/services/meta-project.mjs) or a similar shared config source defines defaults for primary.cli/model and workflow.json-shaped settings, individual projects override only what they need to differ, and computeSetupGaps' primary-CLI check (and the analogous provider-reachability check) resolves against the effective (cascaded) value rather than requiring every project to have its own independently-verified copy. Open design questions for planning: what the meta config source actually is (the meta project's own .laneconductor.json vs a new dedicated file), the exact precedence/override rules, how a project explicitly opts out of the meta default vs silently inheriting it, and whether/how the 'no live worker for this project' style gaps should also account for a project intentionally having no worker of its own because the manager drives it directly.
**Waiting for reply**: no
