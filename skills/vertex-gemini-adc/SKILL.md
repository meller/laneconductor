---
name: vertex-gemini-adc
description: "Call Gemini from a Node/TypeScript app through Vertex AI with Application Default Credentials in a shared GCP project (GCP_PROJECT / GCP_REGION), with no GEMINI_API_KEY anywhere in code, .env or Secret Manager."
when_to_use: "Use when adding Gemini, an LLM, text or structured generation, or an AI API call to a project; when about to create or paste a Gemini or Google API key; when writing new GoogleGenAI(...) or choosing between Vertex AI and the Gemini Developer API; or when a call fails with could not automatically determine credentials or permission denied."
paths: "package.json, .env.example"
metadata:
  kind: convention
  stack: [gcp, vertex-ai, gemini, adc, nodejs, typescript]
  provenance: observed in the author's own projects with LaneConductor
  prerequisites:
    - The user has run `gcloud auth application-default login` on this machine (the user runs it).
    - The Vertex AI API is enabled in <shared-project> and the user's account holds roles/aiplatform.user there (the user runs the grant if missing).
    - The app is Node/TypeScript with the @google/genai package.
  verified: 2026-11-17
  smoke_check: gcloud auth application-default print-access-token >/dev/null 2>&1 && echo ADC ok || echo ADC missing
---

## Why this works
Observed in the author's own projects with LaneConductor: several of them call Vertex AI with ADC,
and one migrated to it from an API key, so that there is no Gemini key to hold, log or leak (the
migration note lists exactly that as the motive). On a developer machine the ambient `gcloud` login
is the credential; in Cloud Functions the function's service account is. The shared project already
carries the billing and the API enablement, so a new product adds no key and no secret for Gemini.

## Recommendation
- The calls themselves go through TokenTalos (see llm-through-tokentalos); this skill covers the
  credentials, the project and the API that sit under it, and the bare-SDK shape for understanding
  them.
  For the generic SDK usage, the current model list and the ADC search order, see the `gemini-api`
  and `google-cloud-recipe-auth` skills in `google/skills`.
- Construct the client in Vertex mode, never with an API key:
  `new GoogleGenAI({ vertexai: true, project: process.env.GCP_PROJECT, location: process.env.GCP_REGION })`.
  Throw a clear error naming `GCP_PROJECT`/`GCP_REGION` and `.env.example` when either is unset.
- `.env.example` names `GCP_PROJECT=<shared-project>` and a model location variable. Gemini 3
  preview models are served from `global`, so the author's apps map an unset or `us-central1`
  location to `global`. There is no `GEMINI_API_KEY` line.
- Make the model an env override (`GEMINI_MODEL`) and default to the model the author's apps run:
  `gemini-3-flash-preview`, a Flash-tier model. Set `temperature: 0` for extraction work (one
  project measured it, see Pitfalls). Create the client lazily and cache it per `project:location`.
- Add the SDK's thinking tokens to your output-token count; they are billed as output but arrive in
  a different usage field.
- For a Cloud Function that calls Gemini, rely on the function's runtime service account, never a
  key file (see Unproven for the role).

## Claude does
- Write `src/gemini.ts` from `files/src/gemini.ts` and add `@google/genai` to the project.
- Add `GCP_PROJECT`, `GCP_REGION`, `GEMINI_MODEL` (empty) to `.env.example`. Never add a key variable.
- When a call fails with an ADC or permission error, read the error and hand the user the matching
  command from `## You run`. Do not ask for the command's output or for any token.

## You run
1. `gcloud auth application-default login` (opens a browser; run once per machine)
2. `gcloud services enable aiplatform.googleapis.com --project=<shared-project>`
3. Grant the Vertex AI User role to your own account if calls say permission denied:
   `gcloud projects add-iam-policy-binding <shared-project> --member="user:<your-google-account-email>" --role="roles/aiplatform.user"`
4. Check: the `smoke_check` command above.

## Pitfalls
- Vertex ADC and the Gemini Developer API are different modes of the same SDK. `vertexai: true` with
  ADC is the Vertex one; passing only `apiKey` silently selects the key mode. One of the author's
  projects still keeps that key path as a fallback (`GEMINI_API_KEY`/`GOOGLE_API_KEY`); do not copy
  it into a new product.
- `thinkingBudget: 0` turns thinking off on Flash/Flash-Lite but not on Pro (minimum non-zero budget
  128); 2.5 models take a token budget, 3.x models take a `thinkingLevel`, and the two cannot be
  combined. Unset thinking is dynamic and its tokens are billed as output (source: code comments
  in one project; not re-checked against current Google docs).
- Unset `temperature` is Gemini's most random default (1.0). One project got different answers for
  the same input on two runs and paid for retries (source: code comments in that project). Use 0
  for extraction and classification.
- Set a per-attempt timeout and retry count. The SDK's `retryOptions.attempts` defaults to 5
  (confirmed in the @google/genai docs for `HttpRetryOptions`). One project bounds it to
  `timeout: 30000` and `attempts: 2` after a real ~10 minute hang on a transient Vertex 503
  (source: a code comment there; the 1-hour backoff ceiling named in it is UNVERIFIED).
- Gemini 3 preview models and the image models are served from the global endpoint (see
  vertex-imagen-retry-gcs-fallback); use the function region only for a model that is served there.
  With `location: 'global'` one project also sets `apiEndpoint: 'aiplatform.googleapis.com'`.
- `GOOGLE_APPLICATION_CREDENTIALS` is optional and normally empty. If set, it must point at a file
  outside the repo; never commit one.
- Do not put a Google API key into a migration note or `.env` "as a backup". One migration note
  suggested keeping the key as a fallback during testing; that is how a key ends up in git.

## Unproven
- Whether `vertexai: true` is still the current constructor option: Google's own current skill text
  shows `enterprise: { project, location }` instead (read 2026-11-19, not run). UNVERIFIED either
  way; the gateway sets this for you.
- The role the deployed function's runtime service account needs in the shared project. One
  migration note grants `roles/aiplatform.user` to its App Engine default service account in its
  own, separate GCP project; nothing observed shows the shared project's function account. Check
  which service account the function runs as before granting.
- Whether the user's account already holds the role in the shared project (the grant in step 3 is
  idempotent but its prior state was not recorded).
