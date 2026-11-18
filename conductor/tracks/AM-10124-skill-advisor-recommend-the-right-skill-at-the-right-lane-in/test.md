# Tests: Track 10124 (skill advisor, the discovery module)

Behaviours agreed with the owner on 2026-11-18. The base LaneConductor is the DISCOVERY MODULE: it does planning, implementation, review, setup and deploy by itself, and it knows a catalog of other plugins it can offer: our skill packs, third-party skills and the add-ons (laneconductor-parallel, laneconductor-board). The add-ons are NOT special: they are ordinary catalog entries with the same offer pattern. The catalog covers every lane.

Run command: unknown, none of these cases has a test yet (proposed: a catalog checker and text tests under `connector/test/`, run with `cd connector && npm test`, in the style of `recommendations.test.mjs` and `setup-recommend.test.mjs`, which cover the add-on catalog text only). The HUMAN cases are run in a real session. All cases are unticked: not verified.

## Catalog

- [ ] TC-1 (REQ-1): Catalog entries carry: name, kind (`addon`, `skillpack`, `thirdparty`), source, why (one line), licence, `installs_code` (true when it ships a script or an MCP server), the lane(s), the track `Type`(s) (dev, marketing, sales, support), stack tags, a level (`prerequisite` or `helps`) and the install commands; the checker rejects an entry missing any of them, with an unknown lane or Type, an unresolvable source, or a private-looking name
- [ ] TC-2 (REQ-1, REQ-6): Our own packs are offered first when both an own pack and a generic skill fit; a generic finder (find-skills, only if vetted) is named only when nothing in the catalog fits, with a plain note that it is third-party
- [ ] TC-3 (REQ-1, REQ-11): The catalog and the lane guides agree: every skill named in a lane guide's 'Skills that help here' section is in the catalog (or marked as local-only); the add-ons named in the base's text exist as entries

## The experience: plain text, at the moment of intent (no forms)

- [ ] TC-4 (REQ-8): PLAIN TEXT: an offer is one or two plain sentences in the reply, with each install command in its own `bash` fence (one command per block, no leading `$`) so the desktop app shows a Run button; no questionnaire, no modal, no multi-choice prompt; the person answers in chat or ignores it. The in-session alternative (`/plugin install ...`) is inline text
- [ ] TC-5 (REQ-3, REQ-8): AT THE MOMENT OF INTENT: when the person says what they want to do (plan a UI, implement, deploy, set up, review, see a board, run several tracks at once), Claude offers the matching pack or add-on in the same reply and carries on with the work; it offers ours first, optionally with a generic one alongside. Same for deployment: asking to deploy offers the stack's deploy pack
- [ ] TC-6 (REQ-8): PREREQUISITE vs HELPS: a `prerequisite` offer says the result will be better with it and asks if they want to install it first or continue (in words, in the same sentence); a `helps` offer is a one-line tip. Either way the work is not blocked: if the person does not answer, Claude continues
- [ ] TC-7 (REQ-2, REQ-4, REQ-8): INSTALL FIRST: when the person says yes, Claude shows the commands, says to run them and `/reload-plugins`, says nothing has been changed yet, and when they return it starts the step again from the top with the skill present; CONTINUE: the step starts at once and the offer is not repeated in this session; 'don't ask again for this skill' puts it on the project's declined list (outside git)
- [ ] TC-8 (REQ-8): QUIET: nothing missing means no message; at most two items per offer; the same offer is never made twice in a session; a trivial track gets at most the one-line tip; a mid-step suggestion (a failing test suggests the debugging skill) is one line
- [ ] TC-9 (REQ-2): Nothing is recommended for a skill that is already installed; a declined skill is not repeated for that project
- [ ] TC-10 (REQ-4, REQ-7): INSTALL CONSENT: Claude never runs an install by itself in the base; it shows the commands. For an entry with `installs_code: true` the text says plainly that it installs a local program (a script or an MCP server) from the owner's marketplace; for a Markdown-only pack it says it adds knowledge only

## Setup: a starter set

- [ ] TC-11 (REQ-9): `/laneconductor:setup` and `/laneconductor:new-project` end with a STARTER SET: three or four recommended plugins chosen from the project's stack and type (for example the core process skills, a design skill when the project has a UI, the stack's pack), each with its commands in its own bash fence and a one-line why, offered once: install them now, or ad hoc later when the moment comes. Never more than four; none already installed
- [ ] TC-12 (REQ-3, REQ-9): The starter set is derived from `conductor/tech-stack.md` and the marker files (firebase.json, prisma/schema.prisma, a Vite or React config, and similar), and the answer 'later' defers each item to its own moment of intent (TC-5)

## The add-ons are ordinary catalog entries

- [ ] TC-13 (REQ-10): laneconductor-board is offered the same way as any pack: when the person asks for a board or dashboard (the base's board commands use that same offer text), and laneconductor-parallel when several sessions, people or sub-agents write the same tracks or the person wants worktrees; neither has special wording or code paths outside the catalog

## Lanes covered

- [ ] TC-14 (REQ-11): Plan and brainstorm offer brainstorming and writing-plans; a UI track (a front-end stack or files, or a plan naming screens or pages) offers `frontend-design`, and `artifact-design` or `dataviz` for dashboards and charts; implement offers test-driven development, systematic debugging, sub-agent execution, worktrees and the stack pack; review offers code-review skills; quality gate (QA) offers verification-before-completion, a security review skill and, for UI tracks, a browser-driving tool (the `run` skill or a browser plugin); merge offers finishing-a-branch; deploy offers the stack's deploy pack; a track with `**Type**: marketing` (or sales, support) is offered the matching skills

## Real use (HUMAN)

- [ ] TC-15 (HUMAN) (REQ-9): run `/laneconductor:setup` in a project: the starter set of three or four appears once with commands; install two, say later to the rest; later, say 'deploy this' and the stack's deploy pack is offered in the same reply
- [ ] TC-16 (HUMAN) (REQ-5, REQ-8): in a real UI project without a design skill, ask to plan a screen: the design skill is offered in a sentence while the plan work continues; install first, reload, ask again, and the plan is made with it
- [ ] TC-17 (HUMAN) (REQ-11): a quality-gate run on a UI track mentions the browser-driving tool when none is installed
