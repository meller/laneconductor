# Post Draft — Gemini CLI Discussion

**Category**: Show and tell
**Title**: I built a live Kanban control plane for Gemini CLI conductor — shared context, real-time board, cross-agent handoff

---

## Post Body

I was running Gemini CLI with the conductor format for task tracking, and Claude Code with superpowers skills for implementation — also inspired by OpenClaw's approach. All great tools, but completely siloed. No shared context between the agents, no visibility into what each was doing, and if one LLM exhausted mid-task there was no clean handoff to the other.

I wanted one thing: a unified view where both agents share the same context, and I can see what's happening without reading terminal output.

**LaneConductor** is that layer — a live Kanban board (localhost:8090) that updates in real-time as your agents work, backed by a shared Markdown context that both Claude and Gemini read and write.

![LaneConductor — live Kanban as agents work](https://raw.githubusercontent.com/meller/laneconductor/main/docs/demo.gif)

It works natively with the **Gemini CLI conductor format** — if you're already using `conductor/tracks/` folders, LaneConductor picks them up automatically. No migration, no config changes.

This is built on **context-driven development**: all state lives in Markdown files (`plan.md`, `spec.md`, `index.md`) rather than in any LLM's context window. That means if Claude exhausts mid-task, Gemini opens the same files and continues from exactly the same point — no lost work, no restarting from scratch. The files *are* the shared context and the checkpoint.

**Four ways to use it:**
- **CLI** — `npx laneconductor` or `lc` commands to create tracks, check status, move lanes
- **Worker mode** — background daemon picks up queued tracks and runs them autonomously (Wigham-style auto-implement)
- **Claude skill** — invoke `/laneconductor plan`, `/laneconductor implement`, `/laneconductor review` directly inside Claude Code
- **Gemini** — instruct Gemini CLI to use the skill the same way: plan a track, implement it, review it — the conductor format is native

**What it does:**
- Live Kanban dashboard synced to your `conductor/tracks/` files every 2s
- Shared context layer — Claude and Gemini read/write the same Markdown files
- Cross-agent handoff when one LLM exhausts — no lost work
- Multi-project — all your repos in one board
- 100% local: Postgres + Vite, no cloud, no auth, no cost

**3-command install:**

```bash
git clone https://github.com/meller/laneconductor ~/Code/laneconductor
cd your-project && lc setup
lc start && lc ui
```

→ **GitHub**: https://github.com/meller/laneconductor

Happy to answer questions — running this daily across 3 repos with Claude and Gemini simultaneously.

---

## Notes for reviewer
- Story hook reflects real origin: Gemini conductor + Claude superpowers + OpenClaw inspiration
- "Shared context" is the core value prop, not just a feature
- Two worker modes explained clearly
- GIF embedded inline
- "Show and tell" category
- No feature list in opening — problem/motivation first
