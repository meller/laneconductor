# Track 10114: Docs and landing page: the plugin, the board, and the new direction

## Phase 1: Installation and migration instructions (the install is completely different now)

- [ ] Task 1: New install section in the root README.md: add the marketplace (`claude plugin marketplace add meller/laneconductor`), install (`claude plugin install laneconductor@laneconductor --scope user`, or `--scope local` for one project), or upload the zip in claude.ai/desktop (Customize > Plugins > Add > Upload plugin); how to check it loaded (`claude plugin list`, `/mcp`); how to update (`claude plugin marketplace update laneconductor`, `/reload-plugins`)
- [ ] Task 2: Say plainly what the old install did and no longer applies: no `make install`, no per-project skill symlink, no daemon or database needed; local scope is per project (a plugin listed from another folder shows as disabled, which is not a fault)
- [ ] Task 3: Migration for an existing project, step by step: install the plugin; open a session and confirm `/mcp` shows `plugin:laneconductor:lc-connector`; remove the project's `.claude/skills/laneconductor` symlink so the skill is not loaded twice; stop that project's worker if one runs (`lc worker stop`)
- [ ] Task 4: What works where: skill in chat, Cowork and Claude Code; local connector in Claude Code and Cowork on the computer only; remote connector not available yet
- [ ] Task 5: Tell users which branch the connector writes on (main, master, or `connector.state_branch`) and that it asks before pushing

## Phase 2: The rest of the docs

- [ ] Task 1: README.md direction note and feature list; conductor/product.md and conductor/tech-stack.md where they still describe the Postgres-and-daemon model
- [ ] Task 2: The board: what it is, `lc board`, "update the board", private artifact, snapshot, track detail, the privacy scan and what is withheld
- [ ] Task 3: The recipe library and its plugin marketplace (state clearly that discovery is still being tested)
- [ ] Task 4: Safety and privacy page: writer rule, conflict checks, `conversation.md` stays per machine, nothing leaves the machine (what the advice log holds)
- [ ] Task 5: The connector README and the plugin README stay in sync (one source: connector/PLUGIN-README.md)

## Phase 3: Landing page (coordinate with the posts program, track 10112, which is editing landing/)

- [ ] Task 1: Agree with 10112 who edits landing/index.html; make changes on a branch and do not overwrite uncommitted work
- [ ] Task 2: Replace the old product description with the plugin story: one install, skill plus connector, board; add an Install section with the commands above; link the docs
- [ ] Task 3: Only claims that are verified; the directory listing, claude.ai chat connector and the remote connector are stated as not available yet unless that changed
- [ ] Task 4: Check mobile and both themes; deploy only when the owner says so

**Impact**: A new user can install the plugin, an existing user can migrate, and nothing on the public pages describes the retired model.
