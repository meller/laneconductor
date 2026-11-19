# Track 10129: Public, generic version of the homebrew skills: no private names, paths, repos or commits

Design approach: build the public set outside this repository from the private library of track 10126; scrub with a local deny list, then create a fresh repository with one commit. Nothing is pushed. Depends on 10126.

## Phase 1: Deny list

- [ ] Build the local deny list from the sibling repository names under `~/Code` and every project, site, bucket, secret, GCP project identifier, local path, private repository URL and cited commit hash found in the library text
- [ ] Keep the deny list out of the new tree (never committed); read no `.env` or credential file

## Phase 2: Generic rewrite of the 13 skills

- [ ] Replace named projects with generic wording and identifiers with placeholders (`<shared-project>`, `<product>`, `<site>`)
- [ ] Remove reference citations and any `references` metadata that names a private repository
- [ ] Keep `verified` as a date with the statement "observed in the author's own projects with LaneConductor"
- [ ] Keep every pitfall and incident as a general lesson; drop or state the general rule where a pitfall needs a private detail; invent no claim

## Phase 3: Checker and privacy gate

- [ ] Make the checker in `tools/` accept skills with no references
- [ ] Run the privacy gate with the deny list on the new tree: zero findings
- [ ] Search the whole tree for `/home/`, github.com URLs other than github.com/meller/laneconductor, 7-to-40 hex-character commit-like strings, email addresses, and ports or hosts that identify a private service

## Phase 4: README and plugin metadata

- [ ] README: what it is, install and update, attaching skills to lanes in `conductor/workflow.json`, license
- [ ] Keep the plugin name `homebrew-skills`

## Phase 5: Fresh repository and report

- [ ] Create the fresh git repository at `~/Code/homebrew-skills-public` with a single commit and no history
- [ ] `claude plugin validate --strict` on the plugin and the marketplace
- [ ] Report: what was removed by category and counts, anything that lost value, the verification output

Gate: the owner decides where it is published and under which licence; the implementer pushes nothing.

## Phase 2: After the overlap check (2026-11-19)

- [x] Task 2.1: Rewrite `llm-client-pattern` around TokenTalos (`@meller/tokentalos`, public MIT): name it, install and init, Vertex with ADC through it; remove "tokentalos" from the local deny list for the public set only after the owner agrees (done 2026-11-19 as `llm-through-tokentalos`, owner confirmed TokenTalos is his public project; `verified` stays null until the owner has read it)
- [x] Task 2.2: Fix the stale defaults (done 2026-11-19: vertex-gemini-adc now defaults to the Gemini 3 preview the apps run, from `global`; the image skill names the Gemini 3.1 image models the apps use; the `vertexai: true` vs `enterprise:` question is labelled UNVERIFIED, not resolved): vertex-gemini-adc (model, location, constructor, naming) and vertex-imagen-retry-gcs-fallback (image model default, shared-pool 429 note); verify the `vertexai: true` vs `enterprise:` question
- [x] Task 2.3: Trim vertex-gemini-adc, vertex-imagen-retry-gcs-fallback, shared-gcp-firebase-site (health path, 36-site limit) and capture-solved-problem to their deltas with pointers to the public skills (done 2026-11-19: pointers added everywhere; text cut only in shared-gcp-firebase-site and capture-solved-problem, the Vertex skills are mostly delta already)
- [x] Task 2.4: Small additions (done 2026-11-19): authorized-domain format, per-user responses never cached, `vite:preloadError`, Prisma 7 auto-generate note, Neon pointer
- [x] Task 2.5: Check the `stop-all` target in makefile-local-run by hand (`make -n stop-all`) and fix the suspected `@done` continuation (done 2026-11-19: the bug was real, `sh -n` reported a syntax error; fixed, syntax now OK). Safety headers NOT added: `-e` and `pipefail` would make the template's `lsof` assignment abort when nothing listens; needs a deliberate rewrite
- [x] Task 2.6: Re-run the checker and the privacy gate with the deny list on the changed tree: zero findings (done 2026-11-19: 13 skills, 0 errors, 0 warnings; gate 13 clean, 0 refused)
- [ ] Task 2.7 (HUMAN): the owner agrees the final list and the plugin name
- [ ] Task 2.8: After track 10148's review is decided: build the Markdown-only plugin `laneconductor-skills` from these skills with the generator, add it to the marketplace, update the plugin map and the "three plugins" wording, validate, release
- [ ] Task 2.9: Add the plugin to the skill advisor's catalog for firebase and GCP stacks
- [ ] Task 2.10: Layout for discovery registries: put the source in a root `skills/<name>/SKILL.md` folder of this repository (the layout `npx skills add owner/repo` scans), have the generator copy it into `plugins/laneconductor-skills`, add the install line to the README, and ask the owner to add the `agent-skill` topic to the GitHub repository (a repository setting, the owner's)
- [ ] Task 2.11: After the release, check that `npx skills add meller/laneconductor --list` finds the skills, and optionally submit the repository to the submit-form directories (Smithery, LobeHub, MCPMarket); watch skills.sh for the listing
