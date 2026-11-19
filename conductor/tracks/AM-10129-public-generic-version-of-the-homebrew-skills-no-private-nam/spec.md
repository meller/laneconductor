# Spec: Public, generic version of the homebrew skills: no private names, paths, repos or commits

## Problem Statement

Decision (human, 2026-11-18): the homebrew skills (built in track 10126 in the owner's local library) must be shareable publicly. They must carry the convention and the pitfalls and nothing private: no project names, no private repository names or URLs, no local paths, no commit hashes of private repositories, no GCP project ids or site names, no connection strings or emails. Where a source is needed the skill just says it was observed in the author's own projects with LaneConductor.

The private library's git history contains all those names, so the public version is a NEW repository with ONE commit and no history; the private library stays as the owner's archive.

The work happens outside this repository, in a new local directory (`~/Code/homebrew-skills-public`). Nothing is pushed or created on GitHub by the implementer. The track depends on 10126.

## Requirements

- REQ-1 Deny list: build a deny list file (local, never committed) from the owner's sibling repository names under `~/Code`, every project, site, bucket, secret and GCP project identifier that appears in the library text, any local path (`/home/...`), private repository URLs, and commit hashes cited as references. No `.env` or credential file is read or printed; only names that appear in the library itself and the directory names of the sibling repositories are needed.
- REQ-2 Generic rewrite: each of the 13 skills is rewritten generically. Named projects become generic wording ("one of the author's projects", "the shared project"); identifiers become placeholders (`<shared-project>`, `<product>`, `<site>`); reference citations and any `references` metadata that names a private repository are removed; `verified` stays as a date with the plain statement "observed in the author's own projects with LaneConductor"; every pitfall and incident stays as a general lesson. No claim is invented; where a pitfall only made sense with a private detail, the general rule is stated or the pitfall is dropped.
- REQ-3 Checker: the checker in the library's `tools/` accepts skills with no references (references are optional for the public set).
- REQ-4 Privacy gate: the privacy gate passes the new tree with the deny list, with zero findings. The whole tree is also searched for `/home/`, github.com URLs other than github.com/meller/laneconductor, 7-to-40 hex-character commit-like strings, email addresses, and ports or hosts that identify a private service.
- REQ-5 README: it says what the set is, how to install and update (`claude plugin marketplace add <owner>/<repo>`, `claude plugin install ...`), how to attach skills to lanes in a project's `conductor/workflow.json` (`skills` per lane), and the license. The plugin name stays `homebrew-skills` for now.
- REQ-6 Output: a fresh git repository at `~/Code/homebrew-skills-public` with a single commit (no history); the plugin and the marketplace validate with `claude plugin validate --strict`.
- REQ-7 Report: what was removed by category and counts, anything that lost value, and the verification output.

## Decisions

- 2026-11-18 (human): the public set is a NEW repository with one commit and no history, because the private library's history holds the private names; the private library stays as the owner's archive.
- 2026-11-18 (human): sources are not cited by name; a skill only says it was observed in the author's own projects with LaneConductor.
- The deny list is local and never committed.
- Open for the owner (not decided by the implementer): where it is published (a separate public repository, or as an optional Markdown-only plugin inside the LaneConductor repository and marketplace), and the licence (default: the same as LaneConductor, Elastic-2.0, easy to change).

## Acceptance criteria

Not verified: none of these is ticked until the privacy gate, the checker and the strict validation have been run on the output and their output shown.

- [ ] A deny list exists locally, is not committed, and was built as REQ-1 says.
- [ ] All 13 skills are generic: no project names, private repository names or URLs, local paths, private commit hashes, GCP project ids, site names, connection strings or emails.
- [ ] Every pitfall and incident is kept as a general lesson, or dropped with a stated reason.
- [ ] The checker accepts skills without references.
- [ ] The privacy gate passes the new tree with the deny list: zero findings.
- [ ] The extra searches (REQ-4) find nothing.
- [ ] The README covers what it is, install and update, attaching skills to lanes, and the license.
- [ ] The repository at `~/Code/homebrew-skills-public` has exactly one commit.
- [ ] `claude plugin validate --strict` passes on the plugin and the marketplace.
- [ ] The report lists what was removed by category and counts, what lost value, and the verification output.

## Risks and limits

- A pitfall that only made sense with a private detail may lose value when generalised; the report names each such case.
- A name missing from the deny list is not caught by the gate; the extra searches of REQ-4 are the second net.
- The one-commit repository must be created after the tree is clean, because any earlier commit would carry private names.

## Out of scope

- Pushing anything or creating a GitHub repository (the owner does it).
- Deciding where the set is published and under which licence (open for the owner).
- Changes to the private library, which stays as the owner's archive.

## Overlap check against public skills (2026-11-19, read-only; four agents read our skills and the public texts in full unless marked)

Question: do we duplicate skills that already exist? Answer: no skill is a duplicate; four overlap in their generic part and are trimmed; five carry stale defaults that must be fixed before anything is published. Public sources read: firebase/agent-skills, google/skills, prisma/skills, neondatabase/agent-skills, obra/superpowers (writing-skills), anthropics/skills (skill-creator), and community PWA, database-testing and Makefile skills.

| Skill | Verdict | Note |
|---|---|---|
| firebase-google-sign-in | KEEP | Firebase's auth skill is client-side only; server token check, provisioning and project moves are ours. Add: authorized-domain entries are bare hostnames, `localhost` for dev. |
| pwa-vite-workbox | KEEP | The `dontCacheBustURLsMatching` pattern, the route allowlist with its test, the 2 MiB build failure and the dev POST hang are in no public skill. Add: per-user responses never in Cache Storage. |
| cache-buster | KEEP | The Hosting header block, build-stamp poll and stale-tab recovery are in no public skill. Add `vite:preloadError`. |
| vertex-gemini-adc | TRIM + FIX | Point to google/skills `gemini-api` and `google-cloud-recipe-auth`; keep shared-project convention, timeout/retry values, thinking-token billing, `temperature: 0` for extraction. FIX stale defaults: `gemini-2.5-flash` (Google calls 2.5 legacy), regional `GCP_REGION` for text (Google defaults to `global`), `vertexai: true` vs Google's `enterprise:` constructor (unverified), product renamed Agent Platform. |
| vertex-imagen-retry-gcs-fallback | TRIM + FIX | Keep backoff numbers, GCS upload, development-only fallback, cost and test incidents. FIX image model default (`gemini-nano-banana-2.1` is Google's); add: a 429 is often the shared pool, not your quota. The "Imagen discontinued" line is unverified (summary-read only). |
| llm-client-pattern | KEEP, REWRITE | The gateway it describes is TokenTalos (`@meller/tokentalos`, MIT, public GitHub meller/tokentalos and public on npm). The private deny list wrongly hid the name; naming it is allowed. Owner: all LLM calls go through TokenTalos. Point generic timeout/retry advice to a public skill (harden-llm-app-reliability). |
| browser-tts-unlock-voice-binding | KEEP | No public skill; MDN covers basics only. |
| postgres-local-neon-prod-secret-manager | KEEP, light trim | The Secret Manager plus Firebase Functions chain is in no public text; replace the pooled-vs-direct restatement with a pointer to Neon's skill. |
| prisma-in-cloud-functions | KEEP, light trim | The Functions split and its incidents are in no public text. Add: Prisma 7 removed auto-generate (explains the stale-client P2022). |
| isolated-test-database | KEEP | The guard against a suite wiping the dev database is in no public skill. Optional: mention a restricted test user. |
| makefile-local-run | KEEP + FIX | No public fresh-clone bootstrap. Suspected bug in `stop-all` (`@done` continuation), NOT verified; check with `make -n stop-all`. Add safety headers. |
| shared-gcp-firebase-site | TRIM + FIX | Keep the one-shared-project layout, values and the `/api/**` and `--force` gotchas. FIX the health path (Cloud Run reserves paths ending in `z`; use `/api/health`), add the 36-sites-per-project limit, shorten the codebase-deletion explanation. |
| capture-solved-problem | TRIM | Keep verification, privacy gate and commit ritual; point to superpowers `writing-skills` for the rest; description = triggers only. |
| tools/ checker | KEEP | `claude plugin validate` passed a deliberately broken skill; the privacy gate with a deny list has no public equivalent. |

Still provisional: third-party skills for shared-GCP, two partly read PWA skills, the rbarazi gateway skill, Imagen deprecation.

## Decision changed (owner, 2026-11-19)

No new repository. The skills ship as a Markdown-only plugin in THIS repository's marketplace (working name `laneconductor-skills`), built by the same generator, next to the other three. The single-commit fresh repo of 2026-11-18 stays only as the local source (`~/Code/homebrew-skills-public`); nothing is pushed to a new GitHub repository. The release waits until the directory review of track 10148 is decided.

## Where skills can be published (read 2026-11-19 from two write-ups of June and August 2026; not tried by us)

- Our own marketplace (this repository): the plugin `laneconductor-skills`. Nothing to submit; pushing to the public repository is the publishing.
- skills.sh (the `npx skills add owner/repo` tool): one write-up says a listing is automatic from install tracking and needs a public GitHub repository, with an `agent-skill` topic tag; another says maintainers add entries on request. Unconfirmed which; the same repository layout serves both: `skills/<name>/SKILL.md`.
- GitHub crawlers (smithery.ai, skillsmp.com, claude-plugins.dev, claudemarketplaces.com and others) index a public repository with SKILL.md folders automatically, per the write-up.
- Submit-form directories (Smithery, LobeHub, MCPMarket and more): free, by submitting the repository URL.
- ClawHub (the OpenClaw hub): a CLI publish with automated checks; it belongs to a different agent ecosystem and is not a priority.
- Anthropic: its directory is for plugins and is reviewed by a human (track 10148 is our submission of the base plugin); the partner Skills directory is curated and not open to submissions; individuals can upload a skill to claude.ai (Settings, Capabilities, Skills).
- The layout implication: a root `skills/` folder in this repository would make `npx skills add meller/laneconductor` work, and the generator would copy it into the plugin. The tool's telemetry is the registry's, not ours; our plugins still send nothing.
