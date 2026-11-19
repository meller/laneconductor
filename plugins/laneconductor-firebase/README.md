# LaneConductor Skills: Firebase

Skills for Firebase and one shared GCP project: a Hosting site and Functions codebase per product, cache busting after deploys, and Google-only sign-in.

A skill pack for Claude Code, version 0.1.0, from the LaneConductor marketplace. It holds Markdown and template files only: no script, hook, MCP server or agent, and it sends nothing anywhere. It works on its own; LaneConductor is not required.

## Skills

- `shared-gcp-firebase-site`: Host a new product as its own Firebase Hosting site plus its own Functions codebase inside one shared GCP project (<shared-project>), with deploys scoped to that product only. Not a new GCP project per product.
- `cache-buster`: Make sure users get a new deploy: Firebase Hosting headers that keep index.html uncached and hashed assets immutable, a build stamp written into index.html and the bundle, a poll that compares the two and shows a Reload banner, and a one-shot recovery when a stale tab asks for files the deploy removed.
- `firebase-google-sign-in`: Add Google-only sign-in to a web app with Firebase Auth in the shared GCP project: popup sign-in in the browser, a Bearer ID token verified on the server with firebase-admin and ADC, and a provisionUser step that maps the Firebase uid to a database row once and survives the first-load race.

## Install

```
claude plugin marketplace add meller/laneconductor
claude plugin install laneconductor-firebase@laneconductor
```

## Update

```
claude plugin marketplace update laneconductor
claude plugin update laneconductor-firebase@laneconductor
```

## Advice, never orders

These skills are one author's own conventions and the incidents behind them, observed in the author's own projects with LaneConductor. Claude may decide against one and say why. Names such as `<shared-project>` or `<product>` are placeholders you fill in for your own setup. See [docs/skills.md](https://github.com/meller/laneconductor/blob/main/docs/skills.md) for the format and for attaching skills to lanes.

## License

Elastic License 2.0; see [LICENSE](LICENSE). Privacy: https://github.com/meller/laneconductor/blob/main/docs/privacy.md. Questions and bugs: https://github.com/meller/laneconductor/issues
