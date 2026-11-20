# Spec: Next base release (AM-10150)

Why it waits: the base plugin `laneconductor` is in Anthropic's directory review at 1.9.11 (track 10148). A new base version creates a new scan and review, and the board and skill-pack work was kept out of it on purpose. After the decision, one base release can carry the items below.

## Requirements

- REQ-1 Advisor catalog: entries for the four stack packs (`laneconductor-nodejs-frontend`, `laneconductor-firebase`, `laneconductor-node-postgres`, `laneconductor-gemini`) in the catalog of the skill advisor (`connector/plugin-extras/recommended-plugins.json`), each with its stack tag; add the tags `postgres` and `gemini` to the stack tags and their detection markers in `suggest-skills`; refresh the checked date. The advisor keeps its rules: at most two offers, our own entries first, never an entry on the declined list, nothing installed without a yes. Pack facts to state: Markdown and template files only, advice never orders, each pack's own version, always-on cost of about 120 to 620 tokens (measured 2026-11-19).
- REQ-2 `skill-from-code` pointer: when `suggest-skills` finds nothing that fits and the problem is then solved, it offers `laneconductor-skill-from-code`. One short line in the command text.
- REQ-3 Settings row: `ops/settings.md` gets `board.auto_update` (default on when a board is stored; only `false` turns it off; the board add-on's Stop hook reads it).
- REQ-4 Ceilings: the commands must not grow, `run.md` stays under 68 KB, the base README stays at or under 900 words; the base keeps no hooks, scripts or servers. Tighten other text to pay for what is added.
- REQ-5 Release with the versions knob (`connector/plugin-extras/versions.json`, key `base`), validate the base with `claude plugin validate --strict` and `--profile directory`, and tell the owner before pushing because it creates a new directory version.

- REQ-6 The `board` command decides by whether the board add-on is installed (owner, 2026-11-20: "this is his intention", and it was the original idea). Add-on installed and no stored board: the command builds and publishes the board at once, stores the URL and opens it, with no question. It then says plainly what is on it: private, a snapshot, the index, plan, spec and test documents of every track that is not done are included, what the privacy scan withheld (by track number and file), and that `board.include_docs: false` turns the documents off. Add-on not installed: the command says only that the laneconductor-board add-on has to be installed first and shows the two install commands (as today). It still asks before the one change to a project file (adding `.laneconductor.json` to `.gitignore` when it is not listed), never shares the board, and never turns `board.include_conversation` on. Text changes: the command text of `board`, `ops/board.md` step 3b and the matching lines in `ops/settings.md`; pay for them under REQ-4. First example: the MakroDash project, where the command only asked "Create a private board for this project?" and created nothing.

## Owner steps (small)

- Add the `agent-skill` topic to the GitHub repository meller/laneconductor (a repository setting).
- Say yes to testing `npx skills add meller/laneconductor --list` (it downloads a third-party tool), and to submitting the repository to the submit-form directories (Smithery, LobeHub, MCPMarket) if wanted.

## Out of scope

The directory submission itself (track 10148); the packs' own content (track 10129, closed).
