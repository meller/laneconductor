# Spec: Track 1051 — Anthropic / Claude Code Community Post

## Problem Statement
We're visible in the Gemini CLI community (Track 1050 done) but not the Claude Code side. Claude Code users are the other half of our natural audience — they use `/laneconductor` skills directly, and LaneConductor was built around the superpowers skills pattern.

## Angle Differences vs Track 1050
The Gemini post led with "unified view across two agents." For the Claude Code audience:
- Lead with the **skills/superpowers pattern** — they already know what skills are
- Emphasize `/laneconductor plan`, `implement`, `review` as Claude skill commands
- The Kanban is the *output* they see — the skill commands are the *input* they use
- Cross-agent angle is secondary here; single-agent Claude workflow is primary

## Target Channels (in priority order)
1. **Claude Code GitHub Discussions** — https://github.com/anthropics/claude-code/discussions (most targeted)
2. **Anthropic Discord** — #show-and-tell or #projects channel
3. **r/ClaudeAI** subreddit — if discussions aren't active

## Post Structure
1. **Hook**: Built around the superpowers/skills pattern — from skills consumer to Kanban dashboard
2. **What it does**: Live Kanban that updates as `/laneconductor implement` runs
3. **Demo GIF**: same as Track 1050
4. **Claude-specific angle**: skill commands, superpowers pattern, context-driven development
5. **Cross-agent bonus**: also works with Gemini CLI (link to Track 1050 post)
6. **Install + CTA**

## Requirements
- REQ-1: Post in Claude Code GitHub Discussions (Show and tell category or equivalent)
- REQ-2: Lead with superpowers/skills angle, not generic multi-agent pitch
- REQ-3: Demo GIF embedded
- REQ-4: Show `/laneconductor` skill commands explicitly
- REQ-5: Link to github.com/meller/laneconductor
- REQ-6: Mention Gemini post as cross-reference (shows community traction)

## Acceptance Criteria
- [ ] Post live in Claude Code community
- [ ] GIF embedded inline
- [ ] Skills/superpowers angle in first paragraph
- [ ] `/laneconductor` commands shown
- [ ] GitHub link present
