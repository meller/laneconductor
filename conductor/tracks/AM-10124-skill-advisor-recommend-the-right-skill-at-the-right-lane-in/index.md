# Track AM-10124: Skill advisor: recommend the right skill at the right lane, install it with consent

**Lane**: plan
**Lane Status**: queue
**Progress**: 15%
**Phase**: Scope refined 2026-11-18 after a registry survey: LaneConductor does NOT build a skill registry (several exist); it keeps a SMALL vetted catalog, recommends by lane AND by the project's stack (conductor/tech-stack.md), and points to a generic finder for anything else. Ready for the owner to confirm, then implement Phases 2 to 5.
**Track Kind**: feature
**Type**: dev
**Merge Mode**: direct
**Auto Run**: no
**Author**: AM
**Depends On**: 10123
**Problem**: Idea (human, 2026-11-18): today Claude is missing something. When a person hits a problem, they have to know which skill to load; Claude sees only the descriptions of skills that are already installed and cannot recommend one that is not. LaneConductor knows the lanes, so it can recommend a skill at the right moment, and with the person's yes install it. LaneConductor is an orchestrator that knows skills; it never wraps or replaces them.

Principles: second opinion, not controller (a recommendation with a reason, never an order); nothing is installed without an explicit yes each time, showing the exact commands first; no silent edits to settings or permissions; the person's own plugin marketplaces and public sources only, never a private name in the shipped catalog; every recommendation says why and where the skill comes from.

Parts to design in the plan lane:
1. A small curated catalog shipped in the plugin (Markdown or JSON, dated): per lane and per problem type (a failing test or a bug, a stuck plan, a review to answer, work that needs a worktree) the skill name, its source (marketplace and plugin, or repository), why it helps, its licence, and the install steps (`claude plugin marketplace add ...`, `claude plugin install ...`, then `/reload-plugins`). Every entry's source is checked to exist before it ships. Start with Superpowers (MIT) and the person's own marketplaces; the lane-to-skill map from track 10123 is the seed.
2. Detecting what is installed: the plugin and skill listings Claude Code and the desktop app already offer (for example `claude plugin list`, the skills list in context). Recommend only what is missing, and never nag twice for one that was declined (remember the answer per project).
3. When to recommend: at the start of a lane, when a lane guide sees a matching situation (a bug track, a failing quality gate, a review comment), and on request (`/laneconductor:skills`, a catalog entry so every client gets it).
4. The install flow: show what will be added and from where, ask, run the person's approved commands (scope local by default), remind to reload, confirm it loaded. Failure is reported, never retried silently.
5. A curated set that comes from the LaneConductor folder: decide whether to BUNDLE a few small skills inside the plugin (our own lane-oriented ones; third-party ones like Superpowers only with the licence and attribution kept, or better not copied at all) or only recommend and install. Leaning: recommend and install, bundle only skills we wrote.
6. Platform check: this desktop app already has plugin and skill search and a suggest-install card, and Claude Code has `/plugin`. The value to add is the lane-aware, curated map, not another installer. Verify what exists before building.
7. Directory and safety: a plugin that can run an install is something the directory's security scan reads. The README must say plainly that it installs only after the person's yes, from the named sources, and what it runs.

Depends on track 10123 (the lane-to-skill map). Not before it. Open questions: catalog format; where the per-project declined list lives (never in git without the person's yes); whether installs should be offered through the platform's own suggest-install card where the client has one.
**Summary**: Idea (human, 2026-11-18): today Claude is missing something. When a person hits a problem, they have to know which skill to load; Claude sees only the descriptions of skills that are already installed
