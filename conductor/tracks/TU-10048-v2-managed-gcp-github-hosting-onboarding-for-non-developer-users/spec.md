# Spec

Direction captured from a manager-conversation discussion (2026-09-07) on how v2 should
handle infra ownership, billing, and onboarding for non-technical users. This is direction,
not a finished spec — several items below are explicitly flagged as still open for the
actual planning pass.

## Business Model — Bundled Credit Pricing (Base44-style)

- Free tier for acquisition: enough free credits to get to a working app with zero payment
  info, matching the non-technical user's need to see value before paying anything.
- Paid tiers priced as a single credit/usage allowance per tier, never itemized by provider —
  the user never sees a separate "hosting bill" or "AI bill." Inference cost (Anthropic) and
  compute cost (GCP) are both absorbed into the credit price, marked up, internally.
- Usage-gated upgrade pressure ("you ran out of credits"), not seat-gated — matches a
  solo-usage product.
- **$5 proof-of-value SKU**: a single non-renewing credit bundle, not a recurring tier — fixed
  Claude generation credits (enough to scaffold + iterate a small app a handful of times) plus
  a capped hosting allotment (smallest Cloud Run tier, bounded by time, e.g. 30 days, and/or
  request count). Expires unused, no auto-renewal, so it stays a proof-of-value SKU and not an
  accidental subscription. To the user: "$5 → one working app, live," never a usage invoice.
- "Token and usage-based" metering applies internally (to know our real margin and enforce the
  cap), never surfaced to a non-technical buyer as a line-itemized bill.

## Infrastructure Ownership

| Piece | Owner | Billing | Notes |
|-------|-------|---------|-------|
| GCP compute | LaneConductor | Usage passthrough + margin | Not a formal reseller-of-record relationship — "operate infra, pass through cost + margin," the same model Vercel/Netlify/Render/Railway already run. Per-tenant GCP projects or strict IAM scoping within a shared project (still open, see below). |
| Claude / Anthropic | LaneConductor | Usage passthrough + margin | Standard AI-provider-markup pattern. Diligence item: confirm Anthropic's commercial terms permit this resale/markup shape. |
| GitHub | LaneConductor (private repo, own account/org) | N/A (not metered) | Reverses an earlier direction (GitHub App delegated into the *user's* account) — see below for why, and how the liability tradeoff that reversal reintroduces is being mitigated. |

Both GCP and Claude are zero-setup **and** zero-visibility for the user — there is no
"later" screen for either, because there's nothing of the user's to show. This is different
from the GitHub row, see UX Principle below.

## GitHub Ownership Model — Legal + Technical Split

The repo is created and held under a LaneConductor-owned GitHub account/org, private, from
creation — not a GitHub App installed into the user's own account. This is a deliberate
reversal of the earlier delegation-only direction: it removes the one unavoidable
manual-consent step from onboarding (no "Install GitHub App" screen), and we need write
access to build/deploy on the repo either way. The tradeoff this reintroduces — LaneConductor
holding custody of private customer source, i.e. real subpoena/dispute/IP-liability exposure —
is handled with two separate levers, not one:

**Legal**: a signed license/agreement the user explicitly accepts during onboarding (stronger
than a passive ToS clause). It states plainly that the user retains full IP ownership of their
code regardless of which account technically holds the GitHub repo, and that LaneConductor's
license to the code is limited to what's needed to build, host, and run it on the user's
behalf for as long as they use the service — nothing broader. Paired with an always-visible,
self-serve "Transfer to your GitHub" action (not settings-buried, not plan-gated), so the
GitHub owner field can be made to match the contractual reality at any time, not just in
theory.

**Technical (least-privilege, not zero-privilege)**: "least needed permission" can't mean no
read/write at all — the automated build/deploy pipeline has to read the code to build and run
it, and has to write to it, since an AI agent modifying the app on the user's behalf *is* the
product. What's actually achievable and worth committing to:
- No standing human/staff access — no LaneConductor engineer's personal GitHub credentials
  ever touch a customer repo. All access goes through a machine identity used exclusively by
  the automated pipeline.
- Repo-scoped credentials — a fine-grained, per-repo token or GitHub App installation
  restricted to that single repository, never an org-wide PAT or "all repos" scope.
- No admin scope — contents read/write only; no settings changes, no delete, no
  ownership/collaborator changes outside the explicit user-triggered transfer flow.
- Auditable — every automated access attributable to a specific track/run, consistent with
  the product's own "know what every agent is doing" principle, rather than an anonymous
  shared credential.

The liability reduction here comes from scope, attribution, and the signed agreement — not
from eliminating read/write, which isn't mechanically possible without breaking the feature.

## Auth / Onboarding Flow

1. Sign in with Google — LaneConductor's existing auth, unchanged. Authenticates identity
   only; Google has no authority to grant GitHub scopes, so this step alone can't cover
   GitHub.
2. GitHub repo creation is now silent/zero-setup for the user (no GitHub App consent screen),
   since the repo lives under LaneConductor's own account rather than the user's.
3. The signed license/agreement (see above) is presented as part of this same continuation —
   framed as accepting service terms, not a technical permission grant, and chained directly
   onto step 1 so it reads as one onboarding step, not a detour.

## UX Principle

Nothing is ever *set up* by the user. What varies per infra piece is *visibility*, not setup:
- GCP + Claude: zero setup and zero visibility, ever — fully ours, bundled into the credit
  price, no "later" screen because there's nothing of the user's to look at.
- GitHub: zero setup, but a persistent *optional* reveal/export/transfer affordance, because
  the repo content is the user's IP — this is the payoff of ownership, not friction, but it
  must never sit on the critical idea-to-running-app path.

One input (the idea) → zero required setup across GCP/Claude/GitHub → exactly one optional
reveal affordance (GitHub transfer), never required, never on the critical path.

## Open Questions (still open — for planning, not resolved here)

- **Isolation**: per-tenant GCP projects vs. a single project with strict IAM scoping — this
  direction leans per-tenant/scoped but hasn't picked one.
- **License/agreement drafting**: the direction above is the intended shape, not actual legal
  language — needs real drafting (and likely counsel review) before it's a real onboarding
  step.
- **Technical mechanism for GitHub least-privilege**: fine-grained per-repo PAT vs. a GitHub
  App installed on LaneConductor's *own* org (same least-privilege intent, different
  mechanics) — to decide during planning.
- **Relationship to BYO path**: managed and BYO must coexist, not replace one another; track
  1120's real-credential deploy verification work applies to both.

This track remains deliberately deferred (`Auto Run: no`, `backlog`) — this spec captures
shape for when there's real demand signal, per the track's own stated reason for waiting
(security/liability of holding others' cloud credentials, not effort).
