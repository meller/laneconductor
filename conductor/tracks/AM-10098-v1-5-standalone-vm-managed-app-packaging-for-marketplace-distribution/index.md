# Track AM-10098: V1.5: Standalone VM / Managed-App packaging for marketplace distribution

**Lane**: plan
**Lane Status**: running
**Progress**: 0%
**Phase**: New
**Type**: dev
**Merge Mode**: direct
**Auto Run**: yes
**Author**: AM
**Created By**: 2565050+meller@users.noreply.github.com
**Problem**: Deliberate v1.5 -- capturing the shape and prerequisites, not something to build immediately, matching the same deferred-capture pattern as TU-10048 (V2 managed hosting). Distinct from and simpler than V2: v1.5 is single-tenant -- a customer deploys their own standalone instance into their own cloud subscription (an Azure Managed Application ARM/Bicep template deploying a container/VM, or a bare marketplace VM image) -- not LaneConductor holding shared multi-tenant credentials, billing, or infrastructure. This sidesteps V2s main blockers entirely (no multi-tenant isolation, no held customer GCP/GitHub credentials, no shared billing/liability surface) which is why this is the nearer-term, lower-risk distribution path.

Rationale for this direction over V2 first (from prior planning discussion): a standalone per-customer instance is materially easier to debug (no shared remote-sync infrastructure, no cross-tenant state) and avoids retrofitting multi-tenancy into a codebase that assumes one project/one local Postgres per install. Confirmed via direct reading of this repos own LICENSE (Elastic License 2.0, copyright held by the author): ELv2 restricts a LICENSEE from offering the software as a hosted/managed service to third parties -- it places no such restriction on the copyright holder/licensor distributing it themselves via a VM image or Managed Application listing, so this path is legally clear.

Groundwork already shipped this session that directly de-risks this: AM-10093 (a written lane change could be silently reverted by a stale concurrent auto-launch dispatch or DB pull -- explicitly flagged at the time as a marketplace/managed-app hardening risk, since a customers repeatedly-restarted instance during upgrades or crashes would plausibly hit exactly this race), AM-10097 (the CLI setup and skill-only scaffold paths now both write a correct, complete .gitignore for every new project, closing a real "works on my dogfooded install, breaks on a fresh customer install" gap), and AM-10096 (the nested .claude/.claude corruption bug and its cleanup tooling, which would otherwise silently bloat a customers own repo over time).

Open questions to resolve during planning, not now:
- Packaging format: a single VM image (AMI/Azure VHD/GCP image) with LaneConductor + Postgres + the UI pre-installed and auto-starting, vs. a containerized deployment (docker-compose or a single container) driven by an Azure Managed Application ARM/Bicep template or an AWS/GCP marketplace listing.
- First-run experience: how a non-technical customer goes from "deployed the VM/app" to a working, configured instance -- does `lc setup`s existing interactive wizard need a non-interactive/pre-seeded mode for this, and does the wizard need to collect a license key or usage identifier.
- Update mechanism: how a deployed customer instance receives fixes/updates (this repos own canonical-install model, where `lc start` uses the shared install paths sync worker, does not directly translate to an isolated customer VM with no shared filesystem) -- in-place VM image update, a `lc update` pull-and-restart command, or customer-managed.
- Licensing/entitlement: whether the marketplace listing needs any usage-gating or license-key check at all, given ELv2 already legally prevents a licensee from re-offering it as a hosted service regardless of a technical gate.
- Support/telemetry: whether a deployed customer instance should phone home at all (crash reports, anonymous usage) given the products own "Sovereign: 100% local, no cloud, no cost" positioning in product.md -- likely opt-in only, if anything.
- Marketplace-specific requirements: listing requirements for the target marketplace(s) (Azure Marketplace Managed Application certification, AWS Marketplace AMI requirements, etc.) -- these are per-platform bureaucratic requirements, not engineering ones, and should be scoped once a target platform is chosen.
- Pricing/packaging: out of scope for this track entirely -- a business decision, not a technical requirement.

Related: track 1120 (Wizard Real-Deploy Verification) and TU-10048 (V2 managed hosting) both touch adjacent ground -- 1120s real-credential deploy pipeline work is a prerequisite for a customers own first-run deploy regardless of which distribution model ships, and V2s open questions about onboarding/credential handling are a superset of this tracks simpler single-tenant case, worth cross-referencing if V2 is ever revisited.
