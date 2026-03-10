# Track 003: Per-project Install Flow

## Phase 1: make install ✅ COMPLETE

- [x] `Makefile` has `install` target → writes `~/.laneconductorrc`
- [x] `~/.laneconductorrc` contains path to skill dir
- [x] `ui-install` installs Vite UI deps

## Phase 2: setup scaffold ✅ COMPLETE

**Problem**: New projects need conductor/ structure, Makefile targets, and skill symlink.
**Solution**: `setup scaffold` scans codebase (or runs questionnaire) and creates all files.

- [x] Task 1: Scaffold creates `conductor/` dir with all context files
    - [x] `product.md`, `tech-stack.md`, `workflow.md`, `product-guidelines.md`
    - [x] `tracks.md`, `tracks/`, `code_styleguides/`
- [x] Task 2: `laneconductor.sync.mjs` written to `conductor/`
- [x] Task 3: `lc-*` Makefile targets appended (lc-install, lc-start, lc-stop, lc-status, lc-ui-start, lc-ui-stop)
- [x] Task 4: Skill symlinked → `.claude/skills/laneconductor` → `~/.laneconductorrc` path
- [x] Task 5: `.claude/MEMORY.md` created if absent

## Phase 3: Fix sync.mjs template in SKILL.md ✅ COMPLETE

**Problem**: SKILL.md embeds the full sync.mjs code as a template. The pg parameterized query
placeholders (`$1`, `$2`...) were being substituted by Claude Code's skill arg injection when
commands like `/laneconductor newTrack foo bar` were invoked (`$1`→`foo`, `$2`→`bar`).
A fix changed them to `:project_id` etc., but that breaks actual pg query execution.

**Solution**: Remove the inline template from SKILL.md. Instead, `setup scaffold` should copy
the canonical `conductor/laneconductor.sync.mjs` from the laneconductor repo directly —
this is the authoritative file and always has correct syntax.

- [x] Task 1: Update SKILL.md `setup scaffold` section — replace inline sync.mjs code block
              with instruction to copy from canonical path
- [x] Task 2: Verify `conductor/laneconductor.sync.mjs` has correct `$1`, `$2` pg syntax

**Impact**: `setup scaffold` on new projects writes a correct sync.mjs. No more arg substitution bugs.

## Phase 4: setup collection ✅ COMPLETE

**Problem**: Projects need DB config, agent config, and a registered project row.
**Solution**: `setup collection` prompts for all config, creates schema, UPSERTs project row.

- [x] Task 1: DB connection config prompts with defaults
- [x] Task 2: Primary + secondary agent config (CLI + dynamic model discovery)
- [x] Task 3: DB schema creation (projects + tracks tables, with primary/secondary model columns)
- [x] Task 4: Project UPSERT → `project.id` written back to `.laneconductor.json`
- [x] Task 5: `pg` + `chokidar` installed via `make lc-install`

## ✅ REVIEWED

## ✅ QUALITY PASSED
