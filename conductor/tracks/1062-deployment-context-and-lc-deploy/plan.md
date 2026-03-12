# Track 1062: Deployment Context & lc deploy Command

## Phase 1: `deployment-stack.md` Context File & Scaffold Integration

- [ ] Task 1: Add `deployment-stack.md` stub to `/laneconductor setup scaffold` output
    - [ ] Create stub template: "Not configured. Run `lc setup-deploy`."
    - [ ] Add to both Mode A (existing code) and Mode B (new project) scaffold flows
    - [ ] Add to SKILL.md `setup scaffold` section — list `deployment-stack.md` alongside `tech-stack.md`
- [ ] Task 2: Add `deployment-stack.md` to agent context reads
    - [ ] Update `implement` protocol: read `conductor/deployment-stack.md` if present
    - [ ] Update `review` protocol: flag secrets-policy violations using deployment-stack context
    - [ ] Update `quality-gate` protocol: verify secrets policy and infra file existence
- [ ] Task 3: Add `deploy.json` schema definition
    - [ ] Document schema in SKILL.md (template structure, environments, secrets keys)
    - [ ] Create `conductor/deploy.json` stub during `lc setup-deploy`

## Phase 2: `lc setup-deploy` — AI-Guided Wizard

- [ ] Task 1: Add `setup-deploy` command to `bin/lc.mjs`
    - [ ] Parse `lc setup-deploy` — invoke Claude with `/laneconductor setup-deploy` skill command
    - [ ] Check for existing `conductor/deployment-stack.md` + `deploy.json` — offer to reconfigure
- [ ] Task 2: Add `/laneconductor setup-deploy` to SKILL.md
    - [ ] Scan step: detect `deploy.sh`, Makefile `deploy` target, `Dockerfile`, `firebase.json`, `vercel.json`
    - [ ] Ask component questions per layer (frontend / backend / DB / secrets) — one at a time
    - [ ] Support preset names as shorthand (`gcp-full-stack`, `vercel`, etc.)
    - [ ] Support plain-language mix: *"Firebase hosting + Cloud Run + Supabase"*
- [ ] Task 3: Credential verification per component
    - [ ] GCP: run `gcloud auth list`, `gcloud auth application-default print-access-token`
    - [ ] AWS: run `aws sts get-caller-identity`
    - [ ] Vercel: run `vercel whoami`
    - [ ] Supabase: run `supabase projects list`
    - [ ] Firebase: run `firebase projects:list`
    - [ ] Write verified/unverified status into `deployment-stack.md`
    - [ ] Print setup instructions for any unverified provider
- [ ] Task 4: Wrap vs generate deploy commands
    - [ ] If existing `deploy.sh` found: offer to wrap it → `deploy.json environments.prod.command = "bash deploy.sh"`
    - [ ] If new project: Claude generates deploy commands per selected components
    - [ ] Write `conductor/deploy.json` with `environments`, `components`, `secrets.keys`, `ci: null`
- [ ] Task 5: Generate `.env.example`
    - [ ] Per component, emit required CI env var names with explanatory comments
    - [ ] GCP: `GOOGLE_APPLICATION_CREDENTIALS`, `GCP_PROJECT`, `GCP_REGION`
    - [ ] Vercel: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`
    - [ ] Supabase: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`
    - [ ] Never write actual values

## Phase 3: Zero-Secrets Policy Enforcement

- [ ] Task 1: `.gitignore` enforcement in `lc setup-deploy`
    - [ ] Append secrets patterns: `.env`, `*.tfvars`, `*service-account*.json`, `*-key.json`, `.vercel`
    - [ ] Warn if any of these patterns are already tracked by git
- [ ] Task 2: Generate `.env.example` with key names only
    - [ ] Per-template: list required env var names with comments explaining where to get them
    - [ ] Never prompt for or write actual values
- [ ] Task 3: Secrets audit in `quality-gate` protocol
    - [ ] Add check: scan committed files for common secret patterns (API keys, tokens, passwords)
    - [ ] Add check: verify `.gitignore` includes secrets patterns
    - [ ] FAIL quality gate if any hardcoded secrets found

## Phase 4: `lc deploy [env]` — Deploy Command

- [ ] Task 1: Add `deploy` command to `bin/lc.mjs`
    - [ ] Parse `lc deploy [env]` — default env = `prod`
    - [ ] Read `conductor/deploy.json` — error if missing (tell user to run `lc setup-deploy`)
    - [ ] Look up `environments[env].command` and execute
- [ ] Task 2: Deployment execution
    - [ ] Run deploy command with `stdio: inherit` (show output in terminal)
    - [ ] Log output to `conductor/logs/deploy-<env>-<timestamp>.log`
    - [ ] Show elapsed time on completion
    - [ ] Exit with deploy command's exit code
- [ ] Task 3: Help text
    - [ ] Add `lc deploy [env]` to `lc --help` output
    - [ ] Add `lc setup-deploy` to `lc --help` output

## Phase 5: SKILL.md Updates

- [ ] Task 1: Add `setup-deploy` to SKILL.md
    - [ ] Document `/laneconductor setup-deploy` command with template list
    - [ ] Add to Quick Reference table
- [ ] Task 2: Add `deployment-stack.md` to scaffold section
    - [ ] Update `setup scaffold` output list
    - [ ] Add template for `deployment-stack.md`
- [ ] Task 3: Update `implement`, `review`, `quality-gate` protocols
    - [ ] Add deployment-stack.md to context reads
    - [ ] Add secrets policy check to quality-gate

## Phase 6: macrodash Migration (Dogfood)

- [ ] Task 1: Run `lc setup-deploy` on macrodash using GCP Full Stack template
    - [ ] Migrate existing `deploy.sh` → `infra/deploy.sh`
    - [ ] Generate `conductor/deployment-stack.md` from existing setup
    - [ ] Generate `deploy.json` mapping `prod` and `staging` environments
- [ ] Task 2: Verify `lc deploy prod` works end-to-end on macrodash
