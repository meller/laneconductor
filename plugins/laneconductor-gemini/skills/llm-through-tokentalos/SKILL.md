---
name: llm-through-tokentalos
description: "How the author's apps call an LLM: every call goes through TokenTalos (@meller/tokentalos, the author's own MIT LLM gateway library on npm), one instance per process created lazily, Gemini on Vertex AI with ADC, usage and cost logged in the app's own database, a bounded timeout and retry policy, a deterministic stand-in for CI, and a bounded cache for per-user keys."
when_to_use: "Use when adding LLM, chat or Gemini calls to any app; when writing a service file that wraps a model client; when choosing between the bare SDK and a gateway; when every real call fails with Not Found or This operation was aborted while tests pass; when CI has no GCP credentials; when a Python or other non-Node backend needs the gateway; or when users bring their own Gemini key."
metadata:
  kind: convention
  stack: [llm, gemini, vertex-ai, nodejs, tokentalos]
  provenance: observed in the author's own projects with LaneConductor; the rule that every LLM call goes through TokenTalos was stated by the author on 2026-11-19
  prerequisites:
    - The Vertex AI setup of the vertex-gemini-adc skill is in place (ADC login, API enabled, role granted by the user).
    - The app is Node (ESM package), or a non-Node app that can run the sidecar below.
  verified: null
---

## Why this works
Observed in the author's own projects with LaneConductor: the author's apps send every model call
through TokenTalos, a library the author maintains (`@meller/tokentalos`, MIT, on the public npm
registry). It builds the prompt from named parts, applies formatting and safety features, calls
Gemini, and records tokens, cost and the full prompt and reply in a database table, so debugging
and per-user cost are in one place. The author's rule, stated 2026-11-19: all LLM calls go through
it. The bare SDK (see vertex-gemini-adc) is what sits underneath; use it directly only to
understand credentials or when the author says otherwise.

## Recommendation
- `npm install @meller/tokentalos`. The package is ESM-only.
- One service file exports an async `getClient()`: import the package lazily, construct one
  instance (`mode: 'standalone'`, a `projectId`, a `config`), `await init()`, cache the promise, and
  clear the cache when loading fails so the next call retries. Nothing else constructs a client.
- Gemini through Vertex with ADC, no key: `llmProvider: 'gemini'`, `useVertex: true`, `project` from
  `GOOGLE_CLOUD_PROJECT` or `GCP_PROJECT`, `defaultModel` from an env override (the author's apps
  default to `gemini-3-flash-preview`).
- Gemini 3 preview models are served from the `global` endpoint: give the model location its own env
  var and map an unset or `us-central1` value to `global`, separate from the function's region.
- Log usage in the app's own database: Postgres under a `tokentalos` schema (`TOKENTALOS_PG_SCHEMA`)
  in deployment, SQLite (`TOKENTALOS_DB_TYPE`, a local path) on a developer machine.
- Call it with named parts: `execute({ provider: 'gemini', model, parts: { system, user_query } })`;
  `history` and `context` are the other reserved part names. The result has `content` and `usage`
  (input and output tokens, cost). The author's chat apps use the `compress` and `neutralize`
  formatting features and no response cache, because a cache would replay an old answer.
- Keep the retry policy in the app: up to 3 retries with doubling backoff on a 429, one model
  fallback when the model is not found, and stop at once when the call was cancelled.
- When `USE_CI_TEST_LLM=true`, return a deterministic stand-in with the same method shape; CI has no
  GCP credentials. Give the loader a test seam so tests never reach the real package.
- A non-Node backend (the author has one in Python) runs TokenTalos as a sidecar: its Express API
  on `localhost:8060` in the same container, configured from environment variables, with ADC on
  Cloud Run and an API key only for local use. The backend calls it over HTTP.
- For a user's own key (bring your own key), build a separate direct-key instance per user in a
  bounded cache (20 entries, oldest evicted) and evict an entry when the key changes or is removed.

## Claude does
- Write the one service file from the shape above and add `@meller/tokentalos` to `package.json`.
- Add `GEMINI_MODEL` (or `AI_MODEL`), the model location variable and `USE_CI_TEST_LLM` to
  `.env.example`, empty. Never write an API key into config, `.env.example` or a test.
- Make tests inject the stand-in, and add one smoke step that makes a real call, because mocked tests
  cannot see a wrong location or model.

## You run
1. The ADC login and role grant of the vertex-gemini-adc skill, once per machine.
2. For a remote Postgres, set `PGSSLMODE=require` in the deployed environment.
3. One real call against the deployed environment after changing model or location; read the
   status yourself, because Claude cannot see your production logs.

## Pitfalls
- TokenTalos is ESM-only. A backend compiled to CommonJS turns `import()` into `require()` and
  fails; load it with a real dynamic import (`new Function('s', 'return import(s)')`), and give
  tests an injectable loader because that trick has no import callback inside vitest.
- Version 1.4.1 builds its Postgres pool from discrete fields only: host, port, user, password,
  database. It takes no `DATABASE_URL` and has no `ssl` option, so parse the URL yourself and set
  `PGSSLMODE=require` for a remote database.
- TokenTalos stores the full prompt and reply. Its PII masking is off unless the `pii` feature is
  listed, and it would not cover health data anyway; treat the usage table as sensitive.
- A wrong model location failed every real call and nobody saw it: the function region was reused as
  the model location, but the model is only served on `global`; 404 in two other regions, 200 on
  `global`. Tests mock the LLM, so only production showed the generic "Not Found".
- A default timeout that is too tight kills healthy calls: 30 s aborted legitimate 25 to 30 s
  responses ("This operation was aborted"), then 60 s was hit again at 61 s; one app settled at
  120 s. Measure before choosing; bound it either way. The SDK default is up to 5 attempts with no
  per-attempt timeout (the cause of a ten minute hang on a transient 503); the gateway sets 2
  attempts and a timeout. The one-hour backoff ceiling is from a code comment, not re-checked.
- The tracking database pool is a module-level singleton shared by every instance in a process, and
  the package has no close. Each `init()` re-points it and orphans the previous pool, which is why
  per-user instances are cached and bounded.
- Behind a connection pooler, `SET search_path` poisons shared backends; the package
  schema-qualifies its queries and has `setSearchPath` as an opt-in (see the
  postgres-local-neon-prod-secret-manager skill for the direct-versus-pooled rule).
- A response that was blocked or truncated has no text; the gateway throws instead of returning an
  empty string so the caller does not cache it. Keep that in any wrapper.
- Streaming: only the last chunk carries token counts and it may carry no text. Yield it anyway or
  usage tracking records zero.

## Unproven
- Proxy mode (a central TokenTalos server reached with an API key) is in the package README; none of
  the author's apps was seen using it, so this skill does not recommend it.
- That the gateway's current version range is what a new project should pin; one lock file resolves
  it from the public npm registry and no other project was checked.
