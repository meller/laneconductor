# Track 10125: Landing page: show what changes with LaneConductor, side by side (same task, with and without)

## Phase 1: Real material

- [x] Task 1: Create a throwaway demo repository outside the repo with a minimal `conductor/` scaffold
- [x] Task 2: Create six example tracks with the real connector (`create_track`, `update_track`), spread across backlog, plan, implement, review, quality-gate and done
- [x] Task 3: Fill the CSV export track's spec.md, plan.md and test.md with short realistic content
- [x] Task 4: Generate the board with `lc-board.mjs --site --json`, serve it locally, take real screenshots (overview, and a track opened on its Plan tab)
- [x] Task 5: Capture a real `CONFLICT` answer from two connector sessions writing the same track

## Phase 2: The section

- [x] Task 1: Add the "What changes" section after "How it works" in `landing/index.html`, with its own `wc-` CSS, using the existing tokens
- [x] Task 2: Six rows, each with a "without" and a "with" cell: where the plan lives, advice at each lane, who does the work (inline SVG), checking the work, the overview (two board images), two sessions at once
- [x] Task 3: Skill advisor shown only as a small "planned, not built yet" note; no recipes, no unmeasured numbers, no testimonials
- [x] Task 4: Add one nav link (`#difference`)
- [x] Task 5: Save the two board screenshots as WebP under `landing/docs/` (each well under 300 KB)

## Phase 3: Verify

- [x] Task 1: No element wider than the viewport at 320, 375, 768 and 1360 px (script, not by eye)
- [x] Task 2: Every image has alt text and explicit width and height; all images load
- [x] Task 3: Read the page at desktop and phone width (the lead re-checked all of it from a fresh checkout)
- [x] Task 4: Stop the demo servers; commit; the patch was applied to main without touching the other session's uncommitted lines
- [x] Task 5: The lead added the skills-per-lane sentence to the advice row after track 10123 shipped

## Phase 4: Release (the owner's call)

- [x] Task 1 (HUMAN): Read the section on a desktop and a phone, then say deploy. (done 2026-11-19: it is deployed and live; the owner closed the track) Deploy from a clean checkout of main: `firebase deploy --only hosting --project laneconductor-site`
- [ ] Task 2: Test in Firefox and Safari engines (not done; the owner closed the track with this open, a known limit)

**Not done by design**: no deploy; `landing/firebase.json` and `landing/posts/` untouched.
