# LaneConductor 🛰️

**The local-first control plane for multi-agent AI development.**

![LaneConductor Kanban Dashboard](docs/hero.png)

### See it in action: Brainstorming → Planning → Automated Implementation
![Demo: LaneConductor Workflow](docs/demo.gif)

LaneConductor is a **sovereign developer environment** that orchestrates AI agents (Claude, Gemini, and more) across multiple repositories, giving you real-time visibility through a unified Kanban dashboard — with zero cloud dependency and zero cost.


[![License: MIT](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)
[![Works with Claude Code](https://img.shields.io/badge/works%20with-Claude%20Code-blue)](https://claude.ai/code)
[![Works with Gemini CLI](https://img.shields.io/badge/works%20with-Gemini%20CLI-orange)](https://github.com/google-gemini/gemini-cli)
[![Documentation](https://img.shields.io/badge/docs-Knowledge%20Base-cyan)](https://laneconductor-site.web.app/wiki.html)

---

## ⚡ Key Features

- **Sovereign & Local-First**: Runs 100% on your hardware. No cloud, no auth, no hidden costs.
- **The Conductor Pattern**: A structured **Plan → Implement → Review → Quality Gate → Done** pipeline. Compatible with the [Gemini CLI conductor format](https://github.com/google-gemini/gemini-cli).
- **Filesystem Message Bus**: Uses simple Markdown files in `conductor/tracks/` as the source of truth, enabling agents and humans to coordinate seamlessly.
- **Live Kanban Dashboard**: A Vite + React dashboard that syncs in real-time with your filesystem via a local Postgres database.
- **Quality Gates**: Automated verification (tests, linting, builds) that must pass before any work is considered "Done".
- **Multi-Agent Support**: Natively optimized for **Claude Code** and **Gemini**, with support for primary and fallback LLM configurations.

---

## 🚀 Quick Start

### Option A: Standard (CLI-driven)

```bash
# 1. Install the lc CLI globally
git clone https://github.com/meller/laneconductor.git && cd laneconductor && make install

# 2. Initialize in your project
cd ~/your-project && lc setup

# 3. Start the worker and dashboard
lc start && lc ui
```

The Kanban dashboard will be available at [**localhost:8090**](http://localhost:8090).

### 🧠 Option B: AI-Native (Skill Only)
No CLI, no local DB, no UI required. **Works on Windows, macOS, and Linux.**

1.  **Install Skill**: Copy the `laneconductor` folder from `.claude/skills/` into your Claude Desktop skill directory.
2.  **Initialize**: Open your **project codebase** and run the following within Claude:
    ```bash
    /laneconductor setup
    ```
3.  **Conduct**: Manage your project entirely through the AI skill. Try these commands:
    - `/laneconductor newTrack "Feature Name" "Short Description"`
    - `/laneconductor plan NNN`
    - `/laneconductor implement NNN`
    Check `conductor/tracks.md` at any time for a project-wide summary.

---

### Optional: AI Context Scaffolding

Use the Claude Code skill to automatically scan your codebase and generate project documentation:

```bash
# Within Claude Code
/laneconductor setup scaffold
```

---

## 📖 Documentation

For a deep dive into operating modes, CLI reference, and workflow configuration, visit the [**LaneConductor Knowledge Base**](https://laneconductor-site.web.app/wiki.html).

---

## 🛠️ Project Structure

- `bin/`: The universal `lc` command-line tool.
- `conductor/`: Core orchestrator logic and heartbeat worker.
- `ui/`: Vite + React Kanban dashboard and Express API.
- `cloud/`: Firebase functions for remote/team mode.
- `.claude/skills/`: The specialized AI skill definition for Claude.

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
