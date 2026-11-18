# Tests: Track 10128

- [x] TC-1: `node scripts/build-plugin.mjs --check` is clean for the three plugins and the marketplace file; the marketplace lists base, parallel and board
- [x] TC-2: The base passes the portal-blocking emulation: only allowed file types, no .mcp.json, no package.json or lockfile, no scripts or shebang lines, plugin.json known fields only, agent frontmatter without `isolation`, README over 40 words, LICENSE present, every file under 256 KiB, at most 512 files
- [x] TC-3: All three pass `claude plugin validate --strict`; no two register the same command or skill name
- [ ] TC-4: The base alone: every command runs by editing the track files; the board commands show the install commands for the board add-on; the funnel text appears only where relevant and never tells Claude to run an install
- [x] TC-5: Base + parallel: the connector answers over stdio under the new prefix; the base's commands use it; the base does not recommend the add-on
- [x] TC-6: Base + board: the board script is found by the base's board command and produces a board from the track files without the connector
- [x] TC-7: A project whose workflow.json uses `planning` and `in-progress`: `update_track` with `implement` or `in_progress` fails with a suggestion of the valid name; `get_track` and `get_context` list the valid lanes and statuses
- [x] TC-8: The connector logs the reason when it exits or hits an uncaught error, and keeps serving after a tool-level error
- [x] TC-9: The generated READMEs contain the install commands and the migration note; no hard-coded command count in public text
- [ ] TC-10 (HUMAN, the owner's check): install all three from the local marketplace on the owner's computer, in a scratch repository: `/laneconductor:help` lists the commands; `/laneconductor:plan` on a new track works; the connector tools are present and a write is conflict-checked; `/laneconductor:board` builds and publishes the board; with the add-ons installed the base recommends nothing; uninstall an add-on, restart the session, and the base mentions it once when relevant and shows the commands
- [ ] TC-11 (HUMAN): the portal's Validate on `plugins/laneconductor` has no blocking issues
