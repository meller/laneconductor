# Track 10129: Public, generic version of the homebrew skills: no private names, paths, repos or commits

Design approach: build the public set outside this repository from the private library of track 10126; scrub with a local deny list, then create a fresh repository with one commit. Nothing is pushed. Depends on 10126.

## Phase 1: Deny list

- [ ] Build the local deny list from the sibling repository names under `~/Code` and every project, site, bucket, secret, GCP project identifier, local path, private repository URL and cited commit hash found in the library text
- [ ] Keep the deny list out of the new tree (never committed); read no `.env` or credential file

## Phase 2: Generic rewrite of the 13 skills

- [ ] Replace named projects with generic wording and identifiers with placeholders (`<shared-project>`, `<product>`, `<site>`)
- [ ] Remove reference citations and any `references` metadata that names a private repository
- [ ] Keep `verified` as a date with the statement "observed in the author's own projects with LaneConductor"
- [ ] Keep every pitfall and incident as a general lesson; drop or state the general rule where a pitfall needs a private detail; invent no claim

## Phase 3: Checker and privacy gate

- [ ] Make the checker in `tools/` accept skills with no references
- [ ] Run the privacy gate with the deny list on the new tree: zero findings
- [ ] Search the whole tree for `/home/`, github.com URLs other than github.com/meller/laneconductor, 7-to-40 hex-character commit-like strings, email addresses, and ports or hosts that identify a private service

## Phase 4: README and plugin metadata

- [ ] README: what it is, install and update, attaching skills to lanes in `conductor/workflow.json`, license
- [ ] Keep the plugin name `homebrew-skills`

## Phase 5: Fresh repository and report

- [ ] Create the fresh git repository at `~/Code/homebrew-skills-public` with a single commit and no history
- [ ] `claude plugin validate --strict` on the plugin and the marketplace
- [ ] Report: what was removed by category and counts, anything that lost value, the verification output

Gate: the owner decides where it is published and under which licence; the implementer pushes nothing.
