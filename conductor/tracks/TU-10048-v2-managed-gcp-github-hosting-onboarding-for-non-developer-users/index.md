# Track TU-10048: V2: Managed GCP/GitHub Hosting — Onboarding for Non-Developer Users

**Lane**: backlog
**Lane Status**: queue
**Progress**: 0%
**Phase**: New
**Type**: dev
**Auto Run**: no
**Author**: TU
**Created By**: test@example.com
**Summary**: Currently LaneConductor targets developers who bring their own GCP + GitHub credentials and self-host. V2 direction: offer a managed/hosted option where LaneConductor holds the GCP + GitHub…

This is a deliberate v2 -- not something to build now. BYO-credentials is the right starting point (smaller build, matches the current developer-focused audience, no multi-tenant infra/billing/liability burden). This track exists to capture the requirements/shape of the managed option for when there is real demand signal that self-setup is a blocker for a meaningful audience.

Open questions to resolve during planning, not now:
- Credential model: LaneConductor's own GCP org managing per-user projects vs. a lighter delegation/impersonation model where users grant scoped access without LaneConductor ever holding raw keys.
- Isolation: how deployments/data for different users stay isolated within a shared GCP/GitHub App integration -- per-user GCP projects vs. a single project with strict IAM scoping.
- Onboarding flow: what a non-technical user actually walks through (GitHub App install + OAuth, GCP project creation or delegation) to get from signup to first deploy.
- Billing: whether/how GCP usage costs get passed through to the user vs. absorbed, and what happens at scale.
- Relationship to the existing BYO path: managed and BYO likely need to coexist (track 1120's real-credential deploy verification work applies to both), not replace one another.
- Security/liability surface of holding other people's cloud credentials or delegated access -- this is the main reason to defer, not just engineering effort.

Related: track 1120 (Wizard Real-Deploy Verification) already exercises the deploy pipeline against real credentials and is a prerequisite piece of groundwork regardless of which hosting model ships first.
