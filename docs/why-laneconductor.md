# Why LaneConductor

Facts about other products on this page were checked on 2026-11-17 and link to their source. Products change, so
check the source before you rely on a detail.

## The short answer

LaneConductor is for anyone who works with an AI coding agent (today, Claude) and wants to **agree the plan first,
keep it in the repository, and check the work against it**. Each piece of work is a track: a spec, a plan and tests as
plain files in git, worked through lanes (plan, implement, review, quality gate, done), with a board that shows every
track by lane. It runs on your own machine with your own Claude. It needs no tracker and no server.

It is **not** a product-management tool and it is **not** a ticket-to-pull-request agent. It is the layer between
"we decided to build this" and "it is merged", kept as files next to the code.

## Where it comes from

LaneConductor is a combination of two projects, plus a Kanban view:

- **[Conductor](https://github.com/gemini-cli-extensions/conductor)**, a Gemini CLI extension. Its strength is
  conventions: project context kept as Markdown files, and a spec and a plan for every track, so the context survives
  between sessions. The `conductor/` folder layout and the context files (`product.md`, `tech-stack.md`, the workflow
  files) follow it.
- **[Superpowers](https://github.com/obra/superpowers)** by Jesse Vincent (MIT licence), a skills framework for coding
  agents. Its strength is the working process: brainstorm before you build, write the plan, run it step by step with
  sub-agents, verify before you call it done. Portions of LaneConductor's workflow protocols are adapted from it, with
  the attribution notice kept in the skill.
- **Kanban**: the lanes, and a board that shows where every piece of work stands.

When this project started, its author did not find a Conductor for Claude or a Superpowers for Gemini, and wanted both
at once, so this is the combination. That has changed: Conductor now lists Claude Code and Antigravity as supported
hosts, and Superpowers lists Gemini CLI among more than fifteen supported agents (checked 2026-11-17). If you want
either one on its own, use it directly. LaneConductor is the two ideas working together, with lanes, a board and
conflict-checked shared state on top.

## LaneConductor and its sources

Based on each project's README and skill list on 2026-11-17. "Not in its README" means exactly that; it does not mean
the project cannot do it.

| | [Conductor](https://github.com/gemini-cli-extensions/conductor) | [Superpowers](https://github.com/obra/superpowers) | LaneConductor |
|---|---|---|---|
| Context files, and a spec and plan for every track | Yes (its core) | Not in its README | Yes |
| Brainstorm before you build | Not in its README | Yes (its flagship skill) | Yes, adapted from Superpowers |
| Test-driven development | A preference setting | A full skill | Mentioned in the plan and implement steps; no skill of its own |
| Systematic debugging | Not in its README | A skill | **No** |
| Code review | A review command | Skills for requesting and for receiving review | A review lane; nothing for receiving feedback |
| Verify before calling it done | Not in its README | A skill | A quality-gate lane that runs your project's own checks |
| Revert | By track, phase or task | Not in its README | A revert command (its depth is not compared here) |
| Sub-agents and worktrees | Not in its README | Sub-agents per task; a worktrees skill | One sub-agent per track, in its own worktree |
| Merge and deploy | Not in its README | A "finish the branch" skill | A merge lane and deploy procedures |
| **Lanes and a board** | Not in its README | Not in its README | **Yes**: lanes, and a board of every track |
| **Safe shared state** (writes checked against what you last read) | Not in its README | Not in its README | **Yes**, through the local connector |
| **Skills suggested per lane** (the lane guides name the skills that help; you can add your own per lane) | Not in its README | A skill system, but no lane map in its README | **Yes**, as suggestions |
| **New-project interview and scaffold** | Setup command (greenfield and brownfield) | Not in its README | **Yes** |
| Writing new skills | Not in its README | A skill | No |
| Agents supported | Antigravity and Claude Code | More than fifteen | Claude Code and Cowork |

How to read it: Conductor gives the conventions, Superpowers gives the working discipline, and LaneConductor adds the
lanes, the board and the shared state that keeps several sessions from overwriting each other. Where Superpowers is
ahead (debugging, test-driven development, receiving a review), use it **alongside** LaneConductor instead of
expecting LaneConductor to duplicate it. If all you want is context files and a spec and plan per track, use Conductor
directly.

## LaneConductor and product trackers

"Jira" here stands for the whole category of product-management tools (Jira, Linear, Azure DevOps and others). They do
a different job from LaneConductor, so this compares use cases, not features.


| | What it is for | Where the plan lives | Where the work runs | What it needs |
|---|---|---|---|---|
| **A product tracker** (Jira, Linear, Azure DevOps) | The product view: what to build, for whom, in what order, roadmaps and reporting | In the tracker, in the cloud | Not applicable: it tracks work, it does not do it | The tracker account |
| **A tracker's own coding agent** (for example the Jira Coding Agent) | Turn a work item into a draft pull request | In the work item and the prompt you give the agent | In the vendor's cloud sandbox | A paid tracker plan, vendor credits, a connected cloud repository |
| **A tracker's connector for Claude** (for example Atlassian's Rovo MCP server, Azure DevOps's remote MCP server) | Let Claude read and update work items | Stays in the tracker | Your own Claude | Connecting the tracker's connector |
| **Plain Claude Code** | Do the work, with plan mode when you ask for it | In the session, unless you save it | Your machine | Claude Code |
| **LaneConductor** | The engineering view: plan first, build to the plan, review against it, keep the record | **Files in your git repository**, reviewed with the code | **Your machine**, your own Claude | The plugin and Claude Code or Cowork; no tracker, no server |

What the sources say about the others:

- The **Jira Coding Agent** is started from a Jira work item, runs in "a dedicated sandbox environment" that is
  "secure, cloud-based", works on a connected Bitbucket Cloud or GitHub Cloud repository, and can commit to a branch
  and push a draft pull request. It needs AI features, Rovo credits and a Standard or Premium plan, and sessions expire
  after seven days of inactivity. Its documentation describes giving it context with prompts; it does not describe a
  plan document. ([Atlassian support](https://support.atlassian.com/rovo/docs/generate-code-from-a-work-item-in-jira/),
  [overview](https://support.atlassian.com/rovo/docs/work-with-rovo-dev-in-jira/))
- **Atlassian's Rovo MCP server** lets MCP clients such as Claude search, create, update and transition Jira work
  items and add comments, under your own Jira permissions. ([Atlassian](https://www.atlassian.com/blog/rovo/atlassian-rovo-mcp-ga))
- **Azure DevOps's remote MCP server** gives an assistant access to work items, pull requests, pipelines and test
  plans; it was in public preview when checked.
  ([Microsoft Learn](https://learn.microsoft.com/en-us/azure/devops/mcp-server/remote-mcp-server))

## What LaneConductor adds, in one example

Task: "add CSV export to the reports page."

- With a ticket-to-pull-request agent, you write a prompt, the agent writes code, and you review a draft pull request.
  What was decided (which columns, how edge cases behave, what to test) lives in your prompt and your head.
- With LaneConductor, Claude first writes the **spec**, the **plan** and the **tests** as files in the repository. You
  read and fix them before any code exists. Claude then builds to the plan, a separate review step checks the code
  against the spec, and a quality gate runs the tests. All of it stays in git, so another session, or another person,
  can pick the track up tomorrow and see exactly where it stands.

LaneConductor does not write code better than anyone else; it is the same Claude. What it adds is the agreement before
the code, the check afterwards, the record, and shared state across sessions: writes are checked against what you last
read, so two sessions cannot silently overwrite each other.

## Alone, or with a product tracker

- **Small team or one person.** You can use LaneConductor alone. The backlog lane is your product list, a track is a
  feature, the board is the overview, and there is no gap between deciding and doing.
- **Larger team.** When you need roadmaps, stakeholders and priorities across teams, a product tracker takes the
  product view and LaneConductor stays the engineering view. The tracker's connector and LaneConductor's connector work
  side by side in the same Claude session: one brings the product, the other plans and does the technical work.
- **No tracker integration of our own.** LaneConductor does not ship a Jira, Linear or Azure DevOps connector. The
  tracker vendors provide those (see the sources above), and Claude can use them next to LaneConductor in the same
  session, for example "read PROJ-123, then plan it as a track". Nothing here depends on any tracker.

## Who it is for, and who it is not for

**For** anyone who works with an AI coding agent and wants the plan written down, in the repository, before the code:
a solo developer, a small team, or an engineering team that also uses a product tracker.

**Not for:**

- A team whose process lives entirely in Jira (or a similar tool) and that **does not use AI agents**. LaneConductor
  is a way of working with an agent; without one there is nothing for it to do.
- Someone who wants "ticket in, pull request out" with no written plan and nothing to maintain. A tracker's own coding
  agent is built for that, and is probably the better fit.
- Anyone who needs it in claude.ai chat or on a phone today. The local connector and the board script need Claude
  Code or Cowork on your computer; a remote connector does not exist yet.

## Sources

Checked 2026-11-17: [Conductor](https://github.com/gemini-cli-extensions/conductor),
[Superpowers](https://github.com/obra/superpowers),
[Jira Coding Agent: generate code from a work item](https://support.atlassian.com/rovo/docs/generate-code-from-a-work-item-in-jira/),
[Jira Coding Agent overview](https://support.atlassian.com/rovo/docs/work-with-rovo-dev-in-jira/),
[Atlassian Rovo MCP server](https://www.atlassian.com/blog/rovo/atlassian-rovo-mcp-ga),
[Azure DevOps remote MCP server](https://learn.microsoft.com/en-us/azure/devops/mcp-server/remote-mcp-server).
