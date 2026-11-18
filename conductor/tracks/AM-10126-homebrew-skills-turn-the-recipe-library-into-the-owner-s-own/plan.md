# Track 10126: Homebrew skills: turn the recipe library into the owner's own skills marketplace

The numbered work items are in spec.md (they are the plan). All work happens in the library repository `~/Code/lc-recipes` on the branch `homebrew-skills`, nothing is pushed, and nothing from the library is copied into this public repository.

## Phase 1: Rename and clean the existing skills

- [ ] Task 1: Rename plugin and marketplace to `homebrew-skills`, version 0.2.0, README install and update steps (spec item 1)
- [ ] Task 2: Make the seven convention skills standalone: no connector-tool references, no recipe jargon, the 1,536-character limit kept (item 2)
- [ ] Task 3: Drop `new-project`; turn `extract-recipe` into `capture-solved-problem` (item 3)

## Phase 2: New skills from real references

- [ ] Task 1: The LLM client pattern from the owner's AI projects (item 4)
- [ ] Task 2: OAuth sign-in, cache buster, PWA, Prisma, onboarding: only where a working reference exists; the rest are listed as not found (item 4)

## Phase 3: Tools and docs

- [ ] Task 1: Copy the checker, secret scan, reference resolver and deny-list privacy check into `tools/` with their own package.json (item 5)
- [ ] Task 2: README section "Use with LaneConductor" with a workflow.json `skills` example (item 6)

## Phase 4: Verify and decide where it lives

- [ ] Task 1: `claude plugin validate --strict`, checker clean on every skill, secret grep clean, no remote (item 7)
- [ ] Task 2 (HUMAN): name a private GitHub repository for it (or keep it local), then push; install it with `claude plugin marketplace add` and `claude plugin install homebrew-skills@homebrew-skills` and try one skill in a real session

**Impact**: The conventions the owner wanted recipes for exist as ordinary skills, installable and updatable with the platform's own tools, and LaneConductor only points at them from the lane guides.
