# Show HN Post Draft

**Title**: Show HN: LaneConductor – Gemini conductor and Claude Code superpowers meets on Kanban

**URL**: https://github.com/meller/laneconductor

---

## Body (plain text — paste into HN text field)

I was running Gemini CLI with the conductor format for task tracking, and Claude Code with superpowers skills for implementation — also inspired by OpenClaw's approach. All great tools, but completely siloed. No shared context between agents, no visibility into what each was doing, and if one LLM exhausted mid-task there was no clean handoff to the other.

I wanted one thing: a unified view where both agents share the same context and I can see what's happening without reading terminal output.

LaneConductor is that layer — a live Kanban board (localhost:8090) that updates in real-time as your agents work, backed by shared Markdown files that both Claude and Gemini read and write.

It's built on context-driven development: all state lives in Markdown files (plan.md, spec.md, index.md) rather than in any LLM's context window. If Claude exhausts mid-task, Gemini opens the same files and continues from exactly the same point — no lost work, no restarting from scratch. The files are the shared context and the crash recovery mechanism.

Four ways to use it:
- /laneconductor skill commands inside Claude Code (plan, implement, review, brainstorm)
- Instruct Gemini CLI the same way — native conductor format support
- lc CLI for track management
- Worker mode: background daemon that picks up queued tracks autonomously

Demo: https://raw.githubusercontent.com/meller/laneconductor/main/docs/demo.gif

Open source, 100% local — Postgres + Vite on localhost. No cloud, no auth, no data leaves your machine.

https://github.com/meller/laneconductor

Running this daily across 3 repos with Claude and Gemini simultaneously. Happy to answer questions.

---

## Notes
- Title leads with the convergence angle (Gemini conductor + Claude superpowers)
- Body follows 1050 structure but adapted to plain text (no markdown headers/images)
- Demo GIF as plain URL (HN auto-links)
- No cross-links to other communities
- Ends with honest "happy to answer" — signals author is present
- Post time: 7–9am Pacific for best visibility
- **Live URL**: https://news.ycombinator.com/item?id=47338664
