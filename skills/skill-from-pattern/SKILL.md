---
name: skill-from-pattern
description: "Use when a verified solution to a hard problem should become one of these skills, when the user says save this as a skill, capture this, remember this convention or add this to my homebrew skills, or when a skill in the library is wrong, stale or unused and should be rewritten or retired."
when_to_use: "The problem was just solved and verified, a future project would hit it again, and it is a convention of the owner or a pitfall that cost real time."
metadata:
  kind: process
  stack: [skills, library, process]
  provenance: observed in the author's own projects with LaneConductor
  prerequisites:
    - The library is checked out locally (the repository with its `skills/` folder) and its `skills-tools/` has had `npm ci` run once.
    - The solved problem is backed by working code you can still read; the skill states what was observed, in general terms.
  verified: 2026-11-18
  smoke_check: node skills-tools/bin/check.mjs
---

## Why this works
Observed in the author's own projects with LaneConductor: a skill is only worth keeping if it is
true. The first skills in this set were checked claim by claim against the working code and the
vendor's docs, and the check reworded some lines and labelled others as observed or unverified.
This process keeps that: capture while the context is fresh, but only what was verified, and only
with the owner's approval.

## Recommendation
1. Run the situation once without the skill: if Claude already gets it right, do not capture. Then
   ask whether the solved problem passes all three: (a) it is a choice or convention of the owner,
   or an incident, not derivable from public docs; (b) working code exists that shows it; (c) it
   cost real time to find. If any fails, stop and say why; do not capture.
2. Search before adding: `ls skills/`, then grep the skills' `description`, `when_to_use` and body
   for the topic. If a skill already covers it, update that skill instead of adding a near-duplicate.
3. Draft `skills/<name>/SKILL.md` in the library's format (README.md): kebab-case `name` equal to
   the folder, `description` + `when_to_use` at most 1,536 characters together, `metadata` as a map
   (`kind` convention or process, `stack`, `prerequisites`, `provenance`, `verified`, optional
   `smoke_check`), body sections in order (Why this works, Recommendation, Claude does, You run,
   Pitfalls, optional Unproven), body under 8,000 characters. Templates go under `files/`.
4. Keep only lines that carry a project fact or an incident lesson with where it was observed, in
   general words. For how to write a good description and test a skill, see `writing-skills` in
   Superpowers; this process adds the verification, privacy and commit steps below.
5. Check before showing: every claim is confirmed against the working code or the vendor's docs,
   or labelled UNVERIFIED, or dropped; then `node skills-tools/bin/check.mjs` must print zero errors and
   zero warnings, and `node skills-tools/bin/gate.mjs` (with your local deny list of private names) must
   report zero findings. Set `verified` to today only after both passed.
6. Show the human the draft and the check output. Save only after a clear yes: `git add` the skill
   folder and commit on a branch (never `git add -A`); a version bump is part of the release, not of this step.
7. Retire path: when a skill is wrong, or what it describes is gone with no replacement, propose
   deleting the folder in one commit whose message carries the reason; git history keeps the text.

## Claude does
- Steps 1 to 7 up to the human's yes. Prefer updating over adding; prefer a shorter skill over a
  fuller one.
- Read the project's working code through `git log`, `git show` and plain file reads only; never
  run code in another repository, never modify one.

## You run
- Say yes or no to the draft (step 6) and to a retirement (step 7).
- Add a remote and push the library when you decide to. Claude never adds a remote, never pushes,
  and never makes the library public.

## Pitfalls
- Never copy a value from a project. Real repositories hold credentials and personal data in docs,
  comments and local settings files (a pasted connection string in a settings file and a personal
  email in a migration note were both found while building the first set). Quote variable names
  and placeholders only; run the checker's secret scan before every save, and grep the folder for
  emails.
- Never write a private project, site, bucket, secret or repository name, a local path or a commit
  hash into a skill. Say "one of the author's projects" and use placeholders such as
  `<shared-project>`, `<product>`, `<site>`, `<bucket>`.
- A comment in code is a claim, not a fact. "A GCP project per product hit a quota" (only in a
  track note) and "the Imagen grant is missing" (a code comment) were assertions; label them as
  such unless a doc or a run confirms them. Unconfirmed lines go under `## Unproven` or get cut.
- Working code that has since moved on is not wrong, only possibly stale: say in the skill what
  was observed and when (`verified`), and re-check before relying on it.
- A skill that bundles two conventions is two skills; split it so each is judged alone.
- Do not store a skill's history inside it (no changelog, no outcome counts); git holds that.
- Claude must not save on its own: a wrong convention is served to every future project.
- The deny-list gate (`node skills-tools/bin/gate.mjs`) must pass before any skill is copied out of your
  library, for example into a public repository. The deny list is a local file and is never
  committed.
