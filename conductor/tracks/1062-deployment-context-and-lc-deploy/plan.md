# Track 1062: Deployment Context & lc deploy Command

## Phase 1: `deployment-stack.md` Context File & Scaffold Integration

- [x] Task 1: Add `deployment-stack.md` stub to `/laneconductor setup scaffold` output
    - [x] Create stub template: "Not configured. Run `lc setup-deploy`."
    - [x] Add to both Mode A (existing code) and Mode B (new project) scaffold flows
    - [x] Add to SKILL.md `setup scaffold` section — list `deployment-stack.md` alongside `tech-stack.md`
- [x] Task 2: Add `deployment-stack.md` to agent context reads
    - [x] Update `implement` protocol: read `conductor/deployment-stack.md` if present
    - [x] Update `review` protocol: flag secrets-policy violations using deployment-stack context
    - [x] Update `quality-gate` protocol: verify secrets policy and infra file existence
- [x] Task 3: Add `deploy.json` schema definition
    - [x] Document schema in SKILL.md (template structure, environments, secrets keys)
    - [x] Create `conductor/deploy.json` stub during `lc setup-deploy`

## Phase 2: `lc setup-deploy` — AI-Guided Wizard

- [x] Task 1: Add `setup-deploy` command to `bin/lc.mjs`
    - [x] Parse `lc setup-deploy` — invoke Claude with `/laneconductor setup-deploy` skill command
    - [x] Check for existing `conductor/deployment-stack.md` + `deploy.json` — offer to reconfigure
- [x] Task 2: Add `/laneconductor setup-deploy` to SKILL.md
    - [x] Scan step: detect `deploy.sh`, Makefile `deploy` target, `Dockerfile`, `firebase.json`, `vercel.json`
    - [x] Ask component questions per layer (frontend / backend / DB / secrets) — one at a time
    - [x] Support preset names as shorthand (`gcp-full-stack`, `vercel`, etc.)
    - [x] Support plain-language mix: *"Firebase hosting + Cloud Run + Supabase"*
- [x] Task 3: Credential verification per component
    - [x] GCP: run `gcloud auth list`, `gcloud auth application-default print-access-token`
    - [x] AWS: run `aws sts get-caller-identity`
    - [x] Vercel: run `vercel whoami`
    - [x] Supabase: run `supabase projects list`
    - [x] Firebase: run `firebase projects:list`
    - [x] Write verified/unverified status into `deployment-stack.md`
    - [x] Print setup instructions for any unverified provider
- [x] Task 4: Wrap vs generate deploy commands
    - [x] If existing `deploy.sh` found: offer to wrap it → `deploy.json environments.prod.command = "bash deploy.sh"`
    - [x] If new project: Claude generates deploy commands per selected components
    - [x] Write `conductor/deploy.json` with `environments`, `components`, `secrets.keys`, `ci: null`
- [x] Task 5: Generate `.env.example`
    - [x] Per component, emit required CI env var names with explanatory comments
    - [x] GCP: `GOOGLE_APPLICATION_CREDENTIALS`, `GCP_PROJECT`, `GCP_REGION`
    - [x] Vercel: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`
    - [x] Supabase: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`
    - [x] Never write actual values

## Phase 3: Zero-Secrets Policy Enforcement

- [x] Task 1: `.gitignore` enforcement in `lc setup-deploy`
    - [x] Append secrets patterns: `.env`, `*.tfvars`, `*service-account*.json`, `*-key.json`, `.vercel`
    - [x] Warn if any of these patterns are already tracked by git
- [x] Task 2: Generate `.env.example` with key names only
    - [x] Per-template: list required env var names with comments explaining where to get them
    - [x] Never prompt for or write actual values
- [x] Task 3: Secrets audit in `quality-gate` protocol
    - [x] Add check: scan committed files for common secret patterns (API keys, tokens, passwords)
    - [x] Add check: verify `.gitignore` includes secrets patterns
    - [x] FAIL quality gate if any hardcoded secrets found

## Phase 4: `lc deploy [env]` — Deploy Command

- [x] Task 1: Add `deploy` command to `bin/lc.mjs`
    - [x] Parse `lc deploy [env]` — default env = `prod`
    - [x] Read `conductor/deploy.json` — error if missing (tell user to run `lc setup-deploy`)
    - [x] Look up `environments[env].command` and execute
- [x] Task 2: Deployment execution
    - [x] Run deploy command with `stdio: inherit` (show output in terminal)
    - [x] Log output to `conductor/logs/deploy-<env>-<timestamp>.log`
    - [x] Show elapsed time on completion
    - [x] Exit with deploy command's exit code
- [x] Task 3: Help text
    - [x] Add `lc deploy [env]` to `lc --help` output
    - [x] Add `lc setup-deploy` to `lc --help` output

## Phase 5: SKILL.md Updates

- [x] Task 1: Add `setup-deploy` to SKILL.md
    - [x] Document `/laneconductor setup-deploy` command with template list
    - [x] Add to Quick Reference table
- [x] Task 2: Add `deployment-stack.md` to scaffold section
    - [x] Update `setup scaffold` output list
    - [x] Add template for `deployment-stack.md`
- [x] Task 3: Update `implement`, `review`, `quality-gate` protocols
    - [x] Add deployment-stack.md to context reads
    - [x] Add secrets policy check to quality-gate

## Phase 6: macrodash Migration (Dogfood)

- [x] Task 1: Run `lc setup-deploy` on macrodash using GCP Full Stack template
    - [x] Migrate existing `deploy.sh` → `infra/deploy.sh`
    - [x] Generate `conductor/deployment-stack.md` from existing setup
    - [x] Generate `deploy.json` mapping `prod` and `staging` environments
- [x] Task 2: Verify `lc deploy prod` works end-to-end on macrodash

## Phase 6: Primary & Secondary Agent Support

- [x] Task 1: Ensure `lc setup-deploy` utilizes the `runAIAgent` fallback mechanism
- [x] Task 2: Update `SKILL.md` to reflect that deployment scaffolding is AI-agnostic
- [x] Task 3: Verify that `**Last Run**` metadata correctly captures fallback agents during setup-deploy

## ✅ COMPLETE

