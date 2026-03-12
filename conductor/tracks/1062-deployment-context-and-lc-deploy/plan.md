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

## Phase 2: `lc setup-deploy` — Interactive Wizard (CLI)

- [ ] Task 1: Add `setup-deploy` command to `bin/lc.mjs`
    - [ ] Parse `lc setup-deploy` command
    - [ ] Check for existing `conductor/deployment-stack.md` and `deploy.json` — offer to re-configure if found
    - [ ] Detect existing deploy scripts (deploy.sh, Makefile `deploy` target) — offer to migrate
- [ ] Task 2: Template selection prompt
    - [ ] Display 6 templates with descriptions
    - [ ] Dispatch to template-specific setup function
- [ ] Task 3: Implement template: **Firebase Full** (Hosting + Functions)
    - [ ] Prompt: project ID, region, hosting site name
    - [ ] Generate `firebase.json`, `.firebaserc` stubs
    - [ ] Generate `infra/` with deploy script calling `firebase deploy`
    - [ ] ADC note: `firebase login` for local, CI uses service account via env var (not stored)
- [ ] Task 4: Implement template: **GCP Cloud Run**
    - [ ] Prompt: project ID, region, service name, registry path
    - [ ] Generate `infra/deploy.sh` (docker build + push + gcloud run deploy)
    - [ ] ADC note: `gcloud auth application-default login` for local, Workload Identity for CI
- [ ] Task 5: Implement template: **AWS Lambda**
    - [ ] Prompt: region, function name, S3 bucket for assets
    - [ ] Generate `infra/deploy.sh` using AWS CLI / SAM
    - [ ] ADC equivalent: `aws configure` / IAM role assumption via `AWS_PROFILE`
- [ ] Task 6: Implement template: **Vercel**
    - [ ] Prompt: project name, team slug (optional)
    - [ ] Generate `vercel.json` stub
    - [ ] ADC equivalent: `vercel login` for local, `VERCEL_TOKEN` env var for CI (never stored)
- [ ] Task 7: Implement template: **Supabase**
    - [ ] Prompt: project ref, DB region
    - [ ] Generate `supabase/config.toml` stub
    - [ ] ADC equivalent: `supabase login` for local, access token via env var for CI
- [ ] Task 8: Implement template: **GCP Full Stack** (Cloud Run + Firebase + Cloud SQL + Secret Manager)
    - [ ] Compose Cloud Run + Firebase Full templates
    - [ ] Add Cloud SQL connection config (via Cloud SQL Auth Proxy, no password in files)
    - [ ] Add Secret Manager usage example in generated README

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
