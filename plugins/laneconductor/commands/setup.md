---
description: "Add LaneConductor to this project: read what is there, confirm the stack and commands, write the conductor/ files (runs only because you named it)"
argument-hint: "[scaffold]"
---
Setup: `$ARGUMENTS` (nothing given means add LaneConductor to this project). This runs only because I named it; do nothing else with it. Look for no program other than `git`, and read no settings file.

This command carries its whole procedure below: it is the text of the skill file `setup/setup.md`, then the existing-repository path of `ops/new-project.md` (in "The path in detail"), with the recommendation block. Do not Glob or Read the plugin's install folder (`~/.claude/plugins/...`) to carry it out: that folder is outside the project, and a read there raises a permission question or is denied. The skill file paths named in the text are references only.

`/laneconductor:setup` adds LaneConductor to the project you are in. Run it only when the person asks for it by name. It needs
no installer and no database: the result is a `conductor/` folder, plain files
in git. Nothing is committed without a yes, and nothing is ever pushed.

Before you write anything, tell the person what you are about to create or change, and wait for a yes.

If your client asks "Allow this read outside the working directories?" for a file of this plugin, tell the person in one line to
choose the option that allows it this one time. The options that say "keep allowing" or "block ... from now on" change a
permanent setting for every project and are not needed. Never ask anyone to change their permission settings for LaneConductor.

## What setup does

Follow the existing-repository path in "The path in detail" below (the folder has a `.git`, or files other than `conductor/`); when the folder is empty, the new-project
path of `ops/new-project.md` applies and `/laneconductor:new-project` is the command for it. In short:

1. **Read the project first.** Infer the name, the stack, the test and lint commands and the CI setup from `package.json` (or the
   equivalent), the README, the CI files and the lint config. Show it all in ONE message, already filled in (name, stack, the
   test and lint commands, where each fact came from, and the tracks folder with its "private" option for a public repository, as
   `ops/new-project.md` says), end with "Reply ok, or tell me what differs", and write nothing until that
   reply. Do not ask what the files already answer.
2. **Say what is already there.** If `conductor/` or `conductor/tracks` already exists (an older LaneConductor), say what you
   found: how many tracks, in which naming form, which lanes. Import nothing silently and change none of them.
3. **Show the plan, then write.** List the files the scaffold would create and the ones it would skip because they exist.
   After a yes, create only the missing ones. An existing README, `package.json` or any other file of the project is never
   touched, and `.gitignore` only gets the three lines it lacks.
4. **Notice a stale project-level skill.** If `.claude/skills/laneconductor` exists in the project (Glob; `test -L` for a link,
   `git ls-files` to see whether git tracks it; read only), say in one sentence that the plugin supplies the skill itself, so this
   copy or link is stale, and offer its removal: show `rm .claude/skills/laneconductor` alone in its own bash block (`rm -r` for a
   folder; `git rm` for one that git tracks, and removing it then needs a commit, which you ask about first). Never run it and
   touch nothing else.
5. **Say what else fits.** After the project is read, say which optional plugins would help this project (see "What else fits this
   project" below), then wait for the person's answer.
6. **Summarize and ask before any commit** (a single commit of the files you created, by name, never `git add -A`). End with the
   line "Next: run `/laneconductor:next`"; do not name the next step yourself, and do not repeat the add-on offer.

## What else fits this project

After the project is read, say which of these optional plugins would help THIS project, so the person does not have to find them in
the README. Look at what you read (the git history, the CI files, how big the project is, what the person told you), pick only the entries
that fit and are not installed, and say for each, in one short paragraph, why it fits this project. If one is already installed, say
nothing about it. If nothing fits, say nothing and go on.

How to offer one:

- Show its two install commands exactly as written below, each alone in its own bash block, then the reload step. You only show them:
  never run an install command yourself, and install nothing unless the person says yes (and then still show the commands for them to run).
- Say plainly what it installs, from the note under its name.
- Mention each plugin once in this session. If the person declines, do not bring it up again.

**`laneconductor-parallel`**: Parallel work: isolated sub-agents, one per track in its own worktree, and safe shared state through conflict-checked track writes. It fits when the git history shows several authors, the project has CI files or several services, or the person wants tracks worked in parallel or by sub-agents. It installs an MCP server (the connector, a Node.js program) and a scaffold script on your computer, from the owner's marketplace (`meller/laneconductor`), not from Anthropic's directory. It counts as installed when its connector tools are among your tools, or its agent `laneconductor-parallel:track-runner` is listed.

```bash
claude plugin marketplace add meller/laneconductor
```

```bash
claude plugin install laneconductor-parallel@laneconductor
```

Then run `/reload-plugins` in the session. Inside a session you can type `/plugin marketplace add meller/laneconductor` and `/plugin install laneconductor-parallel@laneconductor` instead (that opens the plugin's details for review).

**`laneconductor-board`**: The board, one private page of every track by lane, which Claude publishes as an artifact. It fits when a team will follow the tracks, the project already has more than a handful of them, or the person wants an overview of every track by lane. It installs a script (a Node.js program, no packages) and its page on your computer, from the owner's marketplace (`meller/laneconductor`), not from Anthropic's directory. It has no tool or agent to look for, and finding its files means searching the plugin install folder, which is outside the project and not read here: offer it as an option, once, and say it can be ignored if it is already installed.

```bash
claude plugin marketplace add meller/laneconductor
```

```bash
claude plugin install laneconductor-board@laneconductor
```

Then run `/reload-plugins` in the session. Inside a session you can type `/plugin marketplace add meller/laneconductor` and `/plugin install laneconductor-board@laneconductor` instead (that opens the plugin's details for review).

## setup scaffold

`/laneconductor:setup scaffold` is the explicit action that goes straight to the files: follow
`setup/scaffold.md` (templates in `setup/templates.md`) and skip the interview. Use it when the person already
knows what they want, or another tool has already scanned the project.

<!-- Starter set: reserved for the skill advisor (track 10124) -->

## The path in detail

From `ops/new-project.md`: how to read the project and what the confirmation message holds, then how the files are created.

### Detect the situation

- Empty or new folder: a new project. Ask for a name if the argument gave none.
- An existing repository (it has a `.git`, or files other than `conductor/`): say so and offer to add only the
  `conductor/` scaffold. `/laneconductor:setup` takes this path. Read what is there first (see "Existing repository" below) and
  use it as answers, so you ask less. Never overwrite an existing file; the scaffold skips what exists.
- `conductor/tracks` already holds tracks (an older LaneConductor, or another tool): say what you found (how many, in which
  naming form, which lanes) and import nothing. Offer to add only the missing `conductor/` context files and leave every track
  as it is; importing older tracks is a separate yes the person gives (`setup/scaffold.md`, "Older
  tracks"). Point to `new` for creating tracks.

#### Existing repository

Keep the interview short. Read the project and ask only to confirm:

- The name, from `package.json`, `pyproject.toml` or the README title (else the folder name).
- What it is for, from the package description or the first README paragraph (else ask one question).
- The stack, from the dependencies and config files; hosting hints from `Dockerfile`, `vercel.json` and the like.
- The test, lint, typecheck, build and e2e commands from the scripts in `package.json`, the Makefile and the CI files. A
  command is proposed only if it really exists: the npm placeholder `echo "Error: no test specified"` is not a test command, and
  a lint config without a lint script is not a lint command. Say so when you leave one out.
- Read the files yourself; do not look for a script to do it.

Show the result as ONE message with everything filled in, so the person only has to approve it: the name, what it is for, the
stack, the test, lint, typecheck and build commands that really exist (one line for each one you left out, with the reason),
where each fact came from, and the tracks folder: `conductor/tracks/`, committed with the code (the default), or private, for a
public repository whose plans should not be public (the folder is then kept out of git with one `.gitignore` line; private tracks
are not shared with other machines or people). End with "Reply ok, or tell me what differs." Write nothing until that reply. Ask a
further question only about what could not be read (usually KPIs and constraints, and only if the person wants them now).
Do not add the walking-skeleton track to an existing project; suggest planning the first real track instead.

### Create the files

Show what you would create and what you would skip because it exists, and ask for a yes; after the yes, create the files. The files and templates are
in the skill files `setup/scaffold.md` and `setup/templates.md`; apply these rules over them:

- Create `conductor/product.md`, `tech-stack.md`, `workflow.md`, `workflow.json`, `product-guidelines.md`,
  `design-language.md`, `quality-gate.md`, `user-stories.md`, `kpis.md` and `tracks/`. No settings file is created: LaneConductor needs none.
- Every file is tailored from the answers; what was not discussed is an honest placeholder, never an invented value.
- `quality-gate.md` names only commands that really exist in the chosen stack, with unchecked boxes and no verdict.
- `.gitignore` gets `conductor/tracks/**/conversation.md`, `conductor/tracks/**/conversation.json` and `.worktrees/`.
- `git init` only when the folder is not a repository. Do not create skill symlinks, `.claude/MEMORY.md` or a deploy
  stub, and do not touch a database.
