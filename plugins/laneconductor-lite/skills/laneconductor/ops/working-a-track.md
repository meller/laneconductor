# Working a track ("run track N")

For "run track N", "work on track N" or "take track N through its lanes". Do the work however you
normally would - use sub-agents and worktrees as you see fit. This is a second opinion, not a
rulebook: it says what exists here and what has gone wrong before. If you have a better reason to
do otherwise, do so and say why.

Find the folder with `lc track-dir N` (see "Finding a track" in the index). Lane definitions and
transitions are in `conductor/workflow.json`; what each lane means is in `lanes/`: read the lane
file for the lane you are about to run. Keep `**Lane**`, `**Lane Status**`, `**Progress**` and
`**Phase**` in the track's `index.md` true as you go.

## Lessons (each came from a real incident - use judgment)
- Code work happens in a worktree `.worktrees/N` on branch `track-N`, not the primary checkout.
  Docs-only lanes (plan) need no worktree: work in the primary checkout.
- A new track folder is untracked, so a worktree off HEAD cannot see it: commit just that folder
  to main locally first (a worktree is the only reason this is needed; pushing is not).
- Before touching a dirty primary checkout, check for a live process using it as cwd.
- One worker per track. If a sync daemon is running and the track has `**Auto Run**: yes`, it may
  also claim it.
- Do not run worker-spawning or mock-CLI test suites from inside a worktree: they can register
  against the real primary checkout and database, and leak processes.
- Ask before merging or pushing (it is the human's call). Never enter, echo or store secrets.
- Append to `conversation.md` as `> **author**: text` (every line prefixed `> `); anything else
  is silently ignored by sync.
- If a decision is the human's, ask in `conversation.md`, set `**Waiting for reply**: yes`, and stop.

## Plugin users: one subagent per track in a worktree
With the LaneConductor plugin (Claude Code or Cowork, not chat), the `laneconductor-lite:track-runner`
subagent is the recommended way to work a track: one subagent per track, each in its own worktree,
so code stays off the primary checkout, tracks run in parallel and do not collide. Recommend it and
show the exact dispatch (agent name and one-line prompt); start nothing until the human says yes.
`/laneconductor-lite:run N`, `:implement N` and `:review N` do this. It never merges or pushes.
