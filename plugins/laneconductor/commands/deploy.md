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

Before step 1, offer the stack's deploy pack if it is missing (usually silent, never blocking):

**Offer rule** (full procedure: `/laneconductor:suggest-skills`). Plain text, never a form, never blocking.
- Look first: a skill is installed when it is in the session's skills list, `claude plugin list` (read only), `.claude/skills/` or `~/.claude/skills/`; an older name counts. Then say "you have `<skill>` installed, use it before writing the content" and use it.
- Offer only what is missing and fits this lane, the track's `**Type**` (dev if none) and the stack; else say nothing. At most two, ours first, never twice in a session, never one in `skills.declined` of `.laneconductor.json` (or older `.git/skill-advisor-declined.txt`).
- One or two plain sentences (what, why here, program or only knowledge), each install command alone in its own bash block, no leading `$`.
- `prerequisite`: ask, in the same sentence, whether to install first or carry on; otherwise a one-line tip. No answer: carry on.
- Never run an install yourself: the person runs it, then `/reload-plugins`. "Do not ask again": show the change; on a yes add it there (`.gitignore` first, asked).

Candidates for the `deploy` lane (stack tags: firebase, cloudflare):

- `firebase` (stack firebase): Firebase tools: Firestore, auth, functions, hosting, and hosting deploys. Installs an MCP server (firebase-tools, via npx) that can change your Firebase project. `claude plugin install firebase@claude-plugins-official`
- `cloudflare` (stack cloudflare): skills cloudflare. Installs a connection to Cloudflare's hosted MCP server, plus skills. `claude plugin marketplace add cloudflare/skills`, `claude plugin install cloudflare@cloudflare`

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
