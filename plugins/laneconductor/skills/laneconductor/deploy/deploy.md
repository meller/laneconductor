# deploy `[env]`

Run only when the user asks for it by name. A deploy changes something live, so say which environment and which
command you are about to run and wait for a yes first.

Before step 1, offer the stack's deploy pack if it is missing (usually silent; it never blocks the deploy; `/laneconductor:suggest-skills` is the whole procedure):

The track is the one this command names, so its lane, `**Type**` and stack are known. At the start of this lane, and again when the track's situation changes (a failing test, a review comment to answer, a UI, a deploy), look at what fits and offer what is missing. Usually this is silent. The full command is `/laneconductor:suggest-skills`.

**How to offer.** Plain text in your reply: never a form, a menu or a question that blocks the work.

1. **Look first.** A skill counts as installed when any of these is true: it is in the skills list this session shows you (that list already covers project, user and plugin skills, and a plugin skill can appear as `plugin:skill`); `claude plugin list` (read only; run it once per session, and only when the list is not enough) shows its plugin as enabled; or a folder with its name exists in `.claude/skills/` of the project or in `~/.claude/skills/`. A skill listed under an older name counts too. When it is installed, say so in one line ("you have `<skill>` installed, use it before writing the content") and use it.
2. **Offer only what is missing**, from the candidates below that fit the lane, the track's `**Type**` (`dev` when it has none) and the project's stack: read `conductor/tech-stack.md` and look for the marker files named under "Stack tags". When nothing is missing, say nothing.
3. **Be quiet.** At most two items per offer: our own entries before third-party ones, `prerequisite` before `helps`. Never the same entry twice in a session, and never an entry on the project's declined list: the file `skill-advisor-declined.txt` inside the directory that `git rev-parse --git-common-dir` prints (one entry name per line; it is inside `.git`, so it is never committed). A trivial track gets at most the one-line tip, and a suggestion in the middle of a step (a failing test and `systematic-debugging`) is one line.
4. **Say it in one or two plain sentences**: what it is, why it helps here, where it comes from, and what it installs (use the note under its name: an entry that installs a program says so plainly; a Markdown-only one adds knowledge only). Then each install command alone in its own bash block, one command per block, no leading `$`, so the desktop app shows a Run button. In a session the person can type `/plugin install <plugin>@<marketplace>` instead (inline text, not a block); that opens the plugin's details for review.
5. **Level.** `prerequisite`: say the result will be better with it and ask, in the same sentence, whether to install it first or carry on. `helps`: a one-line tip. Either way the work is not blocked: with no answer, carry on.
6. **The answer.** *Install first*: show the commands, say nothing has been changed yet, say to run them and then `/reload-plugins`, and when the person is back start the step again from the top with the skill present. *Carry on*: start the step at once and do not repeat the offer this session. *Do not ask again*: show the line you would add and, after the yes, append the entry's name to the declined file; with no git directory, just do not offer it again this session.
7. **Never run an install yourself.** The commands are shown; the person runs them, or uses the client's own plugin browser. If one fails, report the command and its output, retry nothing silently and work around nothing by editing settings or permissions. To share a plugin with collaborators, offer to add it to `enabledPlugins` in the project's `.claude/settings.json` only when the person asks: show the exact change first, say it turns the plugin on for them but does not download it (each person runs the install once with `--scope project`), and write it only after a yes.

Candidates for the `deploy` lane:

#### `firebase`

Firebase tools for Claude: Firestore, auth, functions, hosting and storage, including the steps to deploy hosting. Third-party, licence Apache-2.0, from `anthropics/claude-plugins-official`. Fits `setup`, `implement`, `deploy` (lanes), Type `dev`, only when the project has `firebase`. Level: `helps`.
It counts as installed when its tools are among your tools (they start with `mcp__plugin_firebase_firebase__`), or `claude plugin list` shows `firebase@claude-plugins-official`. It installs an MCP server (the `firebase-tools` Node.js program from Google, fetched with npx) that can change your Firebase project when you ask on your computer, from `anthropics/claude-plugins-official`, Anthropic's official marketplace.

```bash
claude plugin install firebase@claude-plugins-official
```

#### `cloudflare`

Cloudflare platform skills and its hosted MCP server for edge functions, Durable Objects and deployments. Third-party, licence Apache-2.0, from `cloudflare/skills`. Fits `setup`, `implement`, `deploy` (lanes), Type `dev`, only when the project has `cloudflare`. Level: `helps`.
Skills for this part: `cloudflare`.
It counts as installed when a skill named `cloudflare` is in the session's skills list, or `claude plugin list` shows `cloudflare@cloudflare`. It installs a connection to Cloudflare's hosted MCP server (no local program; you sign in to use it), plus Markdown skills on your computer, from `cloudflare/skills`, a third-party source, not LaneConductor.

```bash
claude plugin marketplace add cloudflare/skills
```

```bash
claude plugin install cloudflare@cloudflare
```

Stack tags used above:

- `firebase`: `firebase.json` or `.firebaserc`, or Firebase named in conductor/tech-stack.md.
- `cloudflare`: `wrangler.toml`, `wrangler.json` or `wrangler.jsonc`, or Cloudflare named in conductor/tech-stack.md.

1. Read `conductor/deploy.json`.
2. Locate the command for the requested `env` (default: `prod`).
3. After the yes, run the command in the terminal and show its output.
4. Log the output to `conductor/logs/deploy-<env>-<timestamp>.log`.
