# Spec: Landing page: show what changes with LaneConductor, side by side (same task, with and without)

## Problem Statement

Decision (human, 2026-11-18): the features are good but people will not understand them unless they see them. The landing page needs a section that shows what happens when you do a piece of work WITH LaneConductor and WITHOUT it, side by side, so the point of skill suggestions, sub-agents, tracks and the board (the dashboard artifact) is obvious at a glance.

One worked task, the same in both columns: "add CSV export to the reports page".
- Without: one long chat; the plan lives only in the conversation; Claude writes code; the next session starts from nothing; nothing is checked against a written spec; no overview of what is in progress.
- With: (1) a track folder appears in the repository with a real spec.md, plan.md and test.md (show real content produced by the connector, not invented text); (2) lane guides suggest the skills that help at each lane (brainstorming before the plan, test-driven development while implementing), as suggestions; (3) a sub-agent per track works the plan in its own git worktree while the main session stays free, and several tracks can run side by side (a simple diagram); (4) review and quality-gate lanes check the work against the spec; (5) the board: a private dashboard generated from the track files, published as a Claude artifact (a real screenshot of the real board page, filled with clearly labelled example data); (6) writes are checked against what each session last read, so two sessions cannot overwrite each other (one short line).

Honesty rules: show only what exists today and works; the skill advisor that recommends and installs skills (track 10124) is not built, so it appears only as a small "planned" note or not at all; no numbers or timings that were not measured; no testimonials; no claim that other products cannot do something; example data is labelled as example data. Do not mention recipes (they were cut, track 10123). Source of truth for claims: docs/why-laneconductor.md and the plugin README.

Build: in an isolated git worktree from local main, edit landing/index.html (reuse its existing dark theme and CSS variables; place the section after the "how it works" part, decide the exact spot) and add images under landing/docs/. The demo project is a throwaway git repository OUTSIDE the repo: create its tracks with the real connector (so spec, plan and test text is authentic), put them in different lanes with update_track, generate the board with `node connector/bin/lc-board.mjs --repo <demo> --site <dir> --json`, serve it locally and take real screenshots (desktop, and a narrower one if useful). Keep each image under about 300 KB. Layout: two columns that stack on a phone, no horizontal overflow at 375 px (check with a script, not by eye), readable contrast, alt text on every image. Also verify the page at desktop width. Do not touch landing/firebase.json or landing/posts/ and do not deploy or push: deliver the finished change as a commit on the worktree branch plus a patch file of landing/index.html and the new images, because the primary checkout holds another session's uncommitted edits to landing/index.html that must not be overwritten.

## Next landing change (owner, 2026-11-18): "install the plugin, run /laneconductor:next, keep progressing"

Once `/laneconductor:next` exists (track 10144), the site's main story becomes the journey, not a feature list:
1. Install the base plugin (one command, shown not run).
2. Run `/laneconductor:next`. In a project with no conductor folder it offers: continue an existing project (set up the folder around the existing code), start a new project, or look around. At the very start it recommends the add-ons that fit: laneconductor-parallel (parallel execution per plan, each track in its own worktree) and laneconductor-board (the dashboard artifact). Later runs name the next step and explain it.
3. Show the difference between a normal Claude run and a LaneConductor run for the same task (the with/without section above, already live) and extend it with the journey: what is kept (the design, the plan, the test cases, the decisions, in git, in one organized place), the dashboard, and several plans executing in parallel. The emphasis is: designs are not lost, and work is not designless.
4. Use real captures only (a real `next` session on the Fiti PLUG demo project and the real board), labelled as examples.

Honesty rules for this change, same as above plus: do NOT write "nothing else does this" or any claim about other products unless it has been verified and sourced (track 10113 collects verified comparisons; docs/why-laneconductor.md credits Gemini CLI Conductor and Superpowers and compares honestly). Say what LaneConductor does and show it. Do not announce planned or backlog work. Call the daemon/worker tier "experimental, currently unmaintained", never "legacy". Deploy only when the owner says "deploy"; the landing needs the owner's other session to commit its landing edits first, and `next` must exist before this ships.

## The need

(To be filled in.)

## Who it is for

(To be filled in.)

## Wanted outcome

(To be filled in.)

## Acceptance criteria

(To be filled in.)

## Out of scope

(To be filled in.)
