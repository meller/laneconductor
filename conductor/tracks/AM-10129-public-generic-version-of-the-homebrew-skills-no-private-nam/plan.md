# Track 10129: Public, generic version of the homebrew skills: no private names, paths, repos or commits

Design approach: build the public set outside this repository from the private library of track 10126; scrub with a local deny list, then create a fresh repository with one commit. Nothing is pushed. Depends on 10126.

## Phase 1 (the original design: a separate public repository; all of it was done in ~/Code/homebrew-skills-public and then SUPERSEDED on 2026-11-19 by moving the skills into this repository and shipping five plugins; ticked as superseded, not as delivered by this track): Deny list

- [~] Build the local deny list from the sibling repository names under `~/Code` and every project, site, bucket, secret, GCP project identifier, local path, private repository URL and cited commit hash found in the library text
- [~] Keep the deny list out of the new tree (never committed); read no `.env` or credential file

## Phase 2: Generic rewrite of the 13 skills

- [~] Replace named projects with generic wording and identifiers with placeholders (`<shared-project>`, `<product>`, `<site>`)
- [~] Remove reference citations and any `references` metadata that names a private repository
- [~] Keep `verified` as a date with the statement "observed in the author's own projects with LaneConductor"
- [~] Keep every pitfall and incident as a general lesson; drop or state the general rule where a pitfall needs a private detail; invent no claim

## Phase 3: Checker and privacy gate

- [~] Make the checker in `tools/` accept skills with no references
- [~] Run the privacy gate with the deny list on the new tree: zero findings
- [~] Search the whole tree for `/home/`, github.com URLs other than github.com/meller/laneconductor, 7-to-40 hex-character commit-like strings, email addresses, and ports or hosts that identify a private service

## Phase 4: README and plugin metadata

- [~] README: what it is, install and update, attaching skills to lanes in `conductor/workflow.json`, license
- [~] Keep the plugin name `homebrew-skills`

## Phase 5: Fresh repository and report

- [~] Create the fresh git repository at `~/Code/homebrew-skills-public` with a single commit and no history
- [~] `claude plugin validate --strict` on the plugin and the marketplace
- [~] Report: what was removed by category and counts, anything that lost value, the verification output

Gate: the owner decides where it is published and under which licence; the implementer pushes nothing.

## Phase 2: After the overlap check (2026-11-19)

- [x] Task 2.1: Rewrite `llm-client-pattern` around TokenTalos (`@meller/tokentalos`, public MIT): name it, install and init, Vertex with ADC through it; remove "tokentalos" from the local deny list for the public set only after the owner agrees (done 2026-11-19 as `llm-through-tokentalos`, owner confirmed TokenTalos is his public project; `verified` stays null until the owner has read it)
- [x] Task 2.2: Fix the stale defaults (done 2026-11-19: vertex-gemini-adc now defaults to the Gemini 3 preview the apps run, from `global`; the image skill names the Gemini 3.1 image models the apps use; the `vertexai: true` vs `enterprise:` question is labelled UNVERIFIED, not resolved): vertex-gemini-adc (model, location, constructor, naming) and vertex-imagen-retry-gcs-fallback (image model default, shared-pool 429 note); verify the `vertexai: true` vs `enterprise:` question
- [x] Task 2.3: Trim vertex-gemini-adc, vertex-imagen-retry-gcs-fallback, shared-gcp-firebase-site (health path, 36-site limit) and capture-solved-problem to their deltas with pointers to the public skills (done 2026-11-19: pointers added everywhere; text cut only in shared-gcp-firebase-site and capture-solved-problem, the Vertex skills are mostly delta already)
- [x] Task 2.4: Small additions (done 2026-11-19): authorized-domain format, per-user responses never cached, `vite:preloadError`, Prisma 7 auto-generate note, Neon pointer
- [x] Task 2.5: Check the `stop-all` target in makefile-local-run by hand (`make -n stop-all`) and fix the suspected `@done` continuation (done 2026-11-19: the bug was real, `sh -n` reported a syntax error; fixed, syntax now OK). Safety headers NOT added: `-e` and `pipefail` would make the template's `lsof` assignment abort when nothing listens; needs a deliberate rewrite
- [x] Task 2.6: Re-run the checker and the privacy gate with the deny list on the changed tree: zero findings (done 2026-11-19: 13 skills, 0 errors, 0 warnings; gate 13 clean, 0 refused)
- [x] Task 2.7 (HUMAN): the owner agrees the final list and the plugin name (done 2026-11-19: five plugins by technology, see the spec's decision section)
- [~] Task 2.8: superseded by Phase 3 (five plugins instead of one `laneconductor-skills`)
- [~] Task 2.9: superseded by task 3.7 (advisor catalog entries for the packs)
- [x] Task 2.10: Layout for discovery registries. DONE 2026-11-19 (commit 5b508e35): the 13 skills are in the root `skills/<name>/SKILL.md` folder, the checker and privacy gate in `skills-tools/`, the guide in `docs/skills.md`; checker 0/0, gate 13 clean, 841 tests, drift check and four validations pass, nothing under `plugins/` changed. STILL OPEN: have the generator copy `skills/` into `plugins/laneconductor-skills`, add the install line to the README, and ask the owner to add the `agent-skill` topic to the GitHub repository (a repository setting, the owner's)
- [ ] Task 2.11: After the release, check that `npx skills add meller/laneconductor --list` finds the skills, and optionally submit the repository to the submit-form directories (Smithery, LobeHub, MCPMarket); watch skills.sh for the listing

## Phase 3: Five plugins, by technology (decided 2026-11-19)

- [x] Task 3.1: `llm-through-tokentalos` verified 2026-11-19 by the agent, because the owner chose to trust it instead of reading it: every claim was checked against TokenTalos 1.4.1's own code (processor, engine defaults, db pool, thinking level, changelog) and the real use in Otralingo, Ekuilibrium, CoachAI and the Macrodash sidecar; the privacy options and the minimal setup were added; `verified: 2026-11-19`. Released as laneconductor-gemini 0.1.1
- [x] Task 3.2: Pack list: a small file in `skills/` (or beside the generator) mapping each plugin to its skills, exactly as in the spec table; the generator fails if a skill is in no pack or in two (done 2026-11-19: `scripts/skill-packs.json` beside the generator, not in `skills/`, so `npx skills add` sees only skill folders; `readPacks` fails with a clear message for a skill in no pack, in two packs, or a pack naming a missing skill; tested)
- [x] Task 3.3: Generator: build `plugins/<pack>/` for each of the five (Markdown only): `.claude-plugin/plugin.json` (name, displayName, version, author, license Elastic-2.0, repository, homepage, keywords, privacyPolicyUrl), the pack's skill folders copied from `skills/` (including `files/`), a generated README (what is in the pack, install and update, the add-on-style note that it is advice, never an order) and the LICENSE; update `--check` so it covers them (done 2026-11-19: new `scripts/build-skill-packs.mjs`, hooked into `build-plugin.mjs` by one import, the marketplace, the plugin map and the output map; `--check` covers the five packs through the existing drift comparison; each pack: manifest, icon, skill folders byte-identical, README under 400 words, LICENSE; strict validation passes on all five)
- [x] Task 3.4: Marketplace and docs: five entries in `.claude-plugin/marketplace.json`; `docs/plugin-map.md` lists the packs; the root README gets a short section; the base plugin's README is NOT touched (word limit, under review) (done 2026-11-19: five entries with their own version in the marketplace file, a Skill packs section in `docs/plugin-map.md`, a Skill packs table in the root README; the base README, its generator template and the advisor catalog untouched)
- [x] Task 3.5: Tests: every skill is in exactly one pack; each plugin passes `claude plugin validate --strict`; none carries a script, hook, `.mcp.json` or `isolation` key; the skills checker and the privacy gate still pass on `skills/`; the existing suite stays green (done 2026-11-19: `connector/test/skill-packs.test.mjs`, 17 tests; checker 13 skills 0 errors 0 warnings; privacy gate run WITHOUT the private deny list, so names were not checked: 13 clean; full suite 858 green; the existing tests that listed three plugins were updated to eight)
- [ ] Task 3.6: Advisor catalog, in the NEXT base release (the base is under review): entries for the four stack packs with their stack tags (add `postgres` and `gemini` to the stack tags and the detection markers), and one line in `suggest-skills`: when nothing fits and the problem is then solved, offer `laneconductor-skill-from-code`; keep "at most two offers" and the declined list
- [x] Task 3.7: Release (done 2026-11-19, by the owner's word, all five packs at 0.1.0; the base is untouched, so it no longer waits for the directory decision on track 10148). NOTE: `llm-through-tokentalos` shipped as a DRAFT (`verified: null`); task 3.1 is still open: the owner reads it and the next pack version sets its `verified` date
- [x] Task 3.8: clean-profile install check done 2026-11-19 from the CLI (the owner chose the CLI or skip): in an empty config directory `claude plugin marketplace add meller/laneconductor` and `claude plugin install` of all five packs succeeded; each is enabled at the right version (gemini 0.1.1, the others 0.1.0); `claude plugin details` shows each pack's skills and no agents, hooks, MCP servers or LSP servers; always-on cost per pack about 312 (frontend), 433 (firebase), 624 (node-postgres), 481 (gemini) and 121 (skill-from-code) tokens, about 1,970 if all five are installed; hidden template files (.firebaserc.tmpl, .env.example.tmpl) arrived. Not done: a session that actually invokes a skill (needs a signed-in profile)
- [ ] Task 3.9: After the release: install lines in the root README; ask the owner to add the `agent-skill` topic to the GitHub repository; check `npx skills add meller/laneconductor --list` (only with the owner's yes, it downloads a third-party tool); optionally submit the repository to the submit-form directories (Smithery, LobeHub, MCPMarket)
