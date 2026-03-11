# Spec: GitHub Repo Polish

## Problem Statement
The GitHub repo is the conversion endpoint for every launch channel. Currently it has no description, no website URL, no topics, and no visuals in the README. Every person who clicks a link from HN, Reddit, or a blog post lands here — if it doesn't immediately communicate value, they leave.

## Requirements

### REQ-1: GitHub Repo Metadata
- Description must be set: "Local-first control plane for multi-agent AI development — Claude + Gemini with a live Kanban dashboard"
- Website URL must be set: https://laneconductor.com
- Topics must be set: `claude`, `gemini`, `ai-agents`, `developer-tools`, `kanban`, `local-first`, `llm`, `cli`
- Note: This is done via GitHub UI (Settings gear icon on the repo page) — not via code changes

### REQ-2: README Hero Image
- A visual must appear immediately below the H1 heading, before any text
- Asset available: `ui/public/hero.png` (already in repo)
- Must be committed to a `docs/` folder at the repo root and referenced via relative path
- The image must render correctly on GitHub's README viewer

### REQ-3: Quick Start Simplification
- Current: 4 numbered sections with sub-bullets (lc install, lc setup, /laneconductor scaffold, lc start + lc ui)
- Target: 3 clean commands in a single code block
- The `/laneconductor setup scaffold` step (requires being inside Claude Code) should be moved to a separate "Optional: AI Context" section, not in the critical path
- Quick Start must be scannable in under 10 seconds

## Acceptance Criteria
- [ ] GitHub repo page shows description below the repo name
- [ ] laneconductor.com appears as the website link on the repo page
- [ ] At least 5 topics are visible on the repo page
- [ ] README renders a hero image as the first visual element on github.com/meller/laneconductor
- [ ] Quick Start section has exactly 3 commands (not counting optional steps)
- [ ] "Ralph Wiggum Loop" reference is either explained briefly or renamed to something self-explanatory for first-time visitors

## Notes
- hero.png is at ui/public/hero.png — copy to docs/hero.png before referencing in README
- GitHub topics are set via the repo settings UI, not via git push
- Do not remove any existing content beyond the Quick Start restructure
