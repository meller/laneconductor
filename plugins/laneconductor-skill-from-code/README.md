# LaneConductor Skills: Authoring

Skills for authoring: turn a pattern or a verified incident, shown by working code, into a new skill, and package your skills as Claude plugins and submit them to the plugin directory.

A skill pack for Claude Code, version 0.2.0, from the LaneConductor marketplace. It holds Markdown and template files only: no script, hook, MCP server or agent, and it sends nothing anywhere. It works on its own; LaneConductor is not required.

## Skills

- `plugin-from-skills`: Package your skills into Claude plugins, publish them from your own marketplace, and optionally submit a Markdown-only plugin to Anthropic's plugin directory: a skills folder, a pack list, a small generator, the local checks, the portal steps and answers, and what to do about policy holds.
- `skill-from-code`: Use when a verified solution to a hard problem should become one of these skills, when the user says save this as a skill, capture this, remember this convention or add this to my homebrew skills, or when a skill in the library is wrong, stale or unused and should be rewritten or retired.

## Install

```
claude plugin marketplace add meller/laneconductor
claude plugin install laneconductor-skill-from-code@laneconductor
```

## Update

```
claude plugin marketplace update laneconductor
claude plugin update laneconductor-skill-from-code@laneconductor
```

## Advice, never orders

These skills are one author's own conventions and the incidents behind them, observed in the author's own projects with LaneConductor. Claude may decide against one and say why. Names such as `<shared-project>` or `<product>` are placeholders you fill in for your own setup. See [docs/skills.md](https://github.com/meller/laneconductor/blob/main/docs/skills.md) for the format and for attaching skills to lanes.

## License

Elastic License 2.0; see [LICENSE](LICENSE). Privacy: https://github.com/meller/laneconductor/blob/main/docs/privacy.md. Questions and bugs: https://github.com/meller/laneconductor/issues
