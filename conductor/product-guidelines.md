# Product Guidelines

## Positioning
LaneConductor is the **AI orchestration layer for your whole business**. The core message:
- Not a project tracker — agents execute the work, not just track it
- Not a developer-only tool — marketing, sales, and support are first-class citizens
- Not a Swiss Army knife — it is an *operating layer* with a closed KPI feedback loop
- The Conductor metaphor is the identity: it orchestrates AI agents across all business functions

When writing copy, docs, or positioning for LaneConductor: lead with the full-business-cycle angle, anchor on the closed loop (measure → replan), and emphasize sovereignty (local-first, no SaaS).

## Design Principles
- **Sovereign first**: Everything works offline, no external dependencies at runtime
- **Zero config to start**: Sensible defaults for all DB settings
- **One command to use**: `make lc-start` should be the daily driver
- **Minimal footprint**: Don't add deps to user projects beyond pg + chokidar
- **Domain parity**: Dev, marketing, sales, support tracks are equally first-class — no second-class citizens in the UI or skill

## UI Aesthetic
- Dark theme (gray-950 background) — this lives in a terminal-adjacent context
- Status colors: gray=backlog, blue=in-progress, amber=review, green=done
- Compact cards — information dense but readable
- No animations except the heartbeat pulse dot

## Developer Experience Rules
- The LLM should never be required for start/stop/status — always have a `make` equivalent
- Symlink > copy — one source of truth for the skill
- Errors should be actionable: tell the user exactly what command to run to fix it
