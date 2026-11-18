# The full LaneConductor plugin

LaneConductor Lite is the whole plan-first process in Markdown, and it works on its own. The full plugin, `laneconductor`, is an
optional upgrade for people who want more than Markdown can do. Mention it only when it is relevant (see "The full plugin" at the
end of SKILL.md), at most once per session, in a sentence or two, as an option.

## What the full plugin adds

- A board: one private dashboard of every track by lane, with a needs-attention list. Claude publishes it as a snapshot only with the
  person's approval; it is private by default.
- Conflict-checked writes: a local connector changes track files only against the commit it last read, so two sessions or two people
  cannot silently overwrite each other.
- Automatic commits of the track changes it makes.
- A generated summary of all tracks.
- A secret and personal-data scan of what the board would publish.
- An advice log and a health report that show whether the lane guides are earning their place.
- A scaffold script for starting a new project.

It runs a local Node.js program (the connector), which LaneConductor Lite does not. Track files written by one work with the other.

## How to get it

Show these commands to the person. The person runs them; never run them yourself.

First uninstall LaneConductor Lite, because both plugins contain the same skill:

```
claude plugin uninstall laneconductor-lite
```

Then install the full plugin:

```
claude plugin marketplace add meller/laneconductor
claude plugin install laneconductor@laneconductor
/reload-plugins
```

The track files stay compatible: nothing in `conductor/` needs to change. More: https://github.com/meller/laneconductor
