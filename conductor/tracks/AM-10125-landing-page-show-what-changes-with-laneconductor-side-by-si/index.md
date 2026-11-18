# Track AM-10125: Landing page: show what changes with LaneConductor, side by side (same task, with and without)

**Lane**: plan
**Lane Status**: queue
**Progress**: 0%
**Phase**: New
**Track Kind**: feature
**Type**: dev
**Merge Mode**: direct
**Auto Run**: no
**Author**: AM
**Depends On**: 10114
**Problem**: Decision (human, 2026-11-18): the features are good but people will not understand them unless they see them. The landing page needs a section that shows what happens when you do a piece of work WITH LaneConductor and WITHOUT it, side by side, so the point of skill suggestions, sub-agents, tracks and the board (the dashboard artifact) is obvious at a glance.

One worked task, the same in both columns: "add CSV export to the reports page".
- Without: one long chat; the plan lives only in the conversation; Claude writes code; the next session starts from nothing; nothing is checked against a written spec; no overview of what is in progress.
- With: (1) a track folder appears in the repository with a real spec.md, plan.md and test.md (show real content produced by the connector, not invented text); (2) lane guides suggest the skills that help at each lane (brainstorming before the plan, test-driven development while implementing), as suggestions; (3) a sub-agent per track works the plan in its own git worktree while the main session stays free, and several tracks can run side by side (a simple diagram); (4) review and quality-gate lanes check the work against the spec; (5) the board: a private dashboard generated from the track files, published as a Claude artifact (a real screenshot of the real board page, filled with clearly labelled example data); (6) writes are checked against what each session last read, so two sessions cannot overwrite each other (one short line).

Honesty rules: show only what exists today and works; the skill advisor that recommends and installs skills (track 10124) is not built, so it appears only as a small "planned" note or not at all; no numbers or timings that were not measured; no testimonials; no claim that other products cannot do something; example data is labelled as example data. Do not mention recipes (they were cut, track 10123). Source of truth for claims: docs/why-laneconductor.md and the plugin README.

Build: in an isolated git worktree from local main, edit landing/index.html (reuse its existing dark theme and CSS variables; place the section after the "how it works" part, decide the exact spot) and add images under landing/docs/. The demo project is a throwaway git repository OUTSIDE the repo: create its tracks with the real connector (so spec, plan and test text is authentic), put them in different lanes with update_track, generate the board with `node connector/bin/lc-board.mjs --repo <demo> --site <dir> --json`, serve it locally and take real screenshots (desktop, and a narrower one if useful). Keep each image under about 300 KB. Layout: two columns that stack on a phone, no horizontal overflow at 375 px (check with a script, not by eye), readable contrast, alt text on every image. Also verify the page at desktop width. Do not touch landing/firebase.json or landing/posts/ and do not deploy or push: deliver the finished change as a commit on the worktree branch plus a patch file of landing/index.html and the new images, because the primary checkout holds another session's uncommitted edits to landing/index.html that must not be overwritten.
**Summary**: Decision (human, 2026-11-18): the features are good but people will not understand them unless they see them. The landing page needs a section that shows what happens when you do a piece of work WITH 
