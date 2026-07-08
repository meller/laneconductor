# Spec: Track 1070 — DEV.to Article

## Problem Statement
Social posts disappear in 24h. DEV.to articles are indexed by Google and surface to developers for months. The core story (context loss between Claude and Gemini, Kanban as LLM context structure) hasn't been told with technical depth yet — no post has shown the actual file contents, the handoff mechanism, or the implementation detail that developers need to actually evaluate the project.

## Target Audience
- Developers actively using Claude Code or Gemini CLI for real projects
- People frustrated by context loss, agent restarts, re-explaining requirements
- Developers curious about multi-agent patterns (conductor pattern)

## What to Avoid
- Repeating the LinkedIn/Reddit posts verbatim
- Surface-level "I built a thing" without showing the thing
- Long intros — DEV.to readers scroll fast

## Requirements
- REQ-1: Opens with the concrete pain (re-explaining decisions to a fresh agent session)
- REQ-2: Shows the actual file structure — what's in index.md, plan.md, spec.md
- REQ-3: Explains the two-layer context model (project layer + per-task layer)
- REQ-4: Shows a real example of what the agent reads when it opens a task
- REQ-5: Multi-agent handoff explained (Claude → Gemini via shared files)
- REQ-6: Jira integration mentioned
- REQ-7: Skill-only setup as CTA (30 seconds)
- REQ-8: GitHub link

## Acceptance Criteria
- [ ] Article drafted with DEV.to formatting (headers, code blocks)
- [ ] Actual file contents shown (index.md example, project context example)
- [ ] Two-layer context model explained clearly
- [ ] Multi-agent handoff example
- [ ] Skill-only CTA at end
- [ ] GitHub link present
- [ ] Publish instructions present

## KPI

**Metric**: DEV.to Article Reactions
**Source**: manual
**Source Config**: check reactions manually after 72h
**Target**: 30
**Threshold**: 10
**Window**: 72h
**Maps To**: Developer Adoption

---

## Draft

---

### DEV.to Article

**Title:** `How I solved context loss between Claude and Gemini with a Kanban board`

**Tags:** `ai, claudecode, productivity, opensource`

---

```markdown
I've been building with Claude Code and Gemini CLI for the last year. Three things kept breaking my flow:

1. **Context limits** — Claude hits its window mid-task, the next session starts cold
2. **Agent switching** — moving from Claude to Gemini loses everything that wasn't in the code
3. **Requirements drift** — the LLM remembers the code but not *why* it was built that way. Every session I'd find myself re-explaining decisions that were already made.

I looked at [superpowers](https://github.com/jessevondoom/superpowers) and gemini conductor. Both good — but neither gave me the Kanban structure I was used to working with.

So I built [LaneConductor](https://github.com/meller/laneconductor).

## The core idea: Kanban cards are great context for LLMs

A Kanban card isn't just a UI preference. It forces you to define: what is this task, what's the current status, what's been done, what comes next. That's exactly what an agent needs to be oriented without re-explanation.

LaneConductor keeps two layers of context that merge into every agent action:

**Layer 1 — Project context** (loaded once, applies to everything):
```
conductor/
├── product.md        # what we're building, who uses it
├── tech-stack.md     # languages, frameworks, DB
└── product-guidelines.md  # brand, patterns, decisions
```

**Layer 2 — Per-task context** (loaded per task):
```
conductor/tracks/1042-auth-flow/
├── index.md    # current status, lane, progress
├── plan.md     # phases with checkboxes, what's done
└── spec.md     # requirements, acceptance criteria, design decisions
```

When an agent picks up a task, it reads both layers. Here's what an actual `index.md` looks like:

```markdown
# Track 1042: Auth Flow

**Lane**: implement
**Lane Status**: running
**Progress**: 60%
**Phase**: Phase 2 — JWT validation
**Summary**: Implementing token refresh logic, Phase 1 (login endpoint) complete

## Problem
Users get logged out mid-session when tokens expire silently.

## Solution
Add automatic refresh with 15-minute sliding window.
```

And `spec.md` carries the product intent:

```markdown
## Requirements
- REQ-1: Token refresh must be invisible to the user
- REQ-2: Refresh window: 15 minutes before expiry
- REQ-3: On refresh failure, redirect to /login with `session_expired=true`

## Design Decision
We chose sliding window over absolute expiry because users complained about being
logged out mid-form. This was discussed in the 2026-03 product review.
```

That last paragraph is the thing that disappears in a normal session. The agent understands *why* the code is the way it is, not just what it does.

## Multi-agent handoff

The agent writes back to the same files when it's done:

```markdown
**Lane**: review
**Progress**: 100%
**Phase**: Complete

## ✅ Phase 2 Complete
- JWT refresh endpoint at /api/auth/refresh
- Sliding window implemented in middleware/auth.js
- Tests: 6/6 passing
```

Next session — Claude or Gemini — opens the same folder. No briefing needed. They just see the files.

Claude and Gemini never need to know the other exists. They're both just reading and writing Markdown.

## The setup

**Simplest path — skill file only:**
Drop the skill file into Claude Desktop. No Node, no database, no daemon. Claude manages everything through the filesystem. Works on Windows, ~30 seconds.

**Full stack:**
```bash
git clone https://github.com/meller/laneconductor
cd laneconductor && make install
cd your-project && lc setup
lc worker start && lc ui start
# Kanban dashboard at localhost:8090
```

**Jira integration:**
```bash
lc add-target --type jira --domain yourcompany.atlassian.net \
  --email you@company.com --project-key ENG
```
Track status in LaneConductor updates Jira automatically. Syncs both ways.

## Where it's going

The same context pattern extends beyond dev — marketing tasks, sales outreach, support. Any AI-driven work that needs persistent context across sessions. Each task defines success before execution (inspired by Karpathy's autoresearch idea), and a quality gate measures the actual result at the end of a time window.

For now it's a Kanban board for your dev agents. The goal is a single place where every AI agent shares context and every task closes a loop.

Open source: [github.com/meller/laneconductor](https://github.com/meller/laneconductor)

Curious what you're using to manage context across long AI-assisted projects.
```

---

### Publish Instructions
1. Go to https://dev.to/new
2. Title: `How I solved context loss between Claude and Gemini with a Kanban board`
3. Tags: `ai`, `claudecode`, `productivity`, `opensource`
4. Paste the article body above
5. Add a cover image (optional — the Kanban dashboard screenshot works well)
6. Publish
7. After 72h: check reactions count, update `**KPI Actual**` in index.md
