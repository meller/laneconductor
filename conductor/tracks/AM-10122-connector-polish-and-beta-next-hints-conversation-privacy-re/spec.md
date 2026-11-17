# Spec: Connector polish and beta: next hints, conversation privacy, real-session beta run (carved out of 10106)

## Problem Statement

Carved out of track 10106 when it was closed on 2026-11-17. These are the local-connector leftovers; none blocks using the plugin.

- Self-describing responses (10106 Phase 5b): a `next` field in the response envelope (string or null) with the rules in REQ-24, the handlers that already produce hints using it, tests that every tool returns it and it never triggers an action, and a mention in the server instructions (stay under 4,096 characters) and the README.
- Conversation privacy (10106 Phase 5, D5): a `connector.track_conversations` setting in `.laneconductor.json`, default false; a secret and personal-data scan before the connector commits any conversation turn or update body; and the PROPOSED item (needs the human's OK): decisions as a first-class tracked artifact, because an ignored conversation.md is per machine and drifts between computers. This pairs with the hooks work in track 10115 (a session-start brief and decision capture).
- Beta run (10106 Phases 1, 5c, 5d, 5e, 6, 10; human-judged): the real-session checks (add the probe in Claude Code and on claude.ai web, the plugin install check, a scratch project, B-a to B-g scenarios, a token measurement against skill-only), the overview board page and the board privacy check against project visibility (5d Tasks 5-6), then the keep, change or remove decision from `health_report` after at least 2 weeks and 10 sessions.

Why backlog: the plugin works today and the beta decision is a human judgement made from real use, not from more code. Do the `next` field and the privacy setting only if real use shows the need.

## Requirements

(To be written in the plan lane.)
