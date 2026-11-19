# LaneConductor Skills: Gemini

Skills for calling Gemini from Node.js: every LLM call through TokenTalos, Gemini on Vertex AI with Application Default Credentials, and image generation with retry and a GCS upload.

A skill pack for Claude Code, version 0.1.1, from the LaneConductor marketplace. It holds Markdown and template files only: no script, hook, MCP server or agent, and it sends nothing anywhere. It works on its own; LaneConductor is not required.

## Skills

- `llm-through-tokentalos`: How the author's apps call an LLM: every call goes through TokenTalos (@meller/tokentalos, the author's own MIT LLM gateway library on npm), one instance per process created lazily, Gemini on Vertex AI with ADC, usage and cost logged in the app's own database, a bounded timeout and retry policy, a deterministic stand-in for CI, and a bounded cache for per-user keys.
- `vertex-gemini-adc`: Call Gemini from a Node/TypeScript app through Vertex AI with Application Default Credentials in a shared GCP project (GCP_PROJECT / GCP_REGION), with no GEMINI_API_KEY anywhere in code, .env or Secret Manager.
- `vertex-imagen-retry-gcs-fallback`: Generate images on Vertex AI with ADC (Gemini image model, Imagen predict as the older route), retry 429 RESOURCE_EXHAUSTED with exponential backoff plus jitter, upload to a GCS bucket, and fall back to a local folder in development only.

## Install

```
claude plugin marketplace add meller/laneconductor
claude plugin install laneconductor-gemini@laneconductor
```

## Update

```
claude plugin marketplace update laneconductor
claude plugin update laneconductor-gemini@laneconductor
```

## Advice, never orders

These skills are one author's own conventions and the incidents behind them, observed in the author's own projects with LaneConductor. Claude may decide against one and say why. Names such as `<shared-project>` or `<product>` are placeholders you fill in for your own setup. See [docs/skills.md](https://github.com/meller/laneconductor/blob/main/docs/skills.md) for the format and for attaching skills to lanes.

## License

Elastic License 2.0; see [LICENSE](LICENSE). Privacy: https://github.com/meller/laneconductor/blob/main/docs/privacy.md. Questions and bugs: https://github.com/meller/laneconductor/issues
