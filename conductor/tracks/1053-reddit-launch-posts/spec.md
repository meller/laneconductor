# Spec: Reddit Launch Posts

## Problem Statement
LaneConductor's core value proposition differs across audience segments. Reddit communities for AI developers are active, engaged, and perfect for targeted outreach. However, generic posts get lost in the noise. We need tailored messaging for each community to maximize visibility and discussion.

## Target Communities & Angles

| Subreddit | Primary Audience | Angle | Key Value Prop |
|-----------|-----------------|-------|-----------------|
| **r/LocalLLaMA** | AI enthusiasts, privacy-focused devs | Sovereignty & privacy | No cloud, no tracking, $0 cost, air-gapped |
| **r/ClaudeAI** | Claude users, Claude Code users | Workflow extension | Native Claude Code integration, extends your IDE |
| **r/SideProject** | Indie builders, founders | Builder story | Built a Kanban dashboard for AI agents, syncs with terminal |

## Requirements

### REQ-1: Problem-Solution Format
- Each post must clearly state the problem before pitching LaneConductor
- Anchor to subreddit values (privacy, productivity, indie spirit)
- Use community language and references

### REQ-2: Demo & Proof
- Include a demo GIF or screenshot showing the Kanban dashboard
- Show real track execution in the UI (e.g., a track transitioning lanes)
- Make it visual and clickable (link to GIF hosted on Imgur or similar)

### REQ-3: Call-to-Action
- Invite discussion: "What pain point does this solve for you?"
- Encourage questions: "Ask anything — I'll be monitoring this thread"
- Link to GitHub repo (not sales page)
- Optionally link to docs for quick setup

### REQ-4: Post Quality Baseline
- No broken links
- Grammar/spelling check (no typos)
- Tone: friendly, humble, helpful (not salesy)
- Length: 150–400 words per post (Reddit ideal)

### REQ-5: Timing Coordination
- All three posts must go out **same week as HN launch** (Track 1052)
- Stagger by 1–2 days if possible (Mon/Wed/Fri pattern)
- Note the HN launch date once Track 1052 confirms it

### REQ-6: Community Participation
- Must be present to respond to comments for first 24 hours post-launch
- Reply within 2 hours of comments during peak hours
- Aim for 100% reply rate on substantive questions

## Acceptance Criteria
- [ ] r/LocalLLaMA post drafted, reviewed, and ready to post
- [ ] r/ClaudeAI post drafted, reviewed, and ready to post
- [ ] r/SideProject post drafted, reviewed, and ready to post
- [ ] Each post includes problem statement, demo screenshot/GIF, and CTA
- [ ] All three posts have consistent branding and tone
- [ ] No broken links or typos in any post
- [ ] Posting schedule confirmed against HN launch week (Track 1052)
- [ ] Community response plan drafted (how/when to answer comments)

## Data Model Changes
None — this is a content/marketing initiative, no code changes.

## Dependencies
- **Track 1052**: HN launch post timing coordination
- **Demo assets**: Screenshot or GIF of Kanban dashboard (should already exist)
- **Community research**: Subreddit posting rules and recent top posts

## Out of Scope
- Creating the demo GIF (assume it exists or will be provided separately)
- Full community engagement plan (Phase 4 is monitoring + responses only)
- Long-term Reddit strategy (this is one-time launch posts only)
