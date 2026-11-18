# Track AM-10130: Setup: add LaneConductor to an existing project (route setup to the existing-repo scaffold, drop the stale install text)

**Lane**: review
**Lane Status**: queue
**Progress**: 90%
**Phase**: Merged and pushed 2026-11-18 (main b36011e8). /laneconductor:setup now means add LaneConductor to this project (existing-repo path of new-project); lc-scaffold --detect reads package.json, README, CI and lint config and proposes only commands that exist (tried read-only on two real projects); the daemon-era install text moved to legacy/; the base ships no worker, daemon or make-install text (grep test); try-local.sh disables clashing installs in the scratch repo only. 341 tests, strict validation pass. Open: the owner runs /laneconductor:setup in a copy of a real project, and a sanity check of two behaviours (the base no longer writes file_sync_queue.md; the legacy lc setup wizard flow still points at setup scaffold generate).
**Track Kind**: bug
**Type**: dev
**Merge Mode**: direct
**Auto Run**: no
**Author**: AM
**Depends On**: 10128
**Problem**: Found 2026-11-18 while answering the owner's question 'does setup support creating the LaneConductor structure for an existing project': `/laneconductor:new-project` already handles it (detects an existing repository, offers only the `conductor/` scaffold, reads package.json, README, source folders and CI or lint config to fill the stack and the quality-gate commands, never overwrites, skips existing files, merges .gitignore, adds no duplicate tracks on a re-run). BUT `/laneconductor:setup` still points at `.claude/skills/laneconductor/setup/setup.md`, whose text is the retired daemon era: `make install`, `~/.laneconductorrc`, symlinking the skill into the project, collection and worker setup. That is wrong for the plugin and sends a person typing `setup` in an existing project down the wrong path.

Do (after track 10128 is merged, because it rewrites the same generated files):
1. Make `setup` mean 'add LaneConductor to this project': the command's procedure follows `ops/new-project.md` (its existing-repository path), with `scaffold` as the explicit action that goes straight to `setup/scaffold.md` and `setup/templates.md`. Keep the 'runs only because you named it' rule and 'tell me what you are about to create or change before you write anything'.
2. Remove the daemon-era content from `setup/setup.md` in the skill source (install with make, the rc file, collection and worker setup, symlinking the skill into the project): keep it only under `legacy/` (which the plugin builds do not ship). The base plugin must not mention `make install`, `~/.laneconductorrc` or a worker.
3. For an existing project make the interview short: infer the project name, stack, test and lint commands from the files and ask only to confirm them; if the repository already has `conductor/tracks` from an older LaneConductor, say what was found and import nothing silently.
4. After the scaffold, the starter-set offer of recommended skills belongs here too (track 10124); leave a clearly marked hook point, do not build it here.
5. Tests: a fixture existing repository (package.json, a README, an npm test script) gets the conductor files with the detected stack and the real test command in quality-gate.md, a second run changes nothing, an existing README or package.json is never touched; a grep test proves no generated text in the base mentions `make install`, `.laneconductor`rc or a worker. Regenerate the plugins, run the tests, `--check` and strict validation.
**Summary**: Found 2026-11-18 while answering the owner's question 'does setup support creating the LaneConductor structure for an existing project': `/laneconductor:new-project` already handles it (detects an exi
