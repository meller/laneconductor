# Tests: Track 10125 - Landing page: show what changes with LaneConductor, side by side (same task, with and without)

No test file or committed script exists for the landing page; the width check was run as a script by the implementing session and was not kept. The cases are inspections of `landing/index.html` on main and of the page in a browser (serve `landing/` locally and open it). Ticked ones were checked in the file; unticked ones are not verified or not done.

- [x] TC-1 (REQ-1): the section `id="difference"` follows the "how it works" section and the nav has `href="#difference"`
- [x] TC-2 (REQ-2): the section has six rows, each with a `wc-without` and a `wc-with` cell
- [x] TC-3 (REQ-3): two WebP images under `landing/docs/`, each under 300 KB
- [x] TC-4 (REQ-5): every `<img>` in the section has `alt`, `width` and `height`; the diagram has a title and description
- [x] TC-5 (REQ-4): the page does not mention recipes; the skill advisor appears only as a "planned, not built yet" note; example data is labelled as example data
- [ ] TC-6 (REQ-5): no element is wider than the viewport at 320, 375, 768 and 1360 px (script; the result of the earlier run is not recorded here)
- [ ] TC-7 (REQ-5): text contrast and reading at desktop and phone width (the screenshots are small on a phone)
- [ ] TC-8 (REQ-5): the section renders correctly in Firefox and Safari engines
- [ ] TC-9 (REQ-3, HUMAN): the files and the CONFLICT text shown match a fresh run of the connector on the example project
- [ ] TC-10 (REQ-6, HUMAN): the owner reads the section on desktop and phone and says deploy; after the deploy, the live page shows the section
- [ ] TC-11 (proposed): once the journey change is built, the page names the install command, `/laneconductor:next`, what is kept, the dashboard and parallel plans, uses only real captures labelled as examples, and contains no unsourced claim about other products and no use of the word "legacy" for the daemon tier
