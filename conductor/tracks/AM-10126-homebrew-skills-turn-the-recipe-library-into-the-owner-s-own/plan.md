# Track 10126: Homebrew skills: turn the recipe library into the owner's own skills marketplace

The numbered work items are in spec.md. All work happened in the library repository `~/Code/lc-recipes` (now merged to its local main), nothing was pushed, and nothing from the library was copied into this public repository.

## Phase 1: Rename and clean the existing skills

- [x] Task 1: Renamed plugin and marketplace to `homebrew-skills`, version 0.2.0; `recipes/` became `skills/`; README install and update steps
- [x] Task 2: The seven convention skills are standalone (no connector-tool references, no recipe jargon, the 1,536-character limit kept)
- [x] Task 3: `new-project` dropped; `extract-recipe` became `capture-solved-problem`

## Phase 2: New skills from real references

- [x] Task 1: `llm-client-pattern` (the gateway shape of the owner's AI projects)
- [x] Task 2: `firebase-google-sign-in`, `cache-buster`, `pwa-vite-workbox`, `prisma-in-cloud-functions` (each cites working references at a commit, verified 2026-11-18). Onboarding left out: no shared convention exists, each product's flow is different

## Phase 3: Tools and docs

- [x] Task 1: `tools/` with the checker, secret scan, reference resolver and deny-list privacy gate (own package.json, 5 tests)
- [x] Task 2: README "Use with LaneConductor" with a workflow.json `skills` example

## Phase 4: Verify and decide where it lives

- [x] Task 1: `claude plugin validate --strict` passes; checker 13 skills, 0 errors, 0 warnings; secret and email grep clean; no remote
- [ ] Task 2 (HUMAN): name a private GitHub repository for it (or keep it local), then push; install with `claude plugin marketplace add ~/Code/lc-recipes` (or `<owner>/<repo>`) and `claude plugin install homebrew-skills@homebrew-skills`, and try one skill in a real session

**Impact**: The conventions the owner wanted recipes for exist as ordinary skills, installable and updatable with the platform's own tools, and LaneConductor only points at them from the lane guides.
