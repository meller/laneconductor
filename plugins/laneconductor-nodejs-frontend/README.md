# LaneConductor Skills: Node.js Frontend

Skills for Node.js front ends: an installable Vite PWA with Workbox, and browser speech synthesis that is actually audible.

A skill pack for Claude Code, version 0.1.0, from the LaneConductor marketplace. It holds Markdown and template files only: no script, hook, MCP server or agent, and it sends nothing anywhere. It works on its own; LaneConductor is not required.

## Skills

- `pwa-vite-workbox`: Make a Vite app an installable PWA with vite-plugin-pwa and Workbox the way the author's apps do: standalone manifest with maskable icons, a prompt-style update toast, the offline copy answering only the app's own routes, public pictures with a content revision, and the service worker off in development.
- `browser-tts-unlock-voice-binding`: Make browser text-to-speech (window.speechSynthesis) actually audible: unlock it with a silent utterance on the first user gesture, and bind an explicit SpeechSynthesisVoice to every utterance instead of setting only lang.

## Install

```
claude plugin marketplace add meller/laneconductor
claude plugin install laneconductor-nodejs-frontend@laneconductor
```

## Update

```
claude plugin marketplace update laneconductor
claude plugin update laneconductor-nodejs-frontend@laneconductor
```

## Advice, never orders

These skills are one author's own conventions and the incidents behind them, observed in the author's own projects with LaneConductor. Claude may decide against one and say why. Names such as `<shared-project>` or `<product>` are placeholders you fill in for your own setup. See [docs/skills.md](https://github.com/meller/laneconductor/blob/main/docs/skills.md) for the format and for attaching skills to lanes.

## License

Elastic License 2.0; see [LICENSE](LICENSE). Privacy: https://github.com/meller/laneconductor/blob/main/docs/privacy.md. Questions and bugs: https://github.com/meller/laneconductor/issues
