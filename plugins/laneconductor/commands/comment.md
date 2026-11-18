---
description: Add a comment to a track's conversation
argument-hint: <track number> <comment text>
---
Arguments: `$ARGUMENTS` (track number, then comment text).

This command carries the skill text it uses, at the end under "Reference". Do not Glob or Read the plugin's install folder (`~/.claude/plugins/...`) to carry it out: that folder is outside the project, and a read there raises a permission question or is denied. The skill file paths named in the command are references only.

Add a comment to track <track>: <text>. The procedure is the skill file `ops/tracks.md` (`comment`).

1. Find the track's folder if the number is unclear, then append my words to its `conversation.md` as `> **human**: <my words>` (every further line also starts with `> `); create the file if it is missing.
2. Confirm the entry was added. Do not answer it or change the track unless I ask.

If the laneconductor-parallel add-on's tools are present (`mcp__plugin_laneconductor-parallel_lc__get_track`, `mcp__plugin_laneconductor-parallel_lc__append_conversation`), use them instead of editing the files by hand: they refuse a write when someone edited first (a CONFLICT), so pass `update_track` the `base` from `get_track` and, after a CONFLICT, re-read and retry. If they are not present, the steps above are the whole job.

## Reference

From the skill files this command names, copied here: whole files, or only the sections the command uses.

### `ops/tracks.md` (comment)

#### comment `[track-number] [body]`

Append `> **system**: [body]` (format rules in SKILL.md) to `conductor/tracks/NNN-*/conversation.md`.
Use `⚠️` for something that needs a human and `ℹ️` for
a note. This is also how an agent answers a human comment.

### `SKILL.md` (conversation.md format)

#### conversation.md format

Every entry in `conductor/tracks/NNN-*/conversation.md`, from an agent or a human, must look like:
```
> **author**: First line of the message
> second line, also prefixed with >
```
`author` is `human`, `claude`, `gemini` or `system`. The tools that read it recognize only
`> **author**: ...` lines plus `>`-prefixed continuations. Anything else (a markdown header, a plain
blockquote, loose prose) stays in the file but is silently never synced to the UI, with no error.
For long pasted material (an email, a contract, a redline) keep one opening `> **author**:` line and
prefix every following line, blank ones and markdown headers included, with `>`. Do not drop the
prefix partway because the content reads like a document.
