# setup: add LaneConductor to this project

`/laneconductor:setup` adds LaneConductor to the project you are in. Run it only when the person asks for it by name. It needs
no installer and no database: the result is a `conductor/` folder, plain files
in git. Nothing is committed without a yes, and nothing is ever pushed.

Before you write anything, tell the person what you are about to create or change, and wait for a yes.

## What setup does

Follow [../ops/new-project.md](../ops/new-project.md), its existing-repository path (the folder has a `.git`, or files other than
`conductor/`), and when the folder is empty its new-project path. In short:

1. **Read the project first.** Infer the name, the stack, the test and lint commands and the CI setup from `package.json` (or the
   equivalent), the README, the CI files and the lint config. Show what you found and where each fact came from, and ask only
   to confirm it, in one message. Do not ask what the files already answer.
2. **Say what is already there.** If `conductor/` or `conductor/tracks` already exists (an older LaneConductor), say what you
   found: how many tracks, in which naming form, which lanes. Import nothing silently and change none of them.
3. **Show the plan, then write.** List the files the scaffold would create and the ones it would skip because they exist.
   After a yes, create only the missing ones. An existing README, `package.json` or any other file of the project is never
   touched, and `.gitignore` only gets the three lines it lacks.
4. **Say what else fits.** After the project is read, say which optional plugins would help this project (see "What else fits this
   project" below), then wait for the person's answer.
5. **Summarize and ask before any commit** (a single commit of the files you created, by name, never `git add -A`). End with the
   line "Next: run `/laneconductor:next`"; do not name the next step yourself, and do not repeat the add-on offer.

## What else fits this project

<!-- generated: recommended plugins -->

## setup scaffold

`/laneconductor:setup scaffold` is the explicit action that goes straight to the files: follow
[scaffold.md](scaffold.md) (templates in [templates.md](templates.md)) and skip the interview. Use it when the person already
knows what they want, or another tool has already scanned the project.

<!-- Starter set: reserved for the skill advisor (track 10124) -->
