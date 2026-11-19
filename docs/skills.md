# LaneConductor skills library

A small set of Claude Code skills that carry one author's own conventions and the incidents behind
them: GCP and Firebase site layout, Gemini and LLM client patterns, sign-in, PWA and cache busting,
Prisma in Functions, a Makefile for local runs, Postgres with a production secret, an isolated test
database, and a process for adding more.

Every skill was observed in the author's own projects with LaneConductor
([github.com/meller/laneconductor](https://github.com/meller/laneconductor)). They are advice from
past projects, never orders: Claude may decide against one and says why. They name no private
project, site, bucket, secret or repository; identifiers are placeholders such as `<shared-project>`,
`<product>`, `<site>` and `<bucket>` that you fill in for your own setup.

## The skills

| Skill | What it carries |
| --- | --- |
| `shared-gcp-firebase-site` | One Hosting site plus one Functions codebase per product inside a shared GCP project; scoped deploys |
| `vertex-gemini-adc` | Gemini through Vertex AI and Application Default Credentials, no API key |
| `llm-through-tokentalos` | Every LLM call through TokenTalos (`@meller/tokentalos`): lazy singleton, Vertex ADC, usage log, timeout and retry, CI stand-in |
| `vertex-imagen-retry-gcs-fallback` | Image generation with 429 backoff, GCS upload, development-only local fallback |
| `browser-tts-unlock-voice-binding` | Making `speechSynthesis` audible: unlock on first gesture, explicit voice |
| `makefile-local-run` | The standard root Makefile: `make dev`, `db-local`, `stop-all`, scoped `deploy` |
| `postgres-local-neon-prod-secret-manager` | Local Postgres in development, Neon in production, the production string only in Secret Manager |
| `isolated-test-database` | Tests run against `<product>_test`, forced in the Vitest config |
| `prisma-in-cloud-functions` | Prisma inside a Functions app: schema sync, postinstall generate, dependency parity |
| `firebase-google-sign-in` | Google-only sign-in with Firebase Auth, token check, `provisionUser` |
| `cache-buster` | Hosting headers, build stamp, stale-tab banner, post-deploy recovery |
| `pwa-vite-workbox` | Installable PWA with vite-plugin-pwa and the incidents behind each setting |
| `skill-from-code` | A skill generator: turns a pattern or verified incident of yours, shown by working code, into a new skill in this library |

## Install and update

These skills live in this repository under `skills/<name>/SKILL.md`. A Markdown-only plugin that bundles
them for `claude plugin install` is planned (track AM-10129) and is not released yet; until then,
copy a skill folder into `.claude/skills/` of your project, or into `~/.claude/skills/` for every
project. Each skill is advice from past projects, never an order.

## Use with LaneConductor

LaneConductor does not wrap skills; it knows which ones help at each lane. A project lists the
skills it wants in the optional `skills` object of `conductor/workflow.json`, keyed by lane
(`brainstorm`, `plan`, `implement`, `review`, `quality-gate`, `merge`). The lane guides tell Claude
to read and use the listed skills in addition to the built-in suggestions, as advice and never as
an order.

```json
{
  "skills": {
    "plan": ["shared-gcp-firebase-site", "postgres-local-neon-prod-secret-manager"],
    "implement": ["makefile-local-run", "isolated-test-database", "prisma-in-cloud-functions", "vertex-gemini-adc"],
    "review": ["isolated-test-database"],
    "merge": ["skill-from-code"]
  }
}
```

Skills copied into `.claude/skills/` keep their plain names, which is the form the LaneConductor
lane guides document for `workflow.json`. Keep the lists short: every listed skill adds to what Claude
reads in that lane. Add `skill-from-code` to `merge` so a lesson learned in a track becomes a
skill while the context is fresh.

## Format rules

Every skill is a folder `skills/<name>/` with a `SKILL.md` and, optionally, `files/` (templates with
`{{placeholder}}` slots that Claude fills). It is a valid Claude Code skill folder.

- `<name>` is kebab-case and equals the folder name and the `name` field.
- Top-level frontmatter uses only documented skill fields: `name`, `description`, `when_to_use`,
  `paths`, `metadata`. `description` plus `when_to_use` stay at or under 1,536 characters (the
  listing cuts them there).
- Skill-specific fields live under `metadata` (a map): `kind` (`convention` or `process`), `stack`
  (short lowercase tags), `prerequisites` (sentences), `provenance` (one sentence: where it was
  observed), `verified` (ISO date, or `null` for a draft), optional `smoke_check` (one read-only
  command), and an optional `reference` list of `{ repo, path, commit, proves }` that a private
  library may keep; a published set carries none.
- Body sections in this order: `## Why this works`, `## Recommendation`, `## Claude does`,
  `## You run` (credential, sign-in and deploy steps always go here, never to Claude),
  `## Pitfalls`, and optionally `## Unproven`. A process needs only the first two. Body under 8,000
  characters.
- No secrets and no `.env` with values; `files/` may hold `.env.example` with names and empty or
  obviously fake values.

Only record what Claude cannot derive: the author's choices and the incidents behind them. A claim
that no vendor document or run confirms is labelled UNVERIFIED or goes under `## Unproven`.

## Tools

`skills-tools/` is a small Node tool with its own `package.json` (one dependency, `yaml`). Run
`npm install` there once.

```bash
node skills-tools/bin/check.mjs                 # format, 1,536-character rule, sections, secrets
node skills-tools/bin/gate.mjs                  # privacy gate: secrets, emails, phones, paths, repo URLs, hashes, deny-list names
cd skills-tools && npm test                     # the tools' own tests
```

- `check.mjs` validates every skill. `metadata.reference` is optional; when a skill has one, it is
  validated and, with `--ref-root <dir>`, resolved against a local checkout.
- `gate.mjs` is the check to run before a skill is published. Besides secrets, emails and phone
  numbers it refuses local file system paths, GitHub repository URLs other than
  `github.com/meller/laneconductor`, and 7 to 40 character hex strings that look like commit
  hashes. Its deny list is `.homebrew-deny.local.txt` in the repository root: one private name per
  line, `#` comments. The file is gitignored and must never be committed; without it the gate
  refuses to run (or pass `--no-deny-list`, and it says names were not checked). Findings never
  print the matched text.

## Adding or changing a skill

Use `skill-from-code`. In short: the problem must be the owner's convention or incident,
be shown by working code, and have cost real time. Search the skills first, draft, run
`node skills-tools/bin/check.mjs` and `node skills-tools/bin/gate.mjs` to zero findings, show the human, then
commit on a branch.

## License

Elastic License 2.0, the same as LaneConductor. See `LICENSE`.
