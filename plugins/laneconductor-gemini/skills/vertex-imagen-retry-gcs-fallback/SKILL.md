---
name: vertex-imagen-retry-gcs-fallback
description: "Generate images on Vertex AI with ADC (Gemini image model, Imagen predict as the older route), retry 429 RESOURCE_EXHAUSTED with exponential backoff plus jitter, upload to a GCS bucket, and fall back to a local folder in development only."
when_to_use: "Use when adding AI image or illustration generation, calling Imagen or a Gemini image model, saving generated images to Cloud Storage or GCS_BUCKET, or when image calls fail with 429 or RESOURCE_EXHAUSTED, or stored image URLs point at localhost."
paths: "package.json, .env.example"
metadata:
  kind: convention
  stack: [gcp, vertex-ai, gemini-image, imagen, gcs, nodejs, typescript]
  provenance: observed in the author's own projects with LaneConductor
  prerequisites:
    - The vertex-gemini-adc skill is in place (ADC login done by the user, Vertex AI enabled in the project).
    - A GCS bucket <bucket> exists for the product's images and the function or the developer account may write to it (the user creates the bucket and grants access).
  verified: 2026-11-17
---

## Why this works
Observed in the author's own projects with LaneConductor: two products retry image-generation 429s
with the same backoff, written first in one and ported to the other, so the numbers below are the
ones already in use. Both products also shipped the same bug: the local-development fallback ran
in production and stored `http://localhost...` URLs that fail for every visitor. This skill keeps
the proven backoff and makes the fallback development-only.

## Recommendation
- Prefer a Gemini image model through `generateContent` with `responseModalities: [Modality.IMAGE]`
  on location `global` (one project: `gemini-3.1-flash-lite-image`, env override `IMAGE_MODEL`). The
  Imagen 4 predict route the older project uses is listed as discontinued on Google's Imagen 4 page
  (see Pitfalls).
- Retry only the generation call, on HTTP 429 or a message matching `RESOURCE_EXHAUSTED`, at most 5
  times, waiting `2^n * 5000 + random(0..2000)` ms (about 5, 10, 20, 40, 80 s). Inject the client and
  a `sleep` so tests skip the delay.
- Upload to `GCS_BUCKET` with `contentType` and `cacheControl: "public, max-age=31536000"`, return
  `https://storage.googleapis.com/<bucket>/<key>`. Never store image bytes in the database.
- Local fallback (`generated-images/`) only when `LOCAL_DEV=true` or when not in production; in
  production rethrow. Store the same-origin path `/generated-images/<key>` in the database.
- Budget images, they dominate cost (see Pitfalls).

## Claude does
- Write `src/illustration/imageGenerator.ts` and `gcsUploader.ts` from `files/src/illustration/` and add
  `@google/genai` and `@google-cloud/storage`.
- Add `IMAGE_MODEL`, `GCS_BUCKET`, `LOCAL_DEV` to `.env.example` with empty values and a comment.
- In development, serve the folder with a static route only when `NODE_ENV !== "production"`, and
  make tests pass a temp `localDir`.
- Add a unit test with a fake client that throws a 429 twice and a `sleep` that records delays.

## You run
1. Create the product's bucket and grant the app's service account write access, for example
   `gcloud storage buckets create gs://<bucket> --location=us-central1 --project=<shared-project>`
   and an IAM binding for the function's service account (role choice is yours; see Unproven).
2. Make the images readable by visitors if they are shown directly from GCS (public read is a
   decision for you, not Claude).
3. Set `GCS_BUCKET` in your local `.env`, and in the deploy environment of the function.

## Pitfalls
- Production stored localhost URLs. In one project the expected bucket did not exist, uploads
  failed, the fallback wrote `localhost` URLs, and the browser reported CORS errors; the fix was a
  real bucket and an explicit bucket name. In the other, every scene illustration showed the same
  symptom and was repaired by relinking to `/generated-images/<key>`. Both fallbacks still swallow
  upload errors in production; the template does not.
- Retry the call, not the whole job. One implementation recurses on 429 at the page level, which
  re-reads the database and re-builds the prompt on every retry; the other retries only
  `generate()`.
- Tests wiped real developer images: a test suite writing to `<cwd>/generated-images` deleted and
  overwrote real PNGs (a code comment in one project). Always inject `localDir` in tests.
- Image generation was 87% of one import's cost; capping scenes by text length cut image cost 67%
  (figures from commit messages in one project). Ask for the maximum number of images, then
  enforce it in code; a prompt is a request.
- The Imagen 4 model page on Google Cloud lists `imagen-4.0-generate-001`, `-fast-` and `-ultra-`
  as discontinued with a migration deadline of 2026-06-30 (read 2026-11-17 through a page
  summariser; UNVERIFIED, re-check before relying on the predict route). The author's apps use the
  Gemini 3.1 image models (`gemini-3.1-flash-image`, `gemini-3.1-flash-lite-image`) instead. One project
  also reports that its shared project has Gemini image models enabled but not the separate Imagen
  model-garden grant (a code comment, not independently checked).
- Gemini image models only attempt seed reproducibility, unlike Imagen (a code comment in one
  project; UNVERIFIED against Google docs). Pass `seed` as a config parameter, not only inside the
  prompt.
- Google's own guidance for 429 on Vertex AI is truncated exponential backoff (confirmed on its
  429 error page); the 2^n*5000 values are the author's, not Google's. Google's skills repository
  adds that a 429 often means the shared quota pool is exhausted, not that your project's quota is
  hit, so a quota increase may not help (read 2026-11-19, not run). For the generic parts see
  `harden-llm-app-reliability` (retry classes, `Retry-After`) and Google's `gemini-api` skill
  (`media_generation`).
- A safety-filtered response has no image part; treat it as a distinct error, not a 429.

## Unproven
- Which IAM role the function's service account needs for GCS writes in the shared project; nothing
  observed records it (one commit message only says "granting IAM permissions").
- Whether the production-throwing fallback in the template matches what you want for batch scripts
  that run on a developer machine with `NODE_ENV` unset; the author's projects keep the
  swallow-and-fallback behaviour.
