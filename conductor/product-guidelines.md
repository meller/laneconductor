# Product Guidelines

## Design Principles
- **Sovereign first**: Everything works offline, no external dependencies at runtime
- **Zero config to start**: Sensible defaults for all DB settings
- **One command to use**: `make lc-start` should be the daily driver
- **Minimal footprint**: Don't add deps to user projects beyond pg + chokidar

## UI Aesthetic
- Dark theme (gray-950 background) — this lives in a terminal-adjacent context
- Status colors: gray=backlog, blue=in-progress, amber=review, green=done
- Compact cards — information dense but readable
- No animations except the heartbeat pulse dot

## Developer Experience Rules
- The LLM should never be required for start/stop/status — always have a `make` equivalent
- Symlink > copy — one source of truth for the skill
- Errors should be actionable: tell the user exactly what command to run to fix it
