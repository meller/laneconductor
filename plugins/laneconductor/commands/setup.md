---
description: "Add LaneConductor to this project: read what is there, confirm the stack and commands, write the conductor/ files (runs only because you named it)"
argument-hint: "[scaffold]"
---
Setup: `$ARGUMENTS` (nothing given means add LaneConductor to this project). This runs only because I named it; do nothing else with it.

Setup means adding LaneConductor to the project I am in. Follow the skill file `ops/new-project.md`, its existing-repository path; read it in full first.
1. Read package.json (or the equivalent), the README, the CI files and the lint config; infer the project name, the stack and the test and lint commands, and ask only to confirm them: show all of it in ONE message already filled in (with the tracks folder and its "private" option for a public repository). End with "Reply ok, or tell me what differs" and write nothing until I reply.
1b. If the client asks "Allow this read outside the working directories?" for a file of this plugin, tell me in one line to choose the option that allows it this one time: the "keep allowing" and "block from now on" options change a permanent setting and are not needed. Never ask me to change my permission settings.
2. If `conductor/tracks` already exists from an older LaneConductor, say what you found and import nothing silently.
3. Tell me what you are about to create or change before you write anything. Never overwrite an existing file; the scaffold skips what exists. Ask before any commit; never push.
4. Setup needs no installed command-line tool and no settings file: look for no program other than `git` and the scripts the skill file names, and read no settings file. After reading the project, say which optional plugins fit it and show their install commands, as the skill file says (never run them).

When the action is `scaffold`, go straight to `setup/scaffold.md` (templates in `setup/templates.md`) and skip the interview; the same rules hold. Read the file in full first and tell me what you are about to create or change before you write anything.
