# Spec: Track 1050 — Gemini CLI Discussion Repost

## Problem Statement
The original post (#21857) in google-gemini/gemini-cli discussions got 0 reactions. It failed on every dimension: wrong category, passive framing, no visual, feature list instead of story. The Gemini CLI community is the highest-value audience for LaneConductor's Gemini support — they already use the tool and are looking for workflow improvements.

## Why It Failed (Post-Mortem)
- **Category**: "Ideas" → audience is in feedback mode, not excitement mode
- **Framing**: "Feedback welcome" → passive, signals insecurity
- **No visual**: wall of text in a community that responds to demos
- **Content**: feature list → nobody cares about features, they care about problems solved
- **Hook**: no story, no pain point, no "I built this because..."

## Solution
Rewrite from scratch with everything we now have:
- `docs/demo.gif` — live demo of plan → implement → Kanban update
- Polished README and GitHub repo
- Story-first hook: the "4 terminal tabs" moment
- Post in **"Show and tell"** category (or equivalent high-engagement category)
- Clear CTA: 3-command install + GitHub link

## Target Post Structure
1. **Hook** (1 sentence): The problem that made you build this
2. **What it does** (2-3 sentences): Plain English, no jargon
3. **Demo GIF**: embedded inline — the visual does the selling
4. **Gemini-specific angle**: "Works natively with Gemini CLI conductor format"
5. **Install** (3 commands): `git clone` / `lc setup` / `lc start && lc ui`
6. **CTA**: Link to GitHub repo

## Requirements
- REQ-1: Post in "Show and tell" category (not "Ideas")
- REQ-2: Story-first hook — no feature lists in the first paragraph
- REQ-3: Demo GIF embedded in the post body
- REQ-4: Mention Gemini CLI conductor format compatibility explicitly
- REQ-5: 3-command install block
- REQ-6: Link to github.com/meller/laneconductor
- REQ-7: Actively engage with all replies within 2 hours of posting

## Acceptance Criteria
- [ ] Post is live in correct category
- [ ] Post contains embedded demo GIF
- [ ] Post contains story hook (not feature list) in first paragraph
- [ ] Install block present and correct
- [ ] GitHub link present
- [ ] At least 1 reply or reaction within 24 hours (success signal)
