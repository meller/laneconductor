# Track AM-10118: Targets: mirror tracks to Jira and other trackers through MCP connectors, on demand, no daemon

**Lane**: backlog
**Lane Status**: queue
**Progress**: 0%
**Phase**: Backlog: direction recorded 2026-11-17 (LaneConductor is the engineering layer under a product tool; one generic target contract, one add-on per tool, Jira first but not now); plan after the new-project flow and the hooks extension
**Track Kind**: feature
**Type**: dev
**Merge Mode**: direct
**Auto Run**: no
**Author**: AM
**Depends On**: 10116
**Problem**: LaneConductor had sync targets (for example Jira: `lc add-target --type jira`, a lane-to-status mapping, polling two-way sync, track 1067). They ran inside the sync daemon, which is stopped, and the legacy guide that documented them is not shipped in the plugin. The idea is still wanted: let a person mirror their tracks into the tracker their team uses.

New shape, no daemon: a target is a mirror that Claude updates through an MCP connector the person already has (an Atlassian/Jira connector, Linear, and so on), on request. Files in git stay the truth; the target is a copy.

Sketch: config in `.laneconductor.json` (`targets: [{ type, connector, project key, lane-to-status mapping, direction }]`, no tokens in the repo; credentials stay with the connector); a command `/laneconductor:sync [target]` that pushes the tracks changed since the last sync (creating or updating one issue per track, keyed by track number, storing the issue key in a track marker), and `/laneconductor:targets` to list, add and map; an optional pull that PROPOSES lane changes from status changes in the tracker and applies them only after the person agrees; a clear conflict rule (both changed: show both, ask); every write to an outside system needs the person's yes; opt-in offer after a lane move once the hooks extension exists. The procedure is Markdown plus the existing mapping idea, so any MCP-capable agent can run it; the legacy token-based Jira auth code is not needed.

Open questions for the plan lane: which connector tools exist for Jira and Linear in the person's setup (check `tools/list`, never guess argument names), how issue keys are stored, whether to reuse `conductor/jira-target.mjs` mapping logic, and what to do with the legacy `lc add-target` commands (document as legacy).

Depends on the command catalog (track 10116). Not for now: parked in the backlog until the new-project flow and the hooks are done.
**Summary**: LaneConductor had sync targets (for example Jira: `lc add-target --type jira`, a lane-to-status mapping, polling two-way sync, track 1067). They ran inside the sync daemon, which is stopped, and the l
