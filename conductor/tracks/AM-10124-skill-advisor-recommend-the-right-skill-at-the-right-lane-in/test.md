# Tests: Track 10124 (skill advisor)

Behaviours agreed with the owner on 2026-11-18. The catalog covers every lane, not only plan and implement.

- [ ] TC-1: Catalog entries carry: skill or pack name, source, why, licence, the lane(s), the track `Type`(s) (dev, marketing, sales, support), stack tags, a level (`prerequisite` or `helps`) and the install command; the checker rejects an entry missing any of them, with an unknown lane or Type, an unresolvable source, or a private-looking name
- [ ] TC-2: PREREQUISITE, UI: a track whose stack or files show a front end (for example a Vite or React config, CSS files, or a plan that names screens or pages) and no design skill installed gets the design recommendation (`frontend-design`, and `artifact-design` or `dataviz` for dashboards and charts) before implement, once per session, with the reason and the install commands
- [ ] TC-3: PREREQUISITE, stack: `conductor/tech-stack.md` or a marker file (firebase.json, prisma/schema.prisma, ...) names a stack with a pack in the catalog and the pack is not installed: the pack is recommended once at the next lane start
- [ ] TC-4: PREREQUISITE, Type: a track with `**Type**: marketing` gets the marketing skills recommended (copywriting, page CRO, SEO audit and similar) when none is installed; `sales` and `support` likewise when the catalog has entries
- [ ] TC-5: Lanes: plan and brainstorm suggest brainstorming and writing-plans; implement suggests test-driven development, systematic debugging, sub-agent execution and worktrees; review suggests code-review skills; QUALITY GATE (QA) suggests verification-before-completion, a security review skill, and for UI tracks a browser-driving tool (the `run` skill or a browser plugin); merge suggests finishing-a-branch; deploy suggests the stack's deploy pack
- [ ] TC-6: Our own packs are preferred when both an own pack and a generic skill fit; the generic finder (find-skills, only if vetted) is named only when nothing in the catalog fits, with a plain note that it is third-party
- [ ] TC-7: Nothing is recommended for a skill that is already installed; a declined recommendation is not repeated for that project (the declined list is stored outside git)
- [ ] TC-8: A recommendation never blocks or changes the lane work; the lane continues if the person ignores it; it appears at most once per skill per session
- [ ] TC-9: Every shell command is shown in its own `bash` fence, one command per block, no leading `$`; the in-session alternatives (`/plugin install ...`) are inline text; no generated text tells Claude to run an install by itself; with an explicit yes Claude may run `claude plugin install ... --scope local` through Bash under its normal permission prompt
- [ ] TC-10: The catalog and the lane guides agree: every skill named in a lane guide's 'Skills that help here' section is in the catalog (or marked as local-only)
- [ ] TC-11 (HUMAN): in a real UI project without a design skill, the advisor recommends one before implement; saying yes installs it and it loads; saying no is remembered
- [ ] TC-12 (HUMAN): a quality-gate run on a UI track mentions the browser-driving tool when none is installed
