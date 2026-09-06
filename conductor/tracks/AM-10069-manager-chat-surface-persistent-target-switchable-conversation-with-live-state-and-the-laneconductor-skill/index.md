# Track AM-10069: Manager chat surface — persistent, target-switchable conversation with live state and the /laneconductor skill

**Lane**: plan
**Lane Status**: queue
**Progress**: 0%
**Phase**: New
**Type**: dev
**Workspace**: branch
**Merge Mode**: pr
**Auto Run**: no
**Author**: AM
**Created By**: 2565050+meller@users.noreply.github.com
**Problem**: Today there is no persistent way to talk to a worker or the manager — only a per-track conversation panel, and the chat-target resolver returns null for manager workers entirely (manager chat is hard-disabled in the UI). There is no surface for "what is any given worker doing right now, and can I steer it" outside of watching a track's own transcript after the fact.

**Depends on Track 10067** ("Intelligent manager: an always-supervised, AI-capable health monitor with a watchable transcript"). 10067 is building the underlying plumbing this track needs — a chat-target resolver that knows about the manager (currently it does not; the resolver returns null and the composer is disabled for manager workers), a reserved pseudo-track so a project-less finding still has somewhere to post and stream to, and the watchable-transcript mechanism itself. This track explicitly does NOT rebuild that plumbing — it consumes it. 10067 stays scoped to health monitoring and supervision (the deterministic sweep, the bounded Layer-2 escalation, systemd supervision); this track stays scoped to the human-facing conversation surface built on top of it. Keep the boundary sharp during planning: if a requirement here turns out to need a change to the resolver or transcript format, that change belongs in 10067, not duplicated here.

**Scope of this track:**

1. **A persistent top-level nav item** (alongside Projects / Lanes / Workers / CI/CD), not another per-track modal. Default target is the manager; switchable to any other registered worker.

2. **Free-form input, not just canned buttons.** The pane should feel like Claude Code itself — you type a command or a question, not just click a fixed set of actions. Whatever the worker/manager's own tool output is (file edits, command runs, skill invocations) should be visible through the UI as it happens, not just the final text response.

3. **Intervention while a target is running.** Two different things could be meant by this, and the plan needs to pick one deliberately rather than let it stay ambiguous: (a) the cheap version — post a comment that the target picks up on its next natural check-in, which is close to the existing `track_chat`/`worker_adhoc_chat` dispatch pattern (conductor/services/orphaned-dispatch.mjs already special-cases these as running inline and synchronously, never through the normal lane-action spawn path); or (b) the expensive version — genuinely pausing a live `claude` subprocess and injecting a turn into it mid-stream, which nothing in this codebase currently supports (dispatched CLIs run one-shot with `--output-format stream-json`, not designed to accept injected input after the initial prompt). Recommend planning starts from (a) as the real v1 scope and treats (b) as an explicit stretch goal, not an assumed requirement.

4. **The manager has live state awareness of the LaneConductor instance and its projects** — tracks, lanes, worker health, config gaps — so it can answer questions and proactively flag missing setup, not just relay text. This should be queryable on demand (the same way a human driving the `/laneconductor` skill via a CLI session already gets this context), not a blind dump of full board state into every turn — that would be expensive and mostly irrelevant to whatever the user is actually asking about in a given message.

5. **A conditional "wizard" opening message.** When a project or the instance overall has genuinely incomplete setup (no projects, no workers registered, missing config), the chat's first message should proactively guide the user through filling it in. This must be conditional on real gaps, not shown to an already-configured returning user every time they open the pane — that would just be nagging.

6. **Under the hood, this is the `/laneconductor` skill made interactive.** The manager side of this chat is not a lightweight LLM wrapper around canned text — it needs real tool access (the same capability a Claude Code CLI session driving this project already has via the skill) to actually run commands, inspect state, and take the actions items 3-5 describe. Architecturally this is a real, resumable agent session with the skill loaded, surfaced through a web chat UI — not a new invention, but a different (and materially bigger) build than a chat widget.

**Open questions for planning**: which of the two intervention models (3a vs 3b) is v1; how much of the manager's system-state context is pre-loaded vs. queried on demand and what that costs per turn; what "genuinely incomplete setup" means precisely for gating the wizard message; and whether per-worker chat (as opposed to manager chat) needs the same live-state/skill-driven treatment or can stay a simpler transcript-plus-comment surface for v1.
**Summary**: Depends on track 10067's transcript/chat-target-resolver infrastructure; see Problem field for full scope.
