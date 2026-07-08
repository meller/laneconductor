# Spec: Track 1053 — Reddit Launch Posts

## Problem Statement
Reddit has active communities of exactly our target users — privacy-conscious developers, Claude Code users, and indie builders. Generic posts get scrolled past. Each community needs a different angle that speaks their language, but the underlying story is the same: LLM crash recovery via filesystem state, whole-business AI orchestration, and a closed measurement loop.

**Context from Track 1052**: HN v2 is live at https://news.ycombinator.com/item?id=48046969. Reddit posts should go out same week, tailored per community.

## Target Communities & Angles

| Subreddit | Audience | Lead Angle |
|-----------|----------|-----------|
| r/LocalLLaMA | Privacy-focused, local model users | LLM crash recovery + 100% local, no cloud |
| r/ClaudeAI | Claude Code users | Skill-file setup, agents persist across context resets |
| r/SideProject | Indie builders, founders | Meta story: HN scored 1, system measured it, replanned, this is the repost |

## What to Avoid
- Don't lead with product name or "AI agent" without showing what it does
- Don't use superlatives
- Don't sound like a changelog or product announcement
- Write like a person who built something and is explaining it honestly

## Requirements
- REQ-1: Each post leads with a concrete problem, not the product name
- REQ-2: LLM crash recovery explained in each post (it's the universal hook)
- REQ-3: Whole-business scope mentioned — not just dev, also marketing/sales/support
- REQ-4: Skill-only mode mentioned with specific detail (30s, Windows, no deps)
- REQ-5: GitHub link in every post
- REQ-6: Human voice — skeptical engineer test

## Acceptance Criteria
- [ ] All three posts drafted with titles
- [ ] Each post has a problem-first opening
- [ ] LLM crash recovery hook present in all three
- [ ] Skill-only mode mentioned with concrete detail
- [ ] GitHub link present in all three
- [ ] Tone is conversational, not product marketing
- [ ] Publish instructions present for each post

## KPI

**Metric**: Reddit upvotes (best post of the three)
**Source**: manual
**Source Config**: enter best post score manually after 72h window
**Target**: 50
**Threshold**: 25
**Window**: 72h
**Maps To**: Reddit Post Upvotes

---

## Draft

---

### Post 1: r/LocalLLaMA

**Title:**
```
Built a local Kanban board for AI agents where state lives in Markdown files — means any agent picks up where the last one crashed
```

**Body:**
```
I run Claude Code and Gemini CLI for development tasks, and I kept losing work when context windows fill up mid-implementation. The agent crashes, whatever was in flight evaporates, and the next session starts over.

My fix: all task state lives in files. Each task is a folder — index.md for current status, plan.md for phases and next steps, spec.md for requirements. When Claude hits its context limit halfway through, the next session opens the same folder and picks up exactly where the previous one stopped. Claude and Gemini can hand off to each other without either one knowing the other exists. They just see the files. This is the conductor pattern — one orchestrator coordinating multiple specialized agents — which is becoming the standard way to build multi-model systems without tight coupling.

The system covers more than dev. AI agents handle dev, marketing, sales, and support tasks — all running locally, all state in Markdown files. A background worker (chokidar) watches the folder and syncs to local Postgres for a Vite dashboard at localhost:8090.

One feature I added recently: define success before execution. Before a task starts, you set a metric, a threshold, and a time window. When the window closes, a quality gate fetches the real number from the source (HN API, Reddit API, or manual entry) and either closes the task or sends it back to planning with the failure data attached. My own HN launch post was one of these tasks. It scored 1. The system detected it and kicked it back to planning. This Reddit post is one of the outputs of that loop.

Two ways to run it: full local stack (Postgres + Vite dashboard at localhost:8090), or drop a single skill file into Claude Desktop — no Node, no database, no daemon. Second mode works on Windows and takes about 30 seconds.

100% local. No cloud, no auth, nothing leaves your machine.

https://github.com/meller/laneconductor
```

**Status:** Removed — insufficient account karma. Defer until account has standing.
**Posted:** 2026-05-07 (removed by AutoModerator)

**Publish Instructions:**
1. Go to https://www.reddit.com/r/LocalLLaMA/submit
2. Select "Text" post type
3. Title: paste the title above exactly
4. Body: paste the body above
5. Submit
6. Monitor and reply to comments for first 24 hours
7. Update this spec with the post URL and score after 72h

---

### Post 2: r/ClaudeAI

**Title:**
```
I added a Kanban board to Claude Code — agents write their progress to Markdown files and pick up across context resets
```

**Body:**
```
One of the pain points with Claude Code for longer tasks: when the context fills, work in progress is gone. The next session doesn't know what the previous one was doing.

I built LaneConductor to fix this. Each task is a folder with a few Markdown files — index.md for current status, plan.md for phases, spec.md for requirements. Claude reads and writes these files directly. When context resets mid-task, the next session opens the same folder and picks up from the last checkpoint. No re-explanation needed.

The simplest way to use it: drop a skill file into Claude Desktop. That's it — no Node, no Postgres, no daemon. Claude manages everything through the filesystem. Works on Windows, takes about 30 seconds to set up.

It follows the conductor pattern — one agent orchestrating others through shared state — so you can mix Claude and Gemini on different tasks without either one needing to know the other exists.

If you want the full stack: there's a Vite dashboard at localhost:8090, a background worker that watches the folder with chokidar, and a quality gate that measures results after tasks complete. Before a task enters execution, you define success upfront — a metric, a source, a threshold, a time window. The system fetches the real number when the window closes and either closes the task or replans with the failure data. Covers dev, marketing, sales, and support — not just code.

If your team uses Jira, it syncs both ways — track status in LaneConductor updates Jira automatically, and you can still drag cards in either place.

100% local. Nothing leaves the machine.

https://github.com/meller/laneconductor

Happy to answer questions about how the skill-file integration works or how it handles multi-session Claude Code tasks.
```

**Published:** https://www.reddit.com/r/ClaudeAI/comments/1t64y5z/i_added_a_kanban_board_to_claude_code_agents/
**Posted:** 2026-05-07

**Publish Instructions:**
1. Go to https://www.reddit.com/r/ClaudeAI/submit
2. Select "Text" post type
3. Title: paste the title above exactly
4. Body: paste the body above
5. Submit
6. Monitor and reply to comments for first 24 hours

---

### Post 3: r/SideProject

**Title:**
```
I have AI agents running my entire side project — dev, marketing, cold emails, Reddit posts. Built the system to manage all of it.
```

**Body:**
```
At some point I realized I was using AI agents for almost everything in my side project — writing code, drafting launch posts, handling support questions. But I had no way to track what was happening across all of it, and no way to measure whether any of it was actually working.

So I built LaneConductor. It's a local Kanban board where AI agents run tasks across your whole operation — dev, marketing, sales, support. Each task is a folder with a few Markdown files: index.md for current status, plan.md for phases, spec.md for requirements. Agents read and write these files directly. A background worker syncs state to a local Postgres DB and Vite dashboard at localhost:8090. No cloud, no auth, nothing leaves the machine.

The part I'm most happy with: inspired by Karpathy's autoresearch idea, every task has a KPI defined before it enters execution. A metric, a source, a threshold, a time window. When the window closes, a quality gate fetches the real number — from the HN API, Reddit API, or manual entry — and either marks the task done or sends it back to planning with the failure data attached so the next attempt starts with a different hypothesis. This post is a task. The HN launch post was a task. The cold email sequence is a task. Each one measured.

The other thing it solves: LLMs lose context mid-task. With all state in files, any agent picks up exactly where the last one stopped. Claude and Gemini can hand off without either knowing the other exists.

Simplest setup: drop one skill file into Claude Desktop — no Node, no Postgres, no daemon. About 30 seconds. Works on Windows.

Open source: https://github.com/meller/laneconductor

Curious what others are using to manage AI agents across a whole project, not just code.
```

**Published:** https://www.reddit.com/r/SideProject/comments/1t64ztj/i_have_ai_agents_running_my_entire_side_project/
**Posted:** 2026-05-07

**Publish Instructions:**
1. Go to https://www.reddit.com/r/SideProject/submit (or r/SideProjects — check which is more active)
2. Select "Text" post type
3. Title: paste the title above exactly
4. Body: paste the body above
5. Submit
6. Monitor and reply to comments for first 24 hours

---

### Posting Schedule
- **Day 1** (same week as HN post): r/LocalLLaMA — largest relevant community, post first
- **Day 3**: r/ClaudeAI — targeted to Claude Code users
- **Day 5**: r/SideProject — builder story, ends the launch week
- Stagger to avoid Reddit spam filter and maximize comment momentum per post
