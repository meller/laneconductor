# setup scaffold

Run only when the person asks for it by name: `/laneconductor:setup scaffold`. It goes straight to the files: no interview about the
project beyond what the files below need. Plain `setup` follows [../ops/new-project.md](../ops/new-project.md) (its existing-repository
path) and uses this file and `templates.md` for the same `conductor/` structure. Three rules hold either way:

- Tell the person what you are about to create or change before you write anything, and wait for a yes.
- Never overwrite a file that exists; skip it and say so.
- Create no database or symlink, and commit nothing without a separate yes. Never push.

## setup scaffold generate

The no-questions variant: another tool already scanned the project and got the person's confirmation. Read
`conductor/.setup-scaffold-context.json` (`project` with `name`, `git_remote`, `has_existing_code`; `scan`, a list of snippets;
`brainstorm_summary`). The summary, when present, is the agreed understanding and wins over the scan snippets.

Create the files of "Create the files" (the project steps), tailored from the context, with templates from `templates.md`: `product.md` says what the product does, who uses it, the key features and the problem it solves; `tech-stack.md` the languages, frameworks, data stores, infrastructure and key libraries; `workflow.md` the commit strategy, branching, testing and review; `product-guidelines.md` the brand, style and UX principles; `design-language.md` the design tokens (infer them from Tailwind/CSS-variable config, a theme or token files); `kpis.md` the north-star metrics, from `brainstorm_summary` if it states goals; `user-stories.md` the personas and journeys, a TODO stub if the summary has no journey language (invent no personas); `quality-gate.md` the project's own verification commands, each derived from what the scan found (`package.json` scripts, test runner, lint config, e2e framework), never one the project lacks; `code_styleguides/` only when the project has lint or format config to describe. Unknown stays a placeholder.

## setup scaffold (interactive)

Ask first: "Does this project have existing code? (yes/no)".

**Existing code.** Read `package.json`, `README.md`, the source directories, CI and lint config, and infer: `product.md`
(README, app name, entry points, routes), `tech-stack.md` (dependencies, framework patterns), `workflow.md` (the commit log, CI
files, test setup), `code_styleguides/` (`.eslintrc`, `.prettierrc`, `tsconfig.json` when present), and the design language and
`product-guidelines.md` stubs as above. Write `user-stories.md` only if concrete journeys surface in the README or scan. Then ask
one KPI question: "What does success look like? What are your 2-3 north-star metrics and rough targets?" and use the answer for
`kpis.md` (stub rows from the README if skipped). Show what you inferred and ask only to confirm it.

**New project.** Ask a short questionnaire: what it does and for whom; language, framework and data; TDD, commit strategy and
branching; brand or style standards; the same KPI question (for example "500 signups by Q2"); and optionally key user journeys.
Generate the files from the answers.

Both create the files of "Create the files" (the `workflow.json` default is in `templates.md`). Never ignore `conductor/tracks/**/index.md` or `history.md`: both are tracked. Every track the scaffold creates gets an empty `history.md` (one header line, `# History: Track INITIALS-NNN`).

## Older tracks

If `conductor/tracks/` already holds folders, say what you found first: how many, in which naming form (`INITIALS-NNN-slug`, a bare
`NNN-slug`, or another tool's such as `feature_name_20260213/README.md`), and the lanes their `index.md` files show. Import nothing
silently and change none of them. Then ask: "Found N existing tracks. Leave them as they are, or bring the ones that do not follow
the `INITIALS-NNN-slug` form into LaneConductor? (leave/import)". On "import", for each such folder:

1. Take the title from the first `# Heading` of `README.md` or `index.md`.
2. Detect status: `✅ COMPLETED`, `DONE` or `complete` -> lane `done`; `IN PROGRESS` or `in-progress` -> `implement`; anything else -> `backlog`.
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
5. Leave the original `README.md` where it is, and print `✅ Imported N tracks -> conductor/tracks/NNN-*/`.

## Close

End as `setup` does: its one closing message. A problem you saw in the basics (a test or lint command that does not run) goes in it as one line.
