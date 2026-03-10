# Track 003: Per-project Install Flow

**Lane**: done
**Lane Status**: success
**Progress**: 100%

## Problem
Users need a reliable, one-command way to add LaneConductor to any existing or new project.

## Solution
A two-step setup flow: `setup scaffold` (creates conductor/ structure + symlinks skill) followed by `setup collection` (configures DB + agent, registers project).

## Phases
- [x] Phase 1: `make install` + `~/.laneconductorrc` marker
- [x] Phase 2: `setup scaffold` — folder structure, Makefile lc-* targets, skill symlink
- [x] Phase 3: Fix sync.mjs template in SKILL.md (pg `$1` syntax bug)
- [x] Phase 4: `setup collection` — DB config, agent config, schema creation, project registration
