# setup: add LaneConductor to this project

`/laneconductor:setup` adds LaneConductor to the project you are in. Run it only when the person asks for it by name. The result is a
`conductor/` folder of plain files in git. Nothing is committed without a yes, and nothing is ever pushed.

If your client asks "Allow this read outside the working directories?" for a file of this plugin, tell the person in one line to
choose the option that allows it this one time. The options that say "keep allowing" or "block ... from now on" change a
permanent setting for every project and are not needed. Never ask anyone to change their permission settings for LaneConductor.

## What setup does

Follow [../ops/new-project.md](../ops/new-project.md), its existing-repository path (the folder has a `.git`, or files other than
`conductor/`). A folder with no code and no plan document (empty, or only a README or licence) is a new project: say in one line that `/laneconductor:new-project` is the command for it (a brainstorm, the scaffold, first tracks, suggested skills) and stop. In short:

1. **Read the project, confirm it in ONE message.** The name, the stack, the commands that exist, the plan documents (one line, if any), what will be created and whether tracks are private
   or committed (declared, never asked), as "Existing repository" in [../ops/new-project.md](../ops/new-project.md) says: about
   twelve lines, ending "Reply ok, or tell me what differs". Write nothing until that reply. Say nothing about what does not
   exist or does not apply, and do not ask what the files already answer.
2. **An existing `conductor/`** (an older LaneConductor) is one more line in the message: how many tracks, in which naming form,
   which lanes. Import nothing and change none of them.
3. **Write after the reply.** The reply is the yes: create only the missing files. No existing file of the project is touched,
   and `.gitignore` only gets the lines it lacks.
4. **A stale project-level skill** is one more line in the message, only if `.claude/skills/laneconductor` exists (read only: Glob,
   `test -L`, `git ls-files`): the plugin supplies the skill itself, so this copy is stale. Offer its removal:
   `rm .claude/skills/laneconductor` alone in its own bash block (`rm -r` for a folder; `git rm` for one that git tracks, and
   removing it then needs a commit, which you ask about first). Never run it.
5. **Say what else fits**, in the closing summary, not in the message above: a starter set of three or four optional plugins at most ("What else fits this
   project" below); say nothing when none fits. Do not wait for an answer: step 6 follows in the same message.
6. **Close with the first track.** Say in about three lines what you created (counts and folders) and what the person must do
   themselves, if anything. End with the first-track card ([next.md](../ops/next.md), "The first-track card": written once, shared with
   `next`; it leads with the plan found in step 1 and holds the board line), then the line "Say commit when you want the conductor files committed." The track choice is
   the one question: no "Next: run `/laneconductor:next`" line and no second question. On "commit": `git add` the files you
   created, by name (never `git add -A`), make one commit and never push.

## What else fits this project

<!-- generated: recommended plugins -->

## setup scaffold

`/laneconductor:setup scaffold` is the explicit action that goes straight to the files: follow
[scaffold.md](scaffold.md) (templates in [templates.md](templates.md)) and skip the interview.
