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
