# Working a track ("run track N")

For "run track N", "work on track N" or "take track N through its lanes". Do the work however you
normally would - use sub-agents and worktrees as you see fit. This is a second opinion, not a
rulebook: it says what exists here and what has gone wrong before. If you have a better reason to
do otherwise, do so and say why.

Find the folder as "Finding a track" in the index says. Lane definitions and
transitions are in `conductor/workflow.json`; what each lane means is in `lanes/`: read the lane
file for the lane you are about to run. Keep `**Lane**`, `**Lane Status**`, `**Progress**` and
`**Phase**` in the track's `index.md` true as you go.

## Lessons (each came from a real incident - use judgment)
- Code work happens in a worktree `.worktrees/N` on branch `track-N`, not the primary checkout.
  Docs-only lanes (plan) need no worktree: work in the primary checkout.
- A new track folder is untracked, so a worktree off HEAD cannot see it: commit just that folder
  to main locally first (a worktree is the only reason this is needed; pushing is not).
- Before touching a dirty primary checkout, check for a live process using it as cwd.
- Search the tracks (every lane, backlog and done too) before opening one for a gap you find on the way; if one fits, ask "Update track N (title, lane) with this? [default: yes]" and extend it. See "Search first" in `ops/tracks.md`.
- One session per track. If something else also works the track (another session, an automatic runner), stop and ask.
- Do not run test suites that start background processes from inside a worktree: they can attach
  to the real primary checkout and leak processes. Check for leftovers after any test run.
- Ask before merging or pushing (it is the human's call). Never enter, echo or store secrets.
- Append to `conversation.md` as `> **author**: text` (every line prefixed `> `); anything else
  is silently ignored by sync.
- If a decision is the human's, ask in `conversation.md`, set `**Waiting for reply**: yes`, and stop.

## Plugin users: one subagent per track in a worktree (code tracks)
Only for a code track (`**Type**` `dev`). A non-dev track (marketing, sales, support, other) writes no code: no sub-agent, no
worktree, no question about one; work its lane in this session.

With the laneconductor-parallel add-on installed (Claude Code or Cowork, not chat), dispatch its `laneconductor-parallel:track-runner`
subagent for a code track: one per track, each in its own worktree, so code stays off the primary checkout and tracks do not collide.
Show the agent and one-line prompt first; typing the command is the yes, and "do it here" declines. Independent phases of one track
(different files, no shared output) may each get one; run dependent phases in order. `/laneconductor:run N`, `:implement N` and
`:review N` do this. It never merges or pushes.

Without the add-on, work the lane in this session, or by hand in a worktree: `git worktree add .worktrees/track-N -b track-N`,
a separate session started in that folder, one track per worktree, and never `git add -A` there. Say what the add-on adds
(isolated sub-agents, safe shared state) only if the person asks for parallel work; the commands are in [../ADD-ONS.md](../ADD-ONS.md).
