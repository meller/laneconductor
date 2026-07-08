# Spec: Track 1069 — LinkedIn Launch Post

## Problem Statement
LinkedIn audience: developers and technical leaders who use Claude Code / AI coding tools daily. Primary CTA is to try the skill file for dev workflows now. The future vision (KPIs, marketing, sales) is the "where this goes" — not the lead. Key differentiators to highlight: persistent context across agent sessions (no re-explaining), Jira integration for teams already in that workflow, and the Karpathy-inspired learning loop that makes the system self-improving over time.

## Target Audience
- Developers actively using Claude Code, Cursor, or similar AI coding tools
- Engineering managers who run teams using AI agents
- Technical founders building with LLMs
- People frustrated by context loss mid-session

## What to Avoid
- "Excited to announce" opener
- Whole-business scope as the lead (save it for "where this is going")
- Buzzwords: "revolutionize", "game-changing", "next-gen"
- Wall of text — LinkedIn needs white space and scannable structure

## Requirements
- REQ-1: Lead with the dev workflow problem (context loss mid-session)
- REQ-2: Skill-only mode as the primary CTA — try it in 30 seconds
- REQ-3: Persistent context between agents as the core value prop
- REQ-4: Jira integration mentioned for team context
- REQ-5: Karpathy learning loop as the "where this is going" vision
- REQ-6: Whole-business scope (marketing, sales) as future direction, not current lead
- REQ-7: GitHub link present
- REQ-8: Ends with engagement CTA

## Acceptance Criteria
- [ ] Post drafted with LinkedIn formatting (line breaks, no dense paragraphs)
- [ ] Opens with personal story or observation
- [ ] Karpathy measurement loop explained in plain language
- [ ] Whole-business scope mentioned
- [ ] LLM crash recovery explained
- [ ] GitHub link present
- [ ] Engagement CTA at end
- [ ] Publish instructions present

## KPI

**Metric**: LinkedIn Post Reactions
**Source**: manual
**Source Config**: check post reactions manually after 72h
**Target**: 50
**Threshold**: 20
**Window**: 72h
**Maps To**: LinkedIn Post Reactions

---

## Draft

---

### LinkedIn Post

```
I've been building education AI projects for the last year using Claude Code and Gemini CLI. Three things kept slowing me down: context limits forcing agent restarts mid-task, switching between agents and losing the thread entirely, and repeating the same requirements over and over. The LLM remembered the code — but not why it was built that way. Every new session I'd find myself re-explaining decisions that were already made.

I found superpowers and gemini conductor. Both good, but halfway there — neither gave me the Kanban lanes I was used to. A Kanban card isn't just a UI preference; it's a structure that forces you to define status, progress, and next steps — exactly the context an agent needs to pick up without re-explanation.

So I built LaneConductor.

Every task is a folder. The agent opens it, knows exactly what it's building, why, and where the last session stopped. It does its work, writes back. Context limit? Restart. Switch to Gemini. Doesn't matter — the next agent picks up the same folder and continues. No briefing. No repetition.

The part I find most valuable: the agent has the product intent, not just the code. I work on a design, turn it into code, and the design lives in the same task folder. Next time I touch that area, we load the spec, update if needed, change the code accordingly. The agent understands why the code is the way it is.

If you're already in Jira, it syncs both ways.

---

Where this is going: the same pattern extends beyond dev — marketing, sales, support — any AI work that needs persistent context. Inspired by Karpathy's autoresearch idea: define success before execution, measure at the end of a time window, feed failures back into planning. The system learns from what didn't work.

Start with the skill file — drop it into Claude Desktop, 30 seconds, no deps. If you like it, add the full UI or connect your Jira.

https://github.com/meller/laneconductor

Curious what you're building and whether persistent context changes how you work with agents.
```

---

### Publish Instructions
1. Go to LinkedIn, click "Start a post"
2. Paste the post text above
3. Add the GitHub link as a comment or in the post body
4. Optional: add a screenshot of the Kanban dashboard as the image
5. Post at a high-engagement time (Tuesday–Thursday, 8–10am or 12–1pm in your timezone)
6. Monitor for 24h, reply to comments
7. After 72h: check reactions count and update `**KPI Actual**` in index.md
