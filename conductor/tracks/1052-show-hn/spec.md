# Spec: Track 1052 — Show HN Post (Replan v2)

## Problem Statement
HN Show HN is the highest-signal developer launch channel. The audience values technical depth, open source, and honest framing. They will reject anything that smells like marketing.

**Replan context**: First post (item_id=47338664) scored 1 after 48h. KPI miss detected automatically by the quality-gate. Root cause: title led with product name + "superpowers" — violated REQ-1. New hypothesis: the meta angle. This repost IS the product demo — the audience witnesses the closed KPI loop working.

## HN Show HN Rules
- Title must start with "Show HN:"
- Link must go to the project (GitHub repo or landing page)
- Body (text field) is optional but critical for context
- No upvote begging in the body
- Post between 7–9am Pacific for best visibility

## Audience Profile
- Backend/systems engineers and solo founders
- Skeptical of AI hype
- Love: open source, local-first, no-SaaS, elegant architecture, honest stories about failure, tools that solve real problems across the whole stack
- Hate: vague "AI agent" claims, cloud lock-in, marketing language

## Key Angles for HN
1. **The meta loop** — first post scored 1, system detected it automatically, replanned, this is the replan. Reader witnesses the closed KPI loop working.
2. **LLM crash recovery** — state lives in files, not context windows. Any agent picks up exactly where the last one stopped.
3. **Filesystem-as-API** — agents read and write Markdown, never call APIs or touch databases directly. Unusual constraint → clean separation.
4. **Skill-only mode** — drop one file into Claude Desktop, no Node/Postgres/daemon needed. 30 seconds to start.
5. **Autoresearch / KPI loop** — define success before execution. Done = worked, not just shipped.
6. **Local-first** — no cloud, no auth, nothing leaves your machine.

## What to Avoid
- Don't lead with the product name
- Don't use superlatives ("best", "revolutionary", "superpowers")
- Don't say "AI agent" without showing concretely what it does
- Don't sound like a pipeline log — write like a person
- Don't cross-link other communities

## Requirements
- REQ-1: Title leads with the honest failure event OR the architecture pattern — NOT the product name
- REQ-2: Body para 1 — honest failure opening, human voice, not system-log language
- REQ-3: Body para 2 — LLM crash problem and why filesystem-as-state solves it (strongest hook, goes second)
- REQ-4: Body para 3 — what the project is: Kanban for AI agents across dev + marketing + sales + support, with concrete examples (Show HN draft, cold email)
- REQ-5: Body para 4 — measurement loop explanation, ends with "that loop is what generated this post"
- REQ-6: Body para 5 — two modes: full stack vs skill-only (30 seconds, works on Windows)
- REQ-7: No marketing language throughout — skeptical engineer test
- REQ-8: GitHub link present

## Acceptance Criteria
- [ ] Title has no product name in it
- [ ] Body reads like a person wrote it, not a system log
- [ ] LLM crash recovery explained in plain language
- [ ] Skill-only mode mentioned with concrete detail (30s setup, works on Windows)
- [ ] Measurement loop explained and tied back to this being a repost
- [ ] GitHub link present
- [ ] Post submitted at 7–9am Pacific (Tue–Thu)
- [ ] item_id updated in KPI Source Config after posting
- [ ] Comments engaged within 1 hour of posting

## KPI

**Metric**: HN Score (upvotes)
**Source**: hn-api
**Source Config**: item_id=48046969
**Target**: 100
**Threshold**: 50
**Window**: 48h
**Maps To**: Show HN Score

---

## Draft

### Title ✅
```
Show HN: My first post scored 1. Karpathy's autoresearch idea helped me repost.
```

---

### Body (plain text — paste into HN text field)

My first Show HN for this project got 1 upvote. I know because the project itself checked — it fetches the score from the HN API when the window closes, compares it against a threshold I set, and if it misses, it kicks the task back to me with a note to try a different angle. So here's the different angle.

I built it this way because LLMs crash mid-task. When Claude hits its context limit halfway through an implementation, everything in flight is gone. With all state in files, any agent can open the same folder and pick up exactly where the last one stopped. Claude and Gemini can hand off to each other without either one knowing the other exists — they just see the files.

The project is a local Kanban board where AI agents run tasks across your whole business — dev, marketing, sales, support. Not just code. An agent writes a Show HN draft, you review and post it, the system measures the score. An agent drafts a cold email sequence, you send it, same loop. Instead of calling APIs or touching databases, agents read and write Markdown files — plan.md for what to do next, index.md for current status, spec.md for requirements. A background worker watches the folder with chokidar and syncs state to Postgres.

The measurement part is newer, inspired by Karpathy's autoresearch idea: before a task enters execution, you define success upfront — a metric, a source, a threshold, a time window. After you ship (or post, or send), a quality gate runs when the window closes. It fetches the real number from the source (HN API, Reddit API, manual entry), compares it to the threshold, and either closes the task or sends it back to planning with the data attached so the next attempt starts with a different hypothesis. That loop is what generated this post.

Two ways to use it: full local stack (Postgres + Vite dashboard, live Kanban at localhost:8090), or skill-only mode where you just drop the skill file into Claude Desktop and the AI manages everything directly through the filesystem — no Node, no database, no daemon. The second mode works on Windows and takes about 30 seconds to set up.

100% local, no cloud, no auth, nothing leaves your machine.

https://github.com/meller/laneconductor

---

### Publish Instructions

1. Go to https://news.ycombinator.com/submit
2. Title: paste the title above exactly
3. URL: https://github.com/meller/laneconductor
4. Text: paste the body above (plain text — HN strips markdown)
5. Submit
6. Save the new HN post URL (format: https://news.ycombinator.com/item?id=XXXXXXX)
7. Update spec.md: replace `item_id=TBD` with the real item ID
8. Reply "done" in the track conversation to trigger the quality-gate schedule
9. Monitor comments for first 2 hours — respond to every substantive question

**Best time to post**: 7–9am Pacific (Tuesday–Thursday for maximum visibility)
