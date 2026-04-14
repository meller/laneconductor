# Tests: Track 1062 — Deployment Context & lc deploy Command

## Test Commands

```bash
# Syntax check lc.mjs after changes
node --check bin/lc.mjs

# Run existing e2e tests (must stay green)
node conductor/tests/local-fs-e2e.test.mjs
node conductor/tests/worker-mode.test.mjs

# Run new deployment tests
node conductor/tests/track-1062-deploy.test.mjs
```

## Test Cases

### Phase 1: deployment-stack.md scaffold

- [ ] TC-1: `lc setup scaffold` on a new project creates `conductor/deployment-stack.md` stub
    - expected: file exists with "Not configured. Run `lc setup-deploy`." text
- [ ] TC-2: `conductor/deployment-stack.md` does NOT overwrite existing file during scaffold
    - expected: existing content preserved when file already exists

### Phase 2: lc setup-deploy wizard

- [ ] TC-3: `lc setup-deploy` without args shows template selection menu
    - expected: exits non-zero if no template selected (interactive TTY only)
- [ ] TC-4: `lc setup-deploy --template gcp-cloud-run` generates `conductor/deployment-stack.md`
    - expected: file contains Provider=GCP, Services includes Cloud Run
- [ ] TC-5: `lc setup-deploy --template gcp-cloud-run` generates `conductor/deploy.json`
    - expected: valid JSON with `environments.prod.command` set
- [ ] TC-6: `lc setup-deploy --template firebase-full` generates `firebase.json` stub
    - expected: `firebase.json` exists in project root or `infra/`
- [ ] TC-7: Re-running `lc setup-deploy` on project with existing config prompts to reconfigure
    - expected: prints warning and asks confirmation before overwriting
- [ ] TC-8: Detects existing `deploy.sh` and offers migration
    - expected: prints "Found existing deploy.sh — migrate to deploy.json? [y/N]"

### Phase 3: Zero-secrets policy

- [ ] TC-9: `lc setup-deploy` adds secrets patterns to `.gitignore`
    - expected: `.gitignore` contains `.env`, `*.tfvars`, `*service-account*.json`
- [ ] TC-10: `.env.example` is generated with key names but no values
    - expected: file exists, no `=<value>` with actual secrets (only `KEY_NAME=` or `KEY_NAME=your-value-here`)
- [ ] TC-11: Generated files contain no hardcoded credentials
    - expected: grep for common secret patterns returns no matches in generated files

### Phase 4: lc deploy command

- [ ] TC-12: `lc deploy` without `deploy.json` prints helpful error
    - expected: "No deploy.json found. Run `lc setup-deploy` first."
- [ ] TC-13: `lc deploy prod` reads `deploy.json` and executes `environments.prod.command`
    - expected: command is executed, exit code matches deploy command exit code
- [ ] TC-14: `lc deploy staging` executes staging command from `deploy.json`
    - expected: correct environment command used
- [ ] TC-15: `lc deploy` creates log file at `conductor/logs/deploy-prod-<timestamp>.log`
    - expected: log file exists and contains deploy output
- [ ] TC-16: `lc deploy unknownenv` prints helpful error
    - expected: "Environment 'unknownenv' not found in deploy.json. Available: prod, staging"

### Phase 5: SKILL.md

- [ ] TC-17: `setup-deploy` appears in SKILL.md Quick Reference table
- [ ] TC-18: `deployment-stack.md` listed in scaffold output section
- [ ] TC-19: `implement` protocol section mentions reading `deployment-stack.md`

### Phase 6: macrodash dogfood

- [ ] TC-20: macrodash `conductor/deployment-stack.md` accurately describes Cloud Run + Firebase setup
- [ ] TC-21: `lc deploy prod` on macrodash triggers existing deploy.sh successfully

## Acceptance Criteria

- [ ] All 21 test cases pass
- [ ] `node --check bin/lc.mjs` passes (no syntax errors)
- [ ] Existing e2e tests still pass (no regression)
- [ ] No secrets or credentials written to any file during `lc setup-deploy`
- [ ] `conductor/deployment-stack.md` is read by AI agents during implement/review/quality-gate
