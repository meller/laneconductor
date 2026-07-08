# Competitive Landscape — LaneConductor

## Where We Sit

LaneConductor is the **AI orchestration layer for the whole business** — local-first, multi-domain (dev + marketing + sales + support), with a closed KPI measurement loop. No direct competitor combines all three of these dimensions today.

---

## Direct Competitors

### AI Dev Agent / Orchestration

| Tool | What it does | Why we're different |
|------|-------------|---------------------|
| **Devin / SWE-agent** | Autonomous coding agents | Cloud-only, dev-only, no cross-domain tracks, no KPI loop |
| **OpenHands** (fka OpenDevin) | Open-source AI coding agent | Dev-only, no orchestration layer, no measurement |
| **Cursor / Windsurf** | AI-powered IDE | Single developer in-editor, no workflow orchestration |
| **Aider** | CLI coding agent | Dev-only, no project/track mental model |

### Project Management / Dev Tracking

| Tool | What it does | Why we're different |
|------|-------------|---------------------|
| **Linear** | Excellent dev issue tracker | Zero AI execution, cloud-only SaaS, dev-only |
| **GitHub Projects** | Dev-only PM board | No AI execution, no measurement, no cross-domain |
| **Jira** | Enterprise project management | We sync *to* Jira rather than compete head-on |
| **Shortcut** | Dev PM tool | Dev-only, no AI agents, no KPI loop |

### AI Business Automation

| Tool | What it does | Why we're different |
|------|-------------|---------------------|
| **n8n / Zapier** | Workflow automation | Not AI-native, no track/project mental model, no measurement loop |
| **Make (Integromat)** | Visual automation | Same as n8n — trigger-action model, not agent orchestration |
| **AgentOps / LangSmith** | AI observability | Monitoring, not orchestration; dev-focused infra tool |

---

## Differentiators

- **Local-first / sovereign**: Everything runs on your machine. No cloud upload, no auth, no SaaS subscription. Privacy-first for business data.
- **Multi-domain**: Dev, marketing, sales, and support tracks are first-class citizens on one board. No other tool treats a launch post and a feature branch as peers.
- **Closed KPI loop (autoresearch)**: Tracks define their own success metric upfront. The worker automatically measures it after the window closes, and reschedules if the threshold isn't met. Ships don't count until they work.
- **Multi-agent**: Run Claude + Gemini (or any CLI agent) side-by-side on different tracks. The orchestration layer is agent-agnostic.
- **AI-native workflow**: Designed for autonomous agent execution, not for human project managers clicking through boards.

---

## The Unoccupied Space

The combination of (1) local-first sovereign + (2) cross-domain tracks + (3) autoresearch KPI loop + (4) multi-agent execution is the gap nobody occupies.

The closest mental model is: **Linear × n8n × measurement**, but AI-native and self-hosted.

---

## Positioning vs. Common Framings

| Framing to avoid | Why | Better framing |
|-----------------|-----|----------------|
| "Swiss Army knife" | Implies general-purpose utility tool | "Operating layer" — purpose-built for AI-driven business execution |
| "Project tracker" | Passive — humans do the work | "Orchestration layer" — agents execute the work |
| "Dev tool" | Leaves marketing/sales/support invisible | "AI orchestration for your whole business" |
| "Alternative to Jira" | Positions us as a PM replacement | We *integrate* with Jira; we add AI execution on top |
