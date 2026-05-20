# Spec: CLI Help — Scoped Sections

## Problem Statement
The current `lc --help` output presents all commands in two flat groups ("Core Commands" and "Project & Track Management"). This conflates commands that run once per machine (shared infrastructure like `lc api`, `lc ui`) with commands that run per-project (`lc start`, `lc new`, etc.). New users can't tell where they should be standing when they run each command.

## Requirements
- REQ-1: Group help output by scope, with a clear header per group
- REQ-2: Infrastructure commands (run once per machine, from anywhere) must be visually separated from per-project commands
- REQ-3: Each section header should hint at where/when the commands apply
- REQ-4: No commands removed or renamed — purely a presentation change

## Proposed Sections

```
Infrastructure  (run once per machine — from anywhere)
  api [start|stop]     Manage the shared Collector API at :8091
  ui [start|stop]      Manage the shared Vite dashboard at :8090

Project Setup  (run once per project — from project root)
  setup                Initialize LaneConductor in the current project
  setup-deploy         Guided deployment setup
  install              Install required project dependencies (pg, chokidar)

Worker  (per session — from project root)
  start / stop / restart
  worker [start|stop|restart|status|logs|sync]

Track Management  (per project)
  new, move, pulse, comment, brainstorm, show, logs, delete

Track Transitions
  plan, implement, review, quality-gate, backlog, done, rerun

Configuration
  config, workflow, add-target, list-targets, remove-target,
  enable-target, disable-target, verify-isolation, project, doc

Deployment
  deploy [env]
  remote-sync, init-summary, verify, quality-gate
```

## Acceptance Criteria
- [ ] `lc --help` (and `lc help`, `lc -h`) shows the new scoped sections
- [ ] `lc api` and `lc ui` appear under an "Infrastructure" or "Shared" heading
- [ ] `lc setup`, `lc install` appear under a "Project Setup" heading
- [ ] Worker commands appear under their own heading
- [ ] Track management and transitions remain grouped separately
- [ ] No functional change — only the help string is modified
