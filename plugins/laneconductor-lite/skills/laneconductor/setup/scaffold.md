# setup scaffold

Run only when the user asks for it by name (or the setup wizard's `setup scaffold generate` prompt
sends you here). Two entry points create the same `conductor/` structure:

- **`new-project`** ([../ops/new-project.md](../ops/new-project.md)): the guided interview for a new project. It
  uses this file's file list and `templates.md`, but with a smaller `.gitignore`, a `.laneconductor.json` with only a
  state branch, and no daemon, database, symlink or sync-worker content (see the new-project procedure).
- **`setup scaffold generate`**: the file-generation half of `lc setup`. The CLI wizard already
  scanned the project, ran the brainstorm loop with the user and got confirmation. Generate the
  files and ask no questions.
- **`setup scaffold`**: interactive, for use directly from an AI editor (not via `lc setup`).

## setup scaffold generate

Read `conductor/.setup-scaffold-context.json`:
```json
{
  "project": { "name": "...", "git_remote": "...", "has_existing_code": true },
  "scan": ["package.json: ...", "README: ...", "Framework signals: next.config.js"],
  "brainstorm_summary": "user: ...\nassistant: ..."
}
```
If `brainstorm_summary` is present it is the agreed understanding of the project and wins over the
scan snippets, which are supplementary.

Generate these files, creating `conductor/` directories as needed (templates are in
`templates.md`):

- `conductor/product.md`: what the product does, who uses it, key features, the problem it solves
- `conductor/tech-stack.md`: languages, frameworks, databases, infrastructure, key libraries
- `conductor/workflow.md`: commit strategy, branching, testing approach, review process
- `conductor/product-guidelines.md`: brand, style and UX principles (placeholders if unknown)
- `conductor/design-language.md`: design tokens (infer from Tailwind/CSS-variable config, a
  component-library theme or token files; placeholders if unknown)
- `conductor/deployment-stack.md`: stub reading "Not configured. Run `lc setup-deploy`."
- `conductor/kpis.md`: north-star metrics, from `brainstorm_summary` if it states goals
- `conductor/user-stories.md`: personas and journeys; a TODO stub if the summary has no journey
  language (do not invent personas that were not discussed)
- `conductor/quality-gate.md`: the project's own verification commands. Derive every command
  from what the scan found (`package.json` scripts, test runner, lint config, e2e framework). A
  gate naming commands the project does not have is worse than none: it gets skipped or faked.
- `conductor/tracks/` and `conductor/code_styleguides/` if missing; `.claude/MEMORY.md` if missing

Then link the skill (below), and check for foreign tracks (below).

## setup scaffold (interactive)

Ask first: "Does this project have existing code? (yes/no)".

**Existing code.** Read `package.json`, `README.md`, the source directories, CI and lint config,
and infer: `product.md` (README, app name, entry points, routes), `tech-stack.md` (dependencies,
framework patterns), `workflow.md` (`.git` log patterns, CI files, test setup),
`code_styleguides/` (`.eslintrc`, `.prettierrc`, `tsconfig.json` when present), and the design
language, `product-guidelines.md` and `deployment-stack.md` stubs as above. Write `user-stories.md`
content only if concrete journeys surface in the README or scan. Then ask one KPI question: "What
does success look like? What are your 2-3 north-star metrics and rough targets?" and use the
answer for `kpis.md` (stub rows from the README if skipped).

**New project.** Ask a short questionnaire: what it does and for whom; language, framework and
database; TDD, commit strategy and branching; brand or style standards; the same KPI question
(for example "500 signups by Q2", "HN front page"); and optionally any key user journeys. Generate
all the files above from the answers.

Both create `conductor/{tracks/, code_styleguides/, product.md, product-guidelines.md,
design-language.md, tech-stack.md, deployment-stack.md, user-stories.md, workflow.md, kpis.md,
tracks.md}` and `conductor/workflow.json` (the default in `templates.md`). Also:

- Create `.claude/MEMORY.md` if it does not exist.
- **Ensure `.gitignore` covers the sync-only runtime files that are never
  meaningful to review, only ever DB/API-synced state** — append whichever
  of these lines are missing (create the file if it doesn't exist):
  ```
  conductor/tracks/**/conversation.md
  conductor/tracks/**/conversation.json
  .conv-cursor
  .worktrees/
  conductor/.runs/
  .prespawn-block-count
  .prespawn-block-kind
  ```
  (Bare filenames — `.conv-cursor`, `.prespawn-block-count`,
  `.prespawn-block-kind` — match at any depth, the same way a
  path-prefixed `conductor/tracks/**/` spelling would; keep the bare form
  so a future reader can tell these are the same canonical pattern list
  `conductor/services/scaffold-gitignore.mjs` defines, not a hand-drifted
  copy.)
  `conversation.md`/`.json` hold comment threads that sync via the DB/API
  layer, not git; `.conv-cursor` (written by `laneconductor.sync.mjs`) is a
  per-track, per-machine sync cursor position; `.worktrees/` holds git
  worktree checkouts, which must never be tracked in the main tree at all —
  confirmed live on a sibling project: without this rule, 6 track worktrees
  ended up accidentally committed as git submodule-style gitlinks;
  `conductor/.runs/` holds per-run dispatch/pid-liveness markers;
  `.prespawn-block-count`/`.prespawn-block-kind` (written by
  `conductor/services/prespawn-block-counter.mjs`) are per-track counters.
  Left tracked, all of these show up as permanent "uncommitted changes"
  that trip the main-mode lane actions' clean-checkout gate and block every
  merge project-wide — not just the one track whose file happens to be
  dirty. This mirrors the exact patterns `lc setup` (CLI mode) already
  writes into `.gitignore` — do it here too, since skill-only mode (no `lc`
  CLI) never runs that code path and would otherwise accumulate the same
  problem with nothing preventing it. Do **not** add
  `conductor/tracks/**/index.md` here — unlike everything above, `index.md`
  carries real authored content (the track's Problem/Solution write-up)
  that IS worth tracking; a project that finds its own `index.md` diffs are
  pure marker-churn noise should decide that for itself, not inherit it
  silently from scaffolding.
- **Link the skill into this project** so agents can invoke it locally. Skip this step when the
  skill is already provided by the LaneConductor plugin (this file's path contains `/plugins/` or
  `/.claude/plugins/`, not `<project>/.claude/skills/`): the plugin is the install, and the symlink would add a second copy. Link the **directory**
  (`-n` keeps `ln` from creating the link inside an existing directory link, which here would
  write into the skill folder itself):
  ```bash
  SKILL_DIR=$(cat ~/.laneconductorrc 2>/dev/null || echo "$HOME/Code/laneconductor/.claude/skills/laneconductor")
  TARGET=".claude/skills/laneconductor"
  # Skip if this IS the laneconductor repo (the skill is the real directory here)
  if [ "$(realpath $TARGET 2>/dev/null)" = "$(realpath $SKILL_DIR 2>/dev/null)" ]; then
    echo "Skill already present (this is the laneconductor repo)"
  else
    mkdir -p .claude/skills .agents/skills .agents/rules
    ln -sfn "$SKILL_DIR" "$TARGET"
    ln -sfn "$SKILL_DIR" ".agents/skills/laneconductor"
    REPO_DIR=$(dirname $(dirname $(dirname "$SKILL_DIR")))
    ln -sf "$REPO_DIR/.agents/rules/laneconductor.md" ".agents/rules/laneconductor.md"
    echo "Skill and rules symlinked for Claude and Antigravity"
  fi
  ```
  On Windows without WSL use `mklink /D` or `mklink /J`, or copy the whole `laneconductor`
  folder (not just `SKILL.md`) into `.claude/skills/`.

The heartbeat worker (`laneconductor.sync.mjs`) is managed globally by `lc`; do not copy it into
the project's `conductor/` folder, and do not embed its code in a skill file (template
substitution of query placeholders corrupted that once).

## Foreign tracks

After creating the structure, scan `conductor/tracks/` for folders that do not follow the
`NNN-slug` convention (for example Gemini conductor tracks like `feature_name_20260213/README.md`);
the heartbeat worker will not sync them. If you find any, ask: "Found N existing tracks from a
previous conductor tool. Import them as LaneConductor tracks? (y/n)". If yes, for each folder:

1. Take the title from the first `# Heading` of `README.md` or `index.md`.
2. Detect status: `✅ COMPLETED`, `DONE` or `complete` -> lane `done`; `IN PROGRESS` or
   `in-progress` -> `implement`; anything else -> `backlog`.
3. Assign the next free track number (continue from the highest existing `NNN-*` folder, or `001`).
4. Create `conductor/tracks/NNN-slug/index.md`:
   ```markdown
   # Track NNN: Title

   **Lane**: done
   **Lane Status**: success
   **Progress**: 100%
   **Last Run**: imported (n/a)
   **Summary**: Imported from previous conductor tool
   ```
5. Copy or symlink the original content alongside, or leave the original `README.md` in place.
6. Print `✅ Imported NNN tracks -> conductor/tracks/NNN-*/`. The worker picks them up on the next
   `lc start`.

## Environment check

After scaffolding, verify the environment: `chokidar` installed (`npm list chokidar`), git
present (`git rev-parse --is-inside-work-tree`, note `main` vs `master`), and the agents named in
`.laneconductor.json` (`claude`, `agy`, `gemini`) on the PATH. Report each problem as
`⚠️  Environment Issue: <description>` and ask "Would you like me to create Track 001 to track these
environment fixes? (y/n)". If yes, create `conductor/tracks/001-fix-environment/index.md`
(`**Lane**: backlog`, `**Lane Status**: queue`, `**Progress**: 0%`, a `**Summary**` naming the
gaps) and put the fixes (`npm install chokidar`, `git init`, ...) in its `plan.md`.

If `create_quality_gate` is `true` in `.laneconductor.json`, create `conductor/quality-gate.md` from
the template in `templates.md`, including its Test Layers section.

## Offer the board

At the end of scaffolding, ask once: "Create a private board for this project (every track by lane,
refreshed when you ask)?" On yes, follow [../ops/board.md](../ops/board.md) from "No URL: create".
On no, do nothing; the human can ask for it later ("show the board"). Never create it unasked.
