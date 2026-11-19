# setup: add LaneConductor to this project

`/laneconductor:setup` adds LaneConductor to the project you are in. Run it only when the person asks for it by name. It needs
no installer and no database: the result is a `conductor/` folder, plain files
in git. Nothing is committed without a yes, and nothing is ever pushed.

Before you write anything, tell the person in one short message what you are about to create, and wait for a yes.

If your client asks "Allow this read outside the working directories?" for a file of this plugin, tell the person in one line to
choose the option that allows it this one time. The options that say "keep allowing" or "block ... from now on" change a
permanent setting for every project and are not needed. Never ask anyone to change their permission settings for LaneConductor.

## What setup does

Follow [../ops/new-project.md](../ops/new-project.md), its existing-repository path (the folder has a `.git`, or files other than
`conductor/`), and when the folder is empty its new-project path. In short:

1. **Read the project, confirm it in ONE message.** The name, the stack, the commands that exist, what will be created and the one
   decision (tracks committed or private), as "Existing repository" in [../ops/new-project.md](../ops/new-project.md) says: about
   twelve lines, ending "Reply ok, or tell me what differs". Write nothing until that reply. Say nothing about what does not
   exist or does not apply, and do not ask what the files already answer.
2. **An existing `conductor/`** (an older LaneConductor) is one more line in the message: how many tracks, in which naming form,
   which lanes. Import nothing and change none of them.
3. **Write after the reply.** The reply is the yes: create only the missing files. An existing README, `package.json` or any
   other file of the project is never touched, and `.gitignore` only gets the lines it lacks.
4. **A stale project-level skill** is one more line in the message, only if `.claude/skills/laneconductor` exists (read only: Glob,
   `test -L` for a link, `git ls-files` for git): the plugin supplies the skill itself, so this copy is stale. Offer its removal:
   `rm .claude/skills/laneconductor` alone in its own bash block (`rm -r` for a folder; `git rm` for one that git tracks, and
   removing it then needs a commit, which you ask about first). Never run it.
5. **Say what else fits**, in the closing summary, not in the message above: say which optional plugins would help this project, as a starter set of three or four at most (see "What else fits this
   project" below), then wait for the answer; say nothing when none fits. When the board add-on is installed, also say once: `/laneconductor:board` opens the whole project as a board, and its What's next button shows the same step as `/laneconductor:next`.
6. **Summarize and ask before any commit** (a single commit of the files you created, by name, never `git add -A`). End with the
   line "Next: run `/laneconductor:next`"; do not name the next step yourself, and do not repeat the add-on offer.

## What else fits this project

<!-- generated: recommended plugins -->

## setup scaffold

`/laneconductor:setup scaffold` is the explicit action that goes straight to the files: follow
[scaffold.md](scaffold.md) (templates in [templates.md](templates.md)) and skip the interview. Use it when the person already
knows what they want, or another tool has already scanned the project.
