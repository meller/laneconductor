# suggest-skills: recommend the right skill at the right moment

`suggest-skills` is the second opinion about skills. A skill is a set of instructions Claude loads when the work calls for it, and Claude
only sees the skills that are installed, so it cannot tell you about one that is missing. LaneConductor knows the lanes, so it
can: it names a skill that fits this lane, this kind of track and this stack, says why and where it comes from, and shows how to
install it. It is not an installer and not a registry: the catalog below is small, dated and checked, and the commands are the
platform's own. Nothing is installed without the person's yes, and this plugin never runs an install itself; it shows the
commands and the person runs them.

## When to use it

- The person types `/laneconductor:suggest-skills`, or asks "which skills would help here", "is there a skill for this", "what should I
  install".
- At the start of a lane (plan, brainstorm, implement, review, quality gate, merge) and before a deploy: each lane guide carries
  the entries that fit it ("Offer a missing skill").
- When the situation matches: a failing test or a bug track (a debugging skill), a review comment to answer, a plan that is
  stuck, a UI, a track that needs an isolated checkout, a request to deploy.
- When a track whose `**Type**` is `marketing`, `sales` or `support` is created, planned or implemented.
- At the end of setup and new-project: a starter set of at most four (see below).
- In `next`: one line, as a tip.

The arguments (all optional):

- nothing: what fits the work in front of you now (the lane and Type of the track in focus, or the project's stack when there is
  none), only what is missing.
- `all`: the whole catalog, grouped by lane, with what is installed marked.
- `dry-run`: the same as nothing, but a rehearsal: print the offer with its commands and change nothing, ask nothing and write
  nothing (no declined list entry, no settings). Use it to see what would be offered.
- a lane name (`plan`, `implement`, `review`, `quality-gate`, `merge`, `deploy`): what fits that lane.

## How it works

1. **Detect what is installed.** See rule 1 below. One look, not a hunt.
2. **Read the stack.** Read `conductor/tech-stack.md` (when it exists) and look for the marker files named under "Stack tags"
   (`firebase.json`, a Vite config, `wrangler.toml` and the like). Read the track's `index.md` for its `**Type**` (`dev` when it has
   none) and its lane, and for a UI track also the plan (screens or pages).
3. **Compare with the catalog** for the lane, the Type and the stack: keep the entries that fit and whose skills are not all
   installed. Leave out any entry the person declined for this project and any you already offered in this session.
4. **Offer at most two**, with the reason and the source, as the rules say. When nothing is missing, say nothing (for the command
   itself: say in one line that nothing is missing).

### The current track

<!-- generated: current track -->

<!-- generated: skill offer rules -->

## After the person says yes

Show the commands (they may already be on screen), say plainly that nothing has been installed yet, and tell the person to run them
and then `/reload-plugins`. When they come back, check that it loaded (the skill is in the skills list, or `claude plugin list`
shows the plugin) and say so; if it did not load, say that and show the output of the failed command if they paste it, never
retry on your own. Then start the step again from the top, now with the skill present.

An install is shown with the default scope. To keep a plugin to this repository only, the person adds `--scope local` to the
install command; for everyone who works in the repository, `--scope project` (then each person runs the install once per clone).
`claude plugin details <name>` shows what an installed plugin adds to every session, after it is installed.

Where the client has its own plugin browser or install card (the desktop app does), you may point at it instead of the commands for
a plugin in the catalog: the person clicks, and nothing is installed without that click.

## The starter set

At the end of setup and new-project, offer three or four from the catalog that fit the project's stack and Type, none already
installed: the core process skills, a design skill when the project has a UI, the stack's pack. Offer them once, with the commands in
their own bash blocks and a one-line reason each. The person installs them now or says later; on "later" nothing is recorded and each
one is offered again at its own moment (when a screen is planned, a deploy is asked for, and so on). The text is in `setup/setup.md`.

## The add-ons are entries like any other

`laneconductor-parallel` and `laneconductor-board` are in the catalog with the same fields and the same offer pattern as the
rest: when the person asks for parallel work, worktrees or a board, offer the add-on the way any entry is offered. There is no special
wording or special case for them.

## The catalog

Entries are public sources only; each was checked to exist and to hold the skills it names on the date shown. A skill listed under an
older name still counts as installed. A catalog goes stale, so when an install fails because a source has moved, say so and show the
fallback below rather than guessing another source.

<!-- generated: skill catalog -->

## Rules

- A second opinion, never an order: every offer says why, and the work goes on whatever the answer.
- Never run an install command. Show it; the person runs it.
- Never edit settings or permissions to make an install work, and never retry a failed install silently.
- Nothing private in an offer: only the catalog's public sources.
