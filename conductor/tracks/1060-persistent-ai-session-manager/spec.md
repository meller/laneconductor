# Spec: Track 1060 — Persistent AI Session Manager

## Problem Statement

Every time a track activates, the worker spawns a fresh CLI process (`claude -p` or `npx gemini-cli -p`). The AI starts cold — it re-reads the skill file, product context, tech stack, and all track files on every single run. For active development sessions where multiple tracks or conversation rounds fire within an hour, this is pure waste: tokens, latency, and coherence lost.

The ideal model: keep a session warm for the duration of an active dev session, compress it when idle, and clear it only when truly stale. Any session lifetime > 0 is an improvement over today's always-clear model.

## Requirements

- **REQ-1**: Session metadata stored in `conductor/.sessions/` per project, keyed by CLI type
- **REQ-2**: Claude sessions use `--resume <session-id>` to continue existing conversations
- **REQ-3**: Gemini sessions accumulate a lightweight context summary file prepended to each prompt (Gemini CLI has no native resume flag)
- **REQ-4**: Sessions expire after 60 minutes of inactivity → cleared automatically
- **REQ-5**: After 15 minutes idle, a compression pass runs before the next track activation (Claude: summarize prompt via `--resume`; Gemini: rewrite summary file)
- **REQ-6**: Sessions are per-project, not per-track — the warm session spans all tracks in the project
- **REQ-7**: If session resume fails (stale ID, CLI error), fall back gracefully to a fresh session
- **REQ-8**: `conductor/.sessions/` is gitignored — sessions are ephemeral machine-local state

## Session Lifecycle

```
Track activates
    ↓
Session file exists + lastUsedAt < 60min ago?
    → YES: warm path — resume/prepend context
    → NO:  cold path — spawn fresh, create session file
    ↓
Run completes
    ↓
Update lastUsedAt in session file
    ↓
[Idle timer: checked on next activation]
    15min idle → mark needsCompression = true
    60min idle → delete session file (next run cold-starts)
```

## Session File Format

`conductor/.sessions/<cli>.json` (one per CLI type per project):

```json
{
  "cli": "claude",
  "sessionId": "abc123def456",
  "createdAt": "2026-03-12T10:00:00Z",
  "lastUsedAt": "2026-03-12T10:45:00Z",
  "needsCompression": false,
  "contextSummary": null
}
```

For Gemini (no native session ID):
```json
{
  "cli": "gemini",
  "sessionId": null,
  "createdAt": "2026-03-12T10:00:00Z",
  "lastUsedAt": "2026-03-12T10:45:00Z",
  "needsCompression": false,
  "contextSummary": "Phase 1 of track 1047 complete (SuperLC UI). Fixed worker heartbeat bug. Track 1059 brainstorm in progress — user wants language simplification for retail users."
}
```

## Claude Session ID Capture

Claude CLI stores sessions locally. The session/conversation ID can be captured by:
1. Running with `--output-format json` (if available) to get structured output including session ID
2. Or reading the most recently modified session file from `~/.claude/projects/<project-hash>/` after each run

## Gemini Context Accumulation

Since Gemini CLI has no resume flag, we prepend a compact context block to each prompt:

```
[SESSION CONTEXT — do not re-read files already covered here]
<contextSummary content>
[END CONTEXT]

/laneconductor implement 1060
```

After each Gemini run completes, a follow-up prompt asks Gemini to update the summary:
```
In 2-3 sentences, summarize what you just did for the session log. Be specific about track numbers and files changed.
```

## Acceptance Criteria

- [ ] Second run on same project within 60min uses `--resume` for Claude (verified via worker log)
- [ ] Second run on same project within 60min prepends context summary for Gemini
- [ ] After 60min+ idle, session file is deleted and next run cold-starts cleanly
- [ ] Session resume failure falls back to fresh session without crashing the worker
- [ ] `conductor/.sessions/` excluded from git
- [ ] Worker logs `[session] claude: warm resume <id>` or `[session] claude: cold start (new session)`
