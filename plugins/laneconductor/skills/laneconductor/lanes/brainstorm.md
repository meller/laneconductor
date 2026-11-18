# brainstorm: `/laneconductor brainstorm N`

An optional deepening step before implement: ask the human clarifying questions through
`conversation.md`. It is not a lane and can run at any time. Write the first question to `conversation.md` and set
`**Waiting for reply**: yes` in `index.md` yourself.

Before step 1, look at "Offer a missing skill" near the end of this guide: one check, usually silent.

1. **Load context.** On `FRESH_SESSION: false` read only `conversation.md` (you need the latest
   human reply; every question-answer round after the first is normally a resumed session).
   Otherwise read `conductor/product.md`, `tech-stack.md`, `deployment-stack.md` (if present), and
   the track's `spec.md`, `plan.md`, `test.md` and `conversation.md`.
2. **Ask one question**, appended to `conversation.md` (the dialogue file; run events are dated lines in `history.md`, never in `plan.md` or `spec.md`):
   ```
   > **system**: Brainstorm requested. [Your question here]
   ```
   One question per message: several at once get partial answers.
3. Set `**Waiting for reply**: yes` in `index.md`, then stop and wait for the human's reply in
   `conversation.md` (or the UI inbox).
4. On a reply, ask the next question. Repeat.
   If the outcome is work no track holds yet, do not open a track by reflex: search first, the default is
   update, not create (see "Search first" in [ops/tracks.md](../ops/tracks.md)).
5. When the requirements are unambiguous, the acceptance criteria are clear and every phase
   implies at least one test case (or the human says "go ahead"), run the plan lane on the
   track: it reads `conversation.md` and updates `spec.md`, `plan.md` and `test.md` from the dialogue.

## Offer a missing skill

Before the work, look at what fits this lane and offer what is missing; `/laneconductor:suggest-skills` is the whole procedure. Usually this is silent: nothing missing means no message, and an offer never blocks the work.

The track is the one this command names, so its lane, `**Type**` and stack are known. At the start of this lane, and again when the track's situation changes (a failing test, a review comment to answer, a UI, a deploy), look at what fits and offer what is missing. Usually this is silent. The full command is `/laneconductor:suggest-skills`.

**How to offer.** Plain text in your reply: never a form, a menu or a question that blocks the work.

1. **Look first.** A skill counts as installed when any of these is true: it is in the skills list this session shows you (that list already covers project, user and plugin skills, and a plugin skill can appear as `plugin:skill`); `claude plugin list` (read only; run it once per session, and only when the list is not enough) shows its plugin as enabled; or a folder with its name exists in `.claude/skills/` of the project or in `~/.claude/skills/`. A skill listed under an older name counts too. When it is installed, say so in one line ("you have `<skill>` installed, use it before writing the content") and use it.
2. **Offer only what is missing**, from the candidates below that fit the lane, the track's `**Type**` (`dev` when it has none) and the project's stack: read `conductor/tech-stack.md` and look for the marker files named under "Stack tags". When nothing is missing, say nothing.
3. **Be quiet.** At most two items per offer: our own entries before third-party ones, `prerequisite` before `helps`. Never the same entry twice in a session, and never an entry on the project's declined list: the file `skill-advisor-declined.txt` inside the directory that `git rev-parse --git-common-dir` prints (one entry name per line; it is inside `.git`, so it is never committed). A trivial track gets at most the one-line tip, and a suggestion in the middle of a step (a failing test and `systematic-debugging`) is one line.
4. **Say it in one or two plain sentences**: what it is, why it helps here, where it comes from, and what it installs (use the note under its name: an entry that installs a program says so plainly; a Markdown-only one adds knowledge only). Then each install command alone in its own bash block, one command per block, no leading `$`, so the desktop app shows a Run button. In a session the person can type `/plugin install <plugin>@<marketplace>` instead (inline text, not a block); that opens the plugin's details for review.
5. **Level.** `prerequisite`: say the result will be better with it and ask, in the same sentence, whether to install it first or carry on. `helps`: a one-line tip. Either way the work is not blocked: with no answer, carry on.
6. **The answer.** *Install first*: show the commands, say nothing has been changed yet, say to run them and then `/reload-plugins`, and when the person is back start the step again from the top with the skill present. *Carry on*: start the step at once and do not repeat the offer this session. *Do not ask again*: show the line you would add and, after the yes, append the entry's name to the declined file; with no git directory, just do not offer it again this session.
7. **Never run an install yourself.** The commands are shown; the person runs them, or uses the client's own plugin browser. If one fails, report the command and its output, retry nothing silently and work around nothing by editing settings or permissions. To share a plugin with collaborators, offer to add it to `enabledPlugins` in the project's `.claude/settings.json` only when the person asks: show the exact change first, say it turns the plugin on for them but does not download it (each person runs the install once with `--scope project`), and write it only after a yes.

Candidates for the `brainstorm` lane:

#### `superpowers`

Process skills for the lanes: brainstorming and writing plans, test-first work, systematic debugging, sub-agent execution, worktrees, code review and verification before done. Third-party, licence MIT, from `anthropics/claude-plugins-official`. Fits `setup`, `brainstorm`, `plan`, `implement`, `review`, `quality-gate`, `merge` (lanes), Type `dev`, any stack. Level: `helps`.
Skills for this part: `brainstorming`, `writing-plans`.
It counts as installed when one of its skills (for example `test-driven-development`) is in the session's skills list, or `claude plugin list` shows `superpowers@claude-plugins-official`. It installs a shell hook script that runs when each session starts, plus Markdown skills on your computer, from `anthropics/claude-plugins-official`, Anthropic's official marketplace.

```bash
claude plugin install superpowers@claude-plugins-official
```

## Skills that help here

These are suggestions, in the same spirit as the rest of this guide: a second opinion, never an order. If a skill
named here is installed (for example from the Superpowers plugin), consider using it; if it is not, say so in one line
and carry on without it. `brainstorming` helps draw out requirements one question at a time; `writing-plans` helps once the requirements are clear and the plan lane is next.

Also read `conductor/workflow.json`. If it has a top-level `skills` object with a list under `"brainstorm"`, such as
`{ "skills": { "brainstorm": ["my-skill"] } }`, use those skills in addition, the same way: if one is installed, use it; if
it is missing, say so and continue. The `skills` key is optional; when it is absent, nothing changes. Where a skill's
own steps or file locations differ from this guide or from the track files, the track files and this guide win; take the
skill's method, not its output paths.
