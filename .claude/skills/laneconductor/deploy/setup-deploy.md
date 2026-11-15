# setup-deploy generate

Run only when the user asks for it by name (or the `lc setup-deploy` wizard sends you here).

**File-generation phase of `lc setup-deploy`.** The CLI wizard (`lc setup-deploy`) has already:
- Scanned for deployment signals
- Asked the user all questions interactively
- Verified credentials
- Got explicit user confirmation

Your job is **only to generate the files**. Do not ask questions. Do not scan. Do not show a confirmation prompt. Just write the files.

**Read context from `conductor/.setup-deploy-context.json`:**
```json
{
  "components": { "frontend": "...", "backend": "...", "db": "...", "secrets": "..." },
  "environments": ["prod", "staging"],
  "deploy_command": "bash infra/deploy.sh",
  "cicd": false,
  "credentials": { "gcp": "verified (user@example.com)", "firebase": "verified" },
  "existing_signals": ["deploy.sh", "Dockerfile", "firebase.json"],
  "files_to_create": ["conductor/deployment-stack.md", "conductor/deploy.json", ".env.example"],
  "brainstorm_summary": "user: ...\nassistant: ..."
}
```

**If `brainstorm_summary` is present**, use it as the authoritative source for the final configuration — it contains the agreed-upon decisions from the interactive brainstorm. The `components` fields may contain raw user input (including questions); the brainstorm summary has the clarified answers.

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
lc deploy prod  →  [deploy_command] prod
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
   Run: lc deploy prod
   Run: lc deploy staging
```
And list any credentials marked `NOT CONFIGURED` with their setup commands.
