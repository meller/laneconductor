# Product Marketing Context

*Last updated: 2026-03-11*

## Product Overview
**One-liner:** A local-first, multi-agent control plane for AI-driven development.
**What it does:** LaneConductor orchestrates AI agents (Claude, Gemini, etc.) across multiple repositories, providing real-time visibility through a Kanban dashboard. It bridges local Markdown state with a persistent database via a bidirectional sync loop.
**Product category:** AI Agent Orchestration / Developer Productivity Tool.
**Product type:** Developer Tool (CLI + Local UI).
**Business model:** Open Source / Self-Hosted.

## Target Audience
**Target companies:** AI-forward software companies, startups, and solo developers.
**Decision-makers:** Lead Engineers, Founders, Solo Developers.
**Primary use case:** Managing multiple AI agent tasks simultaneously across different repos with full visibility and zero context loss.
**Jobs to be done:**
- Track AI agent progress without tailing terminal logs.
- Manage multiple feature branches worked on by different AI models.
- Maintain persistent "agentic memory" when switching models.
**Use cases:**
- High-velocity feature development.
- Multi-repo orchestration.
- Privacy-conscious agentic workflows.

## Personas
| Persona | Cares about | Challenge | Value we promise |
|---------|-------------|-----------|------------------|
| Solo Founder | Velocity | Context switching between tasks | "One pane of glass" for all AI work |
| Privacy-Conscious Engineer | Data Sovereignty | Cloud-based AI tools leaking IP | 100% local, air-gapped orchestration |
| Team Lead | Visibility | Knowing what agents are doing in real-time | Real-time Kanban board syncing with terminal |

## Problems & Pain Points
**Core problem:** AI context is trapped in proprietary UIs or lost between sessions; tracking multiple running agents is chaotic.
**Why alternatives fall short:**
- Proprietary lock-in: Most tools only work with their own agent/model.
- Visibility gap: "Black box" execution requires constant monitoring.
- Cloud dependency: Privacy risks and subscription costs.
**What it costs them:** Developer burnout, context loss, and slower release cycles.
**Emotional tension:** The stress of managing autonomous agents without a control plane.

## Competitive Landscape
**Direct:** Cursor (Composer), Windsurf, Claude Code.
**Secondary:** Jira/Trello (require manual updates).
**Indirect:** Manual log tailing and custom shell scripts.

## Differentiation
**Key differentiators:**
- Sovereign: Everything runs on your machine.
- Multi-Agent: Vendor agnostic (Claude, Gemini, etc.).
- Markdown-First: Filesystem as the source of truth.
**How we do it differently:** Bi-directional sync loop between filesystem and UI.
**Why that's better:** Naturally version-controlled, air-gapped, and enables model-to-model collaboration.
**Why customers choose us:** For the "split-screen magic" and professional-grade security.

## Objections
| Objection | Response |
|-----------|----------|
| "Why not just use Cursor?" | LaneConductor is model-agnostic and manages multi-repo orchestration at scale. |
| "Is it complex to set up?" | Three commands to a live dashboard (`lc setup`, `lc start`, `lc ui start`). |

**Anti-persona:** Developers who only use one model for simple, single-file scripts.

## Switching Dynamics
**Push:** Frustration with "losing the thread" when an agent crashes or switching windows.
**Pull:** The aesthetic and functional clarity of a real-time Kanban board.
**Habit:** Tailing logs in multiple terminal tabs.
**Anxiety:** "Is another database going to slow down my machine?" (LaneConductor is lightweight and optimized).

## Customer Language
**How they describe the problem:**
- "I have no idea what my agent is doing right now."
- "I lost the context when I switched from Claude to Gemini."
**How they describe us:**
- "The control plane for my AI fleet."
- "A beautiful Kanban for my terminal."
**Words to use:** Sovereign, Orchestration, Control Plane, Real-time visibility, Agentic Memory.
**Words to avoid:** SaaS, Cloud-based, Subscription, Proprietary.

## Brand Voice
**Tone:** Professional, Technical, Empowering.
**Style:** Direct, Minimalist, High-performance.
**Personality:** Secure, Reliable, Sleek.

## Proof Points
**Metrics:** 2s UI polling, 5s heartbeat interval, $0 monthly cost.
**Value themes:**
| Theme | Proof |
|-------|-------|
| Velocity | Instant sync between terminal and UI |
| Security | Air-gapped/Local-only architecture |

## Goals
**Business goal:** Become the standard orchestration layer for technical teams using AI agents.
**Conversion action:** Github Star / `make install`.
