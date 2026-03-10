# LaneConductor 🛰️

**Orchestrating Agile Flow for AI Agents.**

LaneConductor is a **sovereign developer environment** designed to manage AI coding agents (like Claude or Gemini) as they work through complex software engineering tasks. It provides a persistent, file-based state machine that coordinates multiple agents across multiple repositories, giving you real-time visibility through a unified Kanban dashboard.

[![License: MIT](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)
[![Documentation](https://img.shields.io/badge/docs-Knowledge%20Base-cyan)](https://laneconductor-site.web.app/wiki.html)

---

## ⚡ Key Features

- **Sovereign & Local-First**: Runs 100% on your hardware. No cloud, no auth, no hidden costs.
- **The Conductor Pattern**: Implements a robust "Ralph Wiggum Loop" (Plan → Implement → Review → Quality Gate → Done). Compatible with the [Gemini CLI conductor format](https://github.com/google-gemini/gemini-cli).
- **Filesystem Message Bus**: Uses simple Markdown files in `conductor/tracks/` as the source of truth, enabling agents and humans to coordinate seamlessly.
- **Live Kanban Dashboard**: A Vite + React dashboard that syncs in real-time with your filesystem via a local Postgres database.
- **Quality Gates**: Automated verification (tests, linting, builds) that must pass before any work is considered "Done".
- **Multi-Agent Support**: Natively optimized for **Claude Code** and **Gemini**, with support for primary and fallback LLM configurations.

---

## 🚀 Quick Start

### 1. Global Installation
Install the universal CLI globally to manage your projects from any directory:
```bash
git clone https://github.com/meller/laneconductor.git
cd laneconductor
make install
```

### 2. Project Initialization
Navigate to any repository you want to track and initialize LaneConductor:
```bash
cd ~/your-project
lc install  # Installs local sync deps
lc setup    # Scaffolds the conductor/ directory
```

### 3. AI Context Scaffolding
Use the Claude Skill to automatically scan your codebase and generate project documentation:
```bash
# Within Claude Code
/laneconductor setup scaffold
```

### 4. Start the Engine
Launch the sync worker and the dashboard:
```bash
lc start
lc ui
```
The dashboard will open at [http://localhost:8090](http://localhost:8090).

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
