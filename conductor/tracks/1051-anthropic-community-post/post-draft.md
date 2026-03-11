# Discord #built-with-claude Post

**Title**: Built a live Kanban dashboard that syncs with Claude Code skills in real-time

---

Been using Claude Code with the superpowers skills pattern for a while and kept hitting the same wall: I couldn't see what my agents were doing without reading terminal output. So I built a dashboard.

**LaneConductor** is a local Kanban board that syncs with your `conductor/tracks/` files in real-time — every `/laneconductor plan`, `implement`, or `review` command moves the card on the board automatically.

It's built on context-driven development: all state lives in Markdown files rather than in the LLM's context window. That means if Claude exhausts mid-task or crashes, you can restart the session and continue exactly where it left off — or switch agents entirely. No lost work either way. The files are the shared context and the crash recovery mechanism.

**Four ways to use it:**
- `/laneconductor` skill commands inside Claude Code (plan, implement, review, brainstorm)
- Instruct any other LLM the same way — native conductor format support
- `lc` CLI for track management
- Worker mode: autonomous background daemon that picks up queued tracks

**3 commands to get started:**
```
git clone https://github.com/meller/laneconductor ~/Code/laneconductor
cd your-project && lc setup
lc start && lc ui
```

**Open source, 100% local** — no cloud, no auth, no data leaves your machine.
GitHub: https://github.com/meller/laneconductor

Live demo: https://raw.githubusercontent.com/meller/laneconductor/main/docs/demo.gif

🔒 Runs entirely on your machine (local Postgres + Vite). No credentials or project data are transmitted anywhere.
