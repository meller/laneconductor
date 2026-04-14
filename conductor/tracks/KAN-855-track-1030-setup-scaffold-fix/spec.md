# Spec: Track 1030: setup scaffold fix

## Problem Statement
The current setup process is fragmented and redundant. `lc setup` (CLI) and `/laneconductor setup scaffold` (Skill) overlap in their questions, leading to a poor user experience. Additionally, `lc setup` is missing critical configuration fields (git_remote, secondary agent, dev server, LC cloud tokens) that are required for full functionality.

## Goals
- Clear separation of concerns:
    - `lc setup` (CLI): Handles all non-LLM, "hardcoded" configuration questions.
    - `/laneconductor setup scaffold` (Skill): Handles all AI-powered tasks like codebase scanning and intelligent context file generation.
- Complete configuration: Ensure `lc setup` collects all necessary data for `.laneconductor.json` and `.env`.

## Requirements

### REQ-1: Enhanced `lc setup` (CLI)
- **Identity**: Detect project name and `git_remote` URL.
- **Operating Mode**: Choose between `local-fs`, `local-api`, and `remote-api`.
- **Infrastructure** (if `local-api`):
    - Ask for DB host, port, name, user.
    - Ask for DB password and store it in `.env` (as `DB_PASSWORD`).
- **Collectors**:
    - Ask if syncing to Local, LC Cloud, or Both.
    - If Cloud/Both: ask for LC Cloud Token and store in `.env` (as `COLLECTOR_X_TOKEN`).
- **Agents**:
    - Ask for Primary Agent (claude/gemini/other).
    - Ask for Primary Model.
    - Ask if a Secondary Agent should be added.
- **Project Settings**:
    - Ask for Quality Gate lane toggle.
    - Ask for Dev Server command and URL (optional).
- **Filesystem**:
    - Create `conductor/`, `conductor/tracks/`, `conductor/code_styleguides/`.
    - Copy `workflow.json` and `workflow.md` from canonical source.
    - Update `.gitignore` to include `.env` and `.laneconductor.json`.
- **Registration**:
    - If `local-api`, UPSERT the project in the local Postgres DB and store the returned `id` in `.laneconductor.json`.
- **Removal**: Stop generating `product.md`, `tech-stack.md`, and stop asking "Does this project have existing code?".

### REQ-2: Refined `/laneconductor setup scaffold` (Skill)
- **AI Scanning**:
    - Ask "Does this project have existing code?".
    - If yes (Mode A): Scan codebase (package.json, README, source, etc.) and generate `product.md`, `tech-stack.md`, `product-guidelines.md`, and `code_styleguides/*.md` using LLM reasoning.
    - If no (Mode B): Run questionnaire to gather intent and generate files.
- **Skill Symlink**:
    - Ensure the LaneConductor skill is symlinked into `.claude/skills/laneconductor`.
- **Track Import**:
    - Scan for foreign tracks and offer to import them.
- **Quality Gate**:
    - Create `conductor/quality-gate.md` if enabled in config.

## Acceptance Criteria
- [x] `lc setup` successfully creates a complete `.laneconductor.json` and `.env`.
- [x] `lc setup` does NOT generate `product.md` or `tech-stack.md`.
- [x] `/laneconductor setup scaffold` correctly identifies existing code and generates high-quality context files.
- [x] No redundant questions are asked between the CLI and the Skill.
- [x] Project is correctly registered in DB during `lc setup` (for `local-api`).
