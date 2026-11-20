# LaneConductor Skills: Analytics, Monitoring and Logging

Skills for knowing how a product does, starting with analytics: Google Analytics 4 behind a consent choice, advertising features off, with Search Console ownership and a tested sitemap.xml and robots.txt.

A skill pack for Claude Code, version 0.1.0, from the LaneConductor marketplace. It holds Markdown and template files only: no script, hook, MCP server or agent, and it sends nothing anywhere. It works on its own; LaneConductor is not required.

## Skills

- `ga4-gtag-with-consent`: Add Google Analytics 4 the privacy-friendly way: Google's own tag (gtag.js) with your own measurement id, loaded only after the visitor accepts, advertising features off, an opt-out that stops sending, a few named events with safe parameters, a first-touch campaign source, plus Search Console ownership and a real sitemap.xml and robots.txt with a test.

## Install

```
claude plugin marketplace add meller/laneconductor
claude plugin install laneconductor-analytics-monitoring@laneconductor
```

## Update

```
claude plugin marketplace update laneconductor
claude plugin update laneconductor-analytics-monitoring@laneconductor
```

## Advice, never orders

These skills are one author's own conventions and the incidents behind them, observed in the author's own projects with LaneConductor. Claude may decide against one and say why. Names such as `<shared-project>` or `<product>` are placeholders you fill in for your own setup. See [docs/skills.md](https://github.com/meller/laneconductor/blob/main/docs/skills.md) for the format and for attaching skills to lanes.

## License

Elastic License 2.0; see [LICENSE](LICENSE). Privacy: https://github.com/meller/laneconductor/blob/main/docs/privacy.md. Questions and bugs: https://github.com/meller/laneconductor/issues
