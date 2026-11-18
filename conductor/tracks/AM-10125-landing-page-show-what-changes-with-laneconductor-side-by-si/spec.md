# Spec: Landing page: show what changes with LaneConductor, side by side (same task, with and without)

## Problem Statement

Decision (human, 2026-11-18): the features are good but people will not understand them unless they see them. The landing page needs a section that shows what happens when you do a piece of work WITH LaneConductor and WITHOUT it, side by side, so the point of skill suggestions, sub-agents, tracks and the board (the dashboard artifact) is obvious at a glance.

## The worked task

One worked task, the same in both columns: "add CSV export to the reports page".
- Without: one long chat; the plan lives only in the conversation; Claude writes code; the next session starts from nothing; nothing is checked against a written spec; no overview of what is in progress.
- With: (1) a track folder appears in the repository with a real spec.md, plan.md and test.md (show real content produced by the connector, not invented text); (2) lane guides suggest the skills that help at each lane (brainstorming before the plan, test-driven development while implementing), as suggestions; (3) a sub-agent per track works the plan in its own git worktree while the main session stays free, and several tracks can run side by side (a simple diagram); (4) review and quality-gate lanes check the work against the spec; (5) the board: a private dashboard generated from the track files, published as a Claude artifact (a real screenshot of the real board page, filled with clearly labelled example data); (6) writes are checked against what each session last read, so two sessions cannot overwrite each other (one short line).

## Requirements

- REQ-1 One section on `landing/index.html`, after the "how it works" part, reusing the page's existing dark theme and CSS variables, with a nav link (`#difference`).
- REQ-2 Six rows, each with a "without" and a "with" cell, covering the six points above: where the plan lives, advice at each lane, who does the work (a simple diagram), checking the work, the overview (board screenshots), two sessions at once.
- REQ-3 Real material only: the demo project is a throwaway git repository OUTSIDE the repo; its tracks are created with the real connector (so spec, plan and test text is authentic) and put in different lanes with `update_track`; the board is generated with `node connector/bin/lc-board.mjs --repo <demo> --site <dir> --json`, served locally and photographed (desktop, and a narrower one if useful). Each image stays under about 300 KB. The CONFLICT output shown is a real one.
- REQ-4 Honesty rules: show only what exists today and works; the skill advisor that recommends and installs skills (track 10124) is not built, so it appears only as a small "planned" note or not at all; no numbers or timings that were not measured; no testimonials; no claim that other products cannot do something; example data is labelled as example data. Do not mention recipes (they were cut, track 10123). Source of truth for claims: docs/why-laneconductor.md and the plugin README.
- REQ-5 Layout: two columns that stack on a phone, no horizontal overflow at 375 px (checked with a script, not by eye), readable contrast, alt text on every image; also verified at desktop width.
- REQ-6 Delivery: built in an isolated git worktree from local main; do not touch `landing/firebase.json` or `landing/posts/`, and do not deploy or push. The change is delivered as a commit on the worktree branch plus a patch file of `landing/index.html` and the new images under `landing/docs/`, because the primary checkout holds another session's uncommitted edits to `landing/index.html` that must not be overwritten.

## Decisions

- 2026-11-18 (human): the landing page shows the same task with and without LaneConductor, side by side (above).
- 2026-11-18 (owner): the next landing change is "install the plugin, run /laneconductor:next, keep progressing". Once `/laneconductor:next` exists (track 10144), the site's main story becomes the journey, not a feature list:
  1. Install the base plugin (one command, shown not run).
  2. Run `/laneconductor:next`. In a project with no conductor folder it offers: continue an existing project (set up the folder around the existing code), start a new project, or look around. At the very start it recommends the add-ons that fit: laneconductor-parallel (parallel execution per plan, each track in its own worktree) and laneconductor-board (the dashboard artifact). Later runs name the next step and explain it.
  3. Show the difference between a normal Claude run and a LaneConductor run for the same task (the with/without section above, already live) and extend it with the journey: what is kept (the design, the plan, the test cases, the decisions, in git, in one organized place), the dashboard, and several plans executing in parallel. The emphasis is: designs are not lost, and work is not designless.
  4. Use real captures only (a real `next` session on the Fiti PLUG demo project and the real board), labelled as examples.
- 2026-11-18 (owner): honesty rules for that change, the same as above plus: do NOT write "nothing else does this" or any claim about other products unless it has been verified and sourced (track 10113 collects verified comparisons; docs/why-laneconductor.md credits Gemini CLI Conductor and Superpowers and compares honestly). Say what LaneConductor does and show it. Do not announce planned or backlog work. Call the daemon/worker tier "experimental, currently unmaintained", never "legacy". Deploy only when the owner says "deploy"; the landing needs the owner's other session to commit its landing edits first, and `next` must exist before this ships.

## Acceptance criteria

Ticked where checked in `main:landing/index.html` and git for this tidy. The width check at 320, 375, 768 and 1360 px was not re-run.

- [x] The section exists after "How it works" with id `difference` and a nav link `#difference` (REQ-1).
- [x] It has six rows, each with a without and a with cell, and the titles match the six points (REQ-2).
- [x] Two board screenshots are committed as WebP under `landing/docs/`, 82 KB and 130 KB (REQ-3).
- [x] Both section images have alt text and explicit width and height; the diagram is an inline SVG with a title and description; example data is labelled (REQ-4, REQ-5).
- [x] The section shows a real-looking CONFLICT answer, the skills-per-lane sentence, and the skill advisor only as a "planned, not built yet" note; no recipes are mentioned in the page (REQ-4).
- [x] `landing/firebase.json` and `landing/posts/` are not in the section's commit (1e464dc4 touches only index.html and the two images) (REQ-6).
- [ ] That the example files, board screenshots and CONFLICT text came from a real connector run on a throwaway project (REQ-3). Not verified by this tidy; the track's own notes say so.
- [ ] No element is wider than the viewport at 320, 375, 768 and 1360 px (REQ-5). Not verified here.
- [ ] The page works in Firefox and Safari engines (REQ-5). Not tested.
- [ ] The owner has read the section on desktop and phone and said deploy; it is deployed from a clean checkout of main (REQ-6). Not done: not deployed.
- [ ] The journey change (install, `/laneconductor:next`, what is kept, the dashboard, parallel plans) is on the page. Not built: the committed page does not mention `/laneconductor:next`.

## Risks and limits

- Firefox and Safari were not tested (Chrome only).
- The screenshots are desktop-width, so their text is small on a phone (each links to the full image).
- The primary checkout holds another session's uncommitted edits to `landing/index.html`; any further landing change must not overwrite them, and the journey change needs that session to commit first.
- The page still carries wording that conflicts with the rules above: a "Planned, not built yet" note on the skill advisor, a "planned" hooks extension, and a "legacy" badge on the daemon tier. See the report to the owner.

## Out of scope

- Deploying (only when the owner says "deploy") and pushing from the worktree.
- `landing/firebase.json` and `landing/posts/`.
- Mentioning recipes, and any claim about other products that has not been verified and sourced.
- Testimonials and unmeasured numbers or timings.
