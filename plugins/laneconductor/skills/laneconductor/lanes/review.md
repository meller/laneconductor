# review lane: `/laneconductor review N`

Evaluate the implementation against the plan and the product guidelines, post the verdict as a
comment, and route the track. This lane only evaluates: fixing the bugs it finds hides them from
the implement lane's retry loop, so write them up as gaps instead.

0. **Claim the track first.** Write `**Lane**: review` and `**Lane Status**: running` to the
   track's `index.md`. Set `**Lane**` explicitly: when the command is run directly the track may
   not sit in this lane, and the board would show it running in the wrong column. In the same
   edit, clear any existing `**Verdict**` marker, so a run cut short never leaves a stale value.
1. **Load context.**
   - Unless `FRESH_SESSION: false` (review often resumes the session implement used), read
     `plan.md`, `spec.md`, `test.md`, and `product-guidelines.md`, `design-language.md`,
     `deployment-stack.md` where present.
   - Always read `conversation.md` (create it if missing): it shows whether earlier review gaps were addressed and
     whether the human gave specific instructions.
2. **Evaluate** the implementation against the requirements and guidelines.
   - Secrets: no hardcoded secrets or secrets in logs; ADC / Secret Manager used as
     `deployment-stack.md` specifies.
   - If `test.md` exists, run its test commands. A failing test case makes the verdict FAIL.
3. **Post the review** as one dated verdict line in `history.md`, emoji first:
   `- <YYYY-MM-DD HH:MMZ> ✅ REVIEW PASSED` or `- <YYYY-MM-DD HH:MMZ> ⚠️ REVIEW FAILED`. Put the write-up (test summary,
   gaps) in one comment in `conversation.md` (authored `claude`, `>`-prefixed continuation lines), not a second one;
   the history line stays one line, and no status goes into `plan.md` or `spec.md`.
4. **Transition.**
   - Re-read `index.md`'s `**Lane**`. If it is no longer `review` (a human moved the card), leave
     `**Lane**` and `**Lane Status**` alone, keep the step 3 comment (the review is still valid),
     and note in it that the transition was skipped.
   - Otherwise take the move from the workflow: with the connector, `update_track` with
     `outcome: "success"` (PASS) or `"failure"` (FAIL), the target being `valid.next` in
     `get_track`; without it, read `conductor/workflow.json` with the grammar in
     [../ops/lanes-and-statuses.md](../ops/lanes-and-statuses.md) and set `**Lane**` and
     `**Lane Status**` from `lanes.review.on_success` or `on_failure`.
   - **PASS:** apply the success move (this project: `quality-gate:queue`),
     append `## ✅ REVIEWED` to `plan.md`, and in the same edit write `**Verdict**: pass`.
   - **FAIL:** apply the failure move (this project: `implement:queue`), add
     `⚠️ Gaps` to `plan.md`, and in the same edit write `**Verdict**: fail`.
   - Write `**Verdict**` every time, PASS or FAIL: a resolved review is routed from it, not parked.
5. **Close** with the closing message of a lane.

## Offer a missing skill

Before the work, look at what fits this lane and offer what is missing; usually this is silent. The track is the one this command names.

**Offer rule** (full procedure: `/laneconductor:suggest-skills`). Plain text, never a form, never blocking.
- Look first: a skill is installed when it is in the session's skills list, `claude plugin list` (read only), `.claude/skills/` or `~/.claude/skills/`; an older name counts. Then say "you have `<skill>` installed, use it before writing the content" and use it.
- Offer only what is missing and fits this lane, the track's `**Type**` (dev if none) and the stack; else say nothing. At most two, ours first, never twice in a session, never one in `skills.declined` of `.laneconductor.json` (or older `.git/skill-advisor-declined.txt`).
- One or two plain sentences (what, why here, program or only knowledge), each install command alone in its own bash block, no leading `$`.
- `prerequisite`: ask, in the same sentence, whether to install first or carry on; otherwise a one-line tip. No answer: carry on.
- Never run an install yourself: the person runs it, then `/reload-plugins`. "Do not ask again": show the change; on a yes add it there (`.gitignore` first, asked).

Candidates for the `review` lane:

- `laneconductor-parallel`: parallel work: sub-agents per track in worktrees, conflict-checked track writes. Installs an MCP server (a Node.js program) and a scaffold script. It counts as installed when its connector tools exist (`mcp__plugin_laneconductor-parallel_lc__*`), or its agent `laneconductor-parallel:track-runner` is listed. Mention only when several sessions, people or sub-agents write the same tracks, or overwrites are a worry. `claude plugin marketplace add meller/laneconductor`, `claude plugin install laneconductor-parallel@laneconductor`
- `superpowers`: skills requesting-code-review, receiving-code-review. Installs a session-start hook script, plus Markdown skills. `claude plugin install superpowers@claude-plugins-official`
- `pr-review-toolkit`: skills review-pr. Markdown only. `claude plugin install pr-review-toolkit@claude-plugins-official`

## Skills that help here

Suggestions, a second opinion, never an order: if a skill named here is installed (for example from the Superpowers
plugin), consider using it; if not, say so in one line and carry on without it. `requesting-code-review` helps frame what to check and how to report it; `receiving-code-review` helps when feedback arrives and each point needs to be checked before acting on it.

An optional top-level `skills` object in `conductor/workflow.json` may list more under `"review"` (`{ "skills": { "review": ["my-skill"] } }`): use them the same way (if one is missing, say so and continue). Absent, nothing changes. Where a skill's steps or file locations differ from this guide or the track files, those win; take the skill's method, not its output paths.
