---
description: Set up or run deployment for this project (runs only because you named it)
argument-hint: "[setup]"
---
Deploy: `$ARGUMENTS`. This runs only because I named it; do nothing else with it.

This command carries the skill text it uses, at the end under "Reference". Do not Glob or Read the plugin's install folder (`~/.claude/plugins/...`) to carry it out: that folder is outside the project, and a read there raises a permission question or is denied. The skill file paths named in the command are references only.

Follow `deploy/deploy.md`, or `deploy/setup-deploy.md` when the action is `setup`; both are under "Reference" below. Show me each deploy command before you run it; never deploy without my yes.

## Reference

From the skill files this command names, copied here: whole files, or only the sections the command uses.

### `deploy/deploy.md`

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

###### `firebase`

Firebase tools for Claude: Firestore, auth, functions, hosting and storage, including the steps to deploy hosting. Third-party, licence Apache-2.0, from `anthropics/claude-plugins-official`. Fits `setup`, `implement`, `deploy` (lanes), Type `dev`, only when the project has `firebase`. Level: `helps`.
It counts as installed when its tools are among your tools (they start with `mcp__plugin_firebase_firebase__`), or `claude plugin list` shows `firebase@claude-plugins-official`. It installs an MCP server (the `firebase-tools` Node.js program from Google, fetched with npx) that can change your Firebase project when you ask on your computer, from `anthropics/claude-plugins-official`, Anthropic's official marketplace.

```bash
claude plugin install firebase@claude-plugins-official
```

###### `cloudflare`

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

### `deploy/setup-deploy.md`

Run only when the user asks for it by name. This is a chat procedure: you scan, ask, and then write the files.
It runs nothing that changes anything outside the project, and it never asks for or reads a secret.
Once you know the stack (step 1), offer its deploy pack if it is missing, as `deploy.md` says: one plain offer, never a block.

1. **Scan for deployment signals.** Look for `deploy.sh`, `Dockerfile`, `firebase.json`, `vercel.json`, `infra/`, CI files
   and the hosting hints in `package.json`, and read `conductor/deployment-stack.md` if it exists. Say what you found.
2. **Ask, one question at a time, with a likely default:** which component runs where (frontend, backend, database, secrets),
   the environments (usually `prod`, optionally `staging`), the deploy command (default: the script you found, for example
   `bash infra/deploy.sh`), and whether CI/CD should deploy too.
3. **Credentials.** Ask whether the person is signed in to each provider. You may run a read-only status command (for
   example `gcloud auth list`) after a yes; never ask for, read or write a key or token. Whatever is not signed in is
   marked `NOT CONFIGURED` with the command the person runs themselves.
4. **Show the plan and get a yes.** List the files you will create (`conductor/deployment-stack.md`,
   `conductor/deploy.json`, `.env.example`, and the `.gitignore` additions) and which of them already exist; never overwrite
   one without asking.
5. **Generate the files**, from what you gathered, as below. The gathered facts have this shape:
```json
{
  "components": { "frontend": "...", "backend": "...", "db": "...", "secrets": "..." },
  "environments": ["prod", "staging"],
  "deploy_command": "bash infra/deploy.sh",
  "cicd": false,
  "credentials": { "gcp": "verified (user@example.com)", "firebase": "verified" },
  "existing_signals": ["deploy.sh", "Dockerfile", "firebase.json"]
}
```

**Generate each file listed in `files_to_create`:**

**`conductor/deployment-stack.md`** — Full human-readable topology:
```markdown
# Deployment Stack

## Provider
[derived from components]

## Environments
[list each environment with region/project if detectable]

## Services
- Frontend: [component]
- Backend: [component]
- Database: [component]
- Secrets: [component]

## Authentication
[credentials entry from context — verified ✅ or NOT CONFIGURED]

## Deploy Command
`deploy prod`  →  [deploy_command] prod
```

**`conductor/deploy.json`** — Machine-readable config:
```json
{
  "environments": {
    "prod": { "command": "[deploy_command] prod" },
    "staging": { "command": "[deploy_command] staging" }
  },
  "components": { "frontend": "...", "backend": "...", "db": "...", "secrets": "..." },
  "secrets": {
    "strategy": "[derive from secrets component]",
    "keys": []
  },
  "ci": null
}
```
Set `"ci": null` unless `cicd` is `true` in context (in which case add CI config block).

**`.env.example`** — Required CI env var names only, **never actual values**:
- GCP: `GOOGLE_APPLICATION_CREDENTIALS`, `GCP_PROJECT`, `GCP_REGION`
- Firebase: `FIREBASE_TOKEN` (for CI; locally use ADC)
- Vercel: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`
- AWS: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`
- Supabase: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`
Include only providers relevant to the selected components.

**`.gitignore`** — Append if not already present:
```
.env
*.tfvars
*-key.json
service-account*.json
.vercel
```

**After writing all files, print:**
```
✅ Deployment stack configured!
   Deploy with: ask for `deploy prod` or `deploy staging` (the command runs only after a yes)
```
And list any credentials marked `NOT CONFIGURED` with their setup commands.
