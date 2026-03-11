# Spec: Track 1052 — Show HN Post

## Problem Statement
HN Show HN is the highest-signal developer launch channel. The audience values technical depth, open source, and honest framing. They will reject anything that smells like marketing.

## HN Show HN Rules
- Title must start with "Show HN:"
- Link must go to the project (GitHub repo or landing page)
- Body (text field) is optional but critical for context
- No upvote begging in the body
- Post between 7–9am Pacific for best visibility

## Audience Profile
- Backend/systems engineers
- Skeptical of AI hype
- Love: open source, local-first, no-SaaS, elegant architecture, concrete problems
- Hate: vague "AI agent" claims, cloud lock-in, marketing language

## Key Angles for HN
1. **Context-driven development** — state in files not LLM context, enables crash recovery and agent handoff
2. **Filesystem-as-API** — LLM communicates through Markdown files, sync worker handles DB/network
3. **Local-first** — no cloud, no auth, Postgres + Vite on localhost
4. **Multi-agent coordination** — git lock layer prevents double-claiming tracks across workers

## What to Avoid
- Don't say "AI agent" without explanation
- Don't lead with the product name
- Don't use superlatives ("best", "revolutionary")
- Don't cross-link other communities (HN dislikes it)

## Requirements
- REQ-1: Title leads with the technical problem or architecture pattern, not the product name
- REQ-2: Body explains the core architecture in 2–3 short paragraphs
- REQ-3: Links to GitHub repo (not landing page — HN prefers source)
- REQ-4: Mentions local-first / no cloud
- REQ-5: No marketing language

## Acceptance Criteria
- [ ] Title passes HN smell test (technical, no hype)
- [ ] Body explains filesystem-as-API and context-driven development concisely
- [ ] GitHub link present
- [ ] Post submitted
- [ ] Comments engaged within 1 hour of posting
