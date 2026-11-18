---
description: "Add LaneConductor to this project: read what is there, confirm the stack and commands, write the conductor/ files (runs only because you named it)"
argument-hint: "[scaffold]"
---
Setup: `$ARGUMENTS` (nothing given means add LaneConductor to this project). This runs only because I named it; do nothing else with it.

Setup means adding LaneConductor to the project I am in. Follow the skill file `ops/new-project.md`, its existing-repository path; read it in full first.
1. Read package.json (or the equivalent), the README, the CI files and the lint config; infer the project name, the stack and the test and lint commands, and ask only to confirm them, in one message.
2. If `conductor/tracks` already exists from an older LaneConductor, say what you found and import nothing silently.
3. Tell me what you are about to create or change before you write anything. Never overwrite an existing file; the scaffold skips what exists. Ask before any commit; never push.
4. Setup needs no installed command-line tool and no settings file: look for no program other than `git` and the scripts the skill file names, and read no settings file. After reading the project, say which optional plugins fit it and show their install commands, as the skill file says (never run them).

When the action is `scaffold`, go straight to `setup/scaffold.md` (templates in `setup/templates.md`) and skip the interview; the same rules hold. Read the file in full first and tell me what you are about to create or change before you write anything.
