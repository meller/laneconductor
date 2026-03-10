# Track 1003: LaneConductor App Billing

## Phase 1: Billing Requirements & Data Model Design

**Problem**: The system lacks a clear billing model definition and supporting database schema.
**Solution**: Design the complete data model for subscriptions, usage tracking, and billing history.

- [ ] Document billing tiers (Free, Pro, Enterprise) with pricing and limits
- [ ] Create database schema (customers, subscriptions, usage_metrics, billing_charges)
- [ ] Design Stripe integration points (webhooks, events)
- [ ] Design API contracts for billing endpoints
- [ ] Create migration scripts for new schema
- [ ] Document billing workflows (upgrade, downgrade, proration)

**Impact**: Clear billing model and database foundation ready for implementation.

---

## Phase 2: Payment Processing Infrastructure (Stripe Integration)

**Problem**: No payment processor connected; cannot accept payments or manage subscriptions.
**Solution**: Integrate Stripe for payment processing, subscription management, and webhook handling.

- [ ] Set up Stripe account and configure API keys
- [ ] Create Stripe webhook endpoint and signature verification
- [ ] Implement Stripe event listeners (charge.succeeded, invoice.payment_failed, customer.subscription.updated)
- [ ] Create subscription creation endpoint (tier selection, payment method)
- [ ] Implement idempotency key handling for Stripe API calls
- [ ] Add error handling and retry logic for failed charges
- [ ] Implement payment method management (add, update, delete)
- [ ] Create test suite for Stripe integration

**Impact**: Stripe fully integrated; subscriptions can be created and managed.

---

## Phase 3: Usage Tracking & Metering

**Problem**: No mechanism to track API calls, worker runs, and storage usage.
**Solution**: Implement usage tracking at key system points and aggregate daily.

- [ ] Add usage tracking middleware/hooks to API endpoints
- [ ] Add usage tracking to worker execution (laneconductor.sync.mjs)
- [ ] Create daily aggregation job (batch writes to usage_metrics)
- [ ] Implement usage-based billing calculation (overage detection)
- [ ] Add usage dashboard API endpoint (GET /api/billing/usage)
- [ ] Create usage alert system (warn users approaching limits)
- [ ] Test usage accuracy against logs

**Impact**: Accurate usage tracking enables billing calculations.

---

## Phase 4: Billing Dashboard & User Portal

**Problem**: Users have no visibility into their billing status, usage, or invoices.
**Solution**: Build UI for users to manage subscriptions, view usage, and access invoices.

- [ ] Create billing dashboard page (current tier, usage graph, renewal date)
- [ ] Add tier selection modal (upgrade/downgrade)
- [ ] Implement proration calculation and display
- [ ] Create payment method manager (add new, set default, delete)
- [ ] Add invoice download functionality (PDF generation)
- [ ] Create usage chart (daily API calls, worker runs, storage trend)
- [ ] Add billing history/ledger table
- [ ] Style for LaneConductor UI (dark/light mode, responsive)

**Impact**: Users have self-service billing portal.

---

## Phase 5: Admin Analytics & Reporting

**Problem**: No visibility into revenue, churn, tier distribution, or customer health.
**Solution**: Build admin dashboard for business metrics and decision-making.

- [ ] Create admin billing dashboard page
- [ ] Implement MRR (Monthly Recurring Revenue) calculation
- [ ] Add churn analysis (cancelled subscriptions trend)
- [ ] Create tier distribution chart (customers per tier)
- [ ] Add revenue forecast (projected MRR)
- [ ] Create customer list with tier, usage, and LTV
- [ ] Implement refund management UI
- [ ] Add CSV export for reporting

**Impact**: Business visibility into billing health and revenue trends.

---

## Status Tracking
- [x] Phase 1: Planning started
- [ ] Phase 2: Payment infrastructure
- [ ] Phase 3: Usage metering
- [ ] Phase 4: User dashboard
- [ ] Phase 5: Admin analytics
