# Tests: Track 10119 - Why LaneConductor: an honest comparison page (Jira's connector, Linear, community plugins, plain Claude)

This is a docs and marketing track, so the tests are checks of text and pages. Run them from the repository root; each grep must print the matching lines (or, for a negative check, nothing). Cases marked (human) need a person's judgement. Derived from the spec's acceptance criteria; none was run as an automated suite.

- [x] TC-1 (REQ-1): the page has all the required sections. `grep -n "^## " docs/why-laneconductor.md` shows: the short answer, where it comes from, the sources comparison, product trackers, the worked example, alone or with a tracker, who it is for and not for, sources.
- [x] TC-2 (REQ-1): the use-case table has the five rows (product tracker, tracker's coding agent, tracker's connector, plain Claude Code, LaneConductor). `grep -n "^| \*\*" docs/why-laneconductor.md`
- [x] TC-3 (REQ-2): the Sources section carries the check date and a link per product. `grep -n "Checked 2026-11-17" docs/why-laneconductor.md`
- [x] TC-4 (REQ-4): the README credits Conductor and Superpowers and links the page. `grep -n "Where this comes from\|why-laneconductor.md" README.md`
- [x] TC-5 (REQ-4): no stale command count in the README. `grep -n -i "18 commands" README.md landing/index.html landing/wiki.html` prints nothing.
- [x] TC-6 (REQ-6): the page says who it is not for. `grep -n -i "not for" docs/why-laneconductor.md`
- [ ] TC-7 (REQ-6, human): the page never claims "ticket to pull request" as ours and makes no claim that another product cannot do something. A person reads the page for it.
- [ ] TC-8 (REQ-2, human): each sourced statement matches the live source page; re-fetch every link in the Sources section before any release.
- [ ] TC-9 (REQ-3, human): the page has no number that was not measured or taken from a source.
- [ ] TC-10 (human): the owner reviews the wording and tone (factual, not promotional).
- [ ] TC-11 (REQ-5): the landing page has the short section with the same story, and it links to the docs page. `grep -n -i "why-laneconductor" landing/index.html`. Not met today: no match.
- [ ] TC-12 (REQ-5, human): the landing edit does not carry another track's uncommitted drafts and is deployed only on the owner's say (check `git diff` of landing/ before any deploy).
