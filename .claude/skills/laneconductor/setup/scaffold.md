# setup scaffold

Run only when the person asks for it by name: `/laneconductor:setup scaffold`. It is the explicit action that goes straight to
the files: no interview about the project beyond what the files below need. Plain `setup` follows
[../ops/new-project.md](../ops/new-project.md) (its existing-repository path) and uses this file and `templates.md` for the same
`conductor/` structure. Whichever way you got here, three rules hold:

- Tell the person what you are about to create or change before you write anything, and wait for a yes.
- Never overwrite a file that exists; skip it and say so.
- Create no database or symlink, and commit nothing without a separate yes. Never push.

## setup scaffold generate

The no-questions variant: another tool already scanned the project, talked with the person and got confirmation. Read
`conductor/.setup-scaffold-context.json`:
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
- `conductor/tech-stack.md`: languages, frameworks, data stores, infrastructure, key libraries
- `conductor/workflow.md`: commit strategy, branching, testing approach, review process
- `conductor/workflow.json`: the default lanes in `templates.md`
- `conductor/product-guidelines.md`: brand, style and UX principles (placeholders if unknown)
- `conductor/design-language.md`: design tokens (infer from Tailwind/CSS-variable config, a
  component-library theme or token files; placeholders if unknown)
- `conductor/kpis.md`: north-star metrics, from `brainstorm_summary` if it states goals
- `conductor/user-stories.md`: personas and journeys; a TODO stub if the summary has no journey
  language (do not invent personas that were not discussed)
- `conductor/quality-gate.md`: the project's own verification commands. Derive every command
  from what the scan found (`package.json` scripts, test runner, lint config, e2e framework). A
  gate naming commands the project does not have is worse than none: it gets skipped or faked.
- `conductor/tracks/`, and `conductor/code_styleguides/` when the project has lint or format config to describe
- `.laneconductor.json` with a state branch only (see `templates.md`)

## setup scaffold (interactive)

Ask first: "Does this project have existing code? (yes/no)".

**Existing code.** Read `package.json`, `README.md`, the source directories, CI and lint config,
and infer: `product.md` (README, app name, entry points, routes), `tech-stack.md` (dependencies,
framework patterns), `workflow.md` (`.git` log patterns, CI files, test setup),
`code_styleguides/` (`.eslintrc`, `.prettierrc`, `tsconfig.json` when present), and the design
language and `product-guidelines.md` stubs as above. Write `user-stories.md`
content only if concrete journeys surface in the README or scan. Then ask one KPI question: "What
does success look like? What are your 2-3 north-star metrics and rough targets?" and use the
answer for `kpis.md` (stub rows from the README if skipped). Show what you inferred and ask only to confirm it.

**New project.** Ask a short questionnaire: what it does and for whom; language, framework and
data; TDD, commit strategy and branching; brand or style standards; the same KPI question
(for example "500 signups by Q2", "HN front page"); and optionally any key user journeys. Generate
all the files above from the answers.

Both create `conductor/{tracks/, product.md, product-guidelines.md, design-language.md, tech-stack.md, user-stories.md,
workflow.md, kpis.md, quality-gate.md}` and `conductor/workflow.json` (the default in `templates.md`). Also:

- **`.gitignore`**: append whichever of these lines are missing (create the file if it does not exist):
  ```
  conductor/tracks/**/conversation.md
  conductor/tracks/**/conversation.json
  .worktrees/
  ```
  `conversation.md` and `.json` hold comment threads that are per machine and noisy to review; `.worktrees/` holds git worktree
  checkouts, which must never be tracked in the main tree (without this rule they end up committed as submodule-style gitlinks).
  Do not add `conductor/tracks/**/index.md`: it carries real authored content that is worth tracking.

## Older tracks

If `conductor/tracks/` already holds folders, say what you found before anything else: how many, in which naming form
(`INITIALS-NNN-slug`, a bare `NNN-slug`, or something else such as `feature_name_20260213/README.md` from another tool), and the
lanes their `index.md` files show. Import nothing silently, and change none of them. Then ask: "Found N existing tracks. Leave them
as they are, or bring the ones that do not follow the `INITIALS-NNN-slug` form into LaneConductor? (leave/import)". On "import",
for each such folder:

1. Take the title from the first `# Heading` of `README.md` or `index.md`.
2. Detect status: `✅ COMPLETED`, `DONE` or `complete` -> lane `done`; `IN PROGRESS` or
   `in-progress` -> `implement`; anything else -> `backlog`.
3. Assign the next free track number (continue from the highest existing folder).
4. Create `conductor/tracks/NNN-slug/index.md` (only if it does not exist):
   ```markdown
   # Track NNN: Title

   **Lane**: done
   **Lane Status**: success
   **Progress**: 100%
   **Last Run**: imported (n/a)
   **Summary**: Imported from a previous tool
   ```
5. Leave the original `README.md` where it is.
6. Print `✅ Imported N tracks -> conductor/tracks/NNN-*/`.

## Check the basics

After scaffolding, check that git is present (`git rev-parse --is-inside-work-tree`, note `main` vs `master`) and that the test
and lint commands in `conductor/quality-gate.md` really run. Report each problem as `⚠️ <description>` and offer to make a track for
the fixes; create it only on a yes.

## Offer the board

At the end of scaffolding, ask once: "Create a private board for this project (every track by lane,
refreshed when you ask)?" On yes, follow [../ops/board.md](../ops/board.md) from "No URL: create".
On no, do nothing; the human can ask for it later ("show the board"). Never create it unasked.
