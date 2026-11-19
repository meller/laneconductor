# Track AM-10129: Public, generic version of the homebrew skills: no private names, paths, repos or commits

**Lane**: review
**Lane Status**: waiting
**Progress**: 43%
**Phase**: Delivered 2026-11-19: the 13 skills are in this repository (skills/, checker and privacy gate in skills-tools/) and shipped as five plugins at 0.1.0 (nodejs-frontend, firebase, node-postgres, gemini, skill-from-code), on the site and in the wiki. Open: the owner reads llm-through-tokentalos (3.1), a clean-profile install check (3.8), the advisor catalog entries (3.6, needs a base release), and the after-release steps (2.11, 3.9).
**Track Kind**: feature
**Type**: dev
**Merge Mode**: direct
**Auto Run**: no
**Author**: AM
**Depends On**: 10126
**Problem**: Decision (human, 2026-11-18): the homebrew skills (built in track 10126 in the owner's local library) must be shareable publicly. They must carry the convention and the pitfalls and nothing private: no project names, no private repository names or URLs, no local paths, no commit hashes of private repositories, no GCP project ids or site names, no connection strings or emails. Where a source is needed the skill just says it was observed in the author's own projects with LaneConductor. The private library's git history contains all those names, so the public version is a NEW repository with ONE commit and no history; the private library stays as the owner's archive.

Work (outside this repository, in a new local directory; nothing is pushed or created on GitHub by the implementer):
1. Build a deny list file (local, never committed) from the owner's sibling repository names under ~/Code, every project, site, bucket, secret and GCP project identifier that appears in the library text, any local path (/home/...), private repository URLs, and commit hashes cited as references. Do not read or print any .env or credential file; only names that appear in the library itself and the directory names of the sibling repositories are needed.
2. Rewrite each of the 13 skills generically: replace named projects with generic wording ('one of the author's projects', 'the shared project'), placeholders for identifiers (`<shared-project>`, `<product>`, `<site>`), remove the reference citations and any `references` metadata that names a private repo, keep `verified` as a date and a plain statement 'observed in the author's own projects with LaneConductor', keep every pitfall and incident as a general lesson. Do not invent claims; where a pitfall only made sense with a private detail, state the general rule or drop it.
3. The checker in the library's tools/ must accept skills with no references (references optional for the public set) and the privacy gate must pass the new tree with the deny list: zero findings. Also grep the whole tree for /home/, github.com URLs other than github.com/meller/laneconductor, 7-to-40 hex-character commit-like strings, email addresses, and ports/hosts that identify a private service.
4. README for the public set: what it is, how to install and update (`claude plugin marketplace add <owner>/<repo>`, `claude plugin install ...`), how to attach skills to lanes in a project's `conductor/workflow.json` (`skills` per lane), license. Keep the plugin name `homebrew-skills` for now.
5. Output a fresh git repository at ~/Code/homebrew-skills-public with a single commit (no history), plugin and marketplace validating with `claude plugin validate --strict`.
6. Report what was removed by category and counts, anything that lost value, and the verification output.

Open decisions for the owner (do not decide them): where it is published (a separate public repository, or as an optional Markdown-only plugin inside the LaneConductor repository and marketplace) and the licence (default: the same as LaneConductor, Elastic-2.0, easy to change).
**Summary**: Decision (human, 2026-11-18): the homebrew skills (built in track 10126 in the owner's local library) must be shareable publicly. They must carry the convention and the pitfalls and nothing private: n
