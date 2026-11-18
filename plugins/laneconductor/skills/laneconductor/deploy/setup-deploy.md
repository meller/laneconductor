# setup-deploy generate

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
