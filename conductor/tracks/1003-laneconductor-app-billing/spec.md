# Spec: LaneConductor App Billing System

## Problem Statement
LaneConductor Cloud enables users to leverage the platform remotely. As usage scales, the system needs to monetize and track costs:
- Free tier users with limited monthly usage
- Pro tier users with higher API call limits
- Enterprise tier with custom pricing
- Cost transparency for billing and forecasting

## Requirements

### Core Billing Model
- REQ-1: Support subscription tiers (Free, Pro, Enterprise)
- REQ-2: Track API call usage per user/workspace
- REQ-3: Calculate monthly charges based on tier + overage
- REQ-4: Process payments via Stripe
- REQ-5: Generate and send invoices monthly
- REQ-6: Support payment method management (add, update, delete)

### Data Model
- REQ-7: `billing_customers` table — Stripe customer ID, payment method, billing address
- REQ-8: `subscriptions` table — tier, start_date, renewal_date, status (active/cancelled)
- REQ-9: `usage_metrics` table — API calls, worker runs, storage, etc., per day per user
- REQ-10: `billing_charges` table — calculated charges, invoices, payment status
- REQ-11: `stripe_events` table — webhook log for idempotency

### User Interfaces
- REQ-12: Billing dashboard shows: current tier, usage graph, next renewal date, payment method
- REQ-13: User can switch tiers (upgrade/downgrade with proration)
- REQ-14: User can update payment method
- REQ-15: User can download invoices (PDF)

### Admin Interfaces
- REQ-16: Revenue dashboard — MRR, churn, tier breakdown
- REQ-17: Usage analytics — top users, API call distribution
- REQ-18: Refund management — issue refunds and track in system

## Acceptance Criteria
- [ ] Stripe account linked and webhooks configured
- [ ] All database tables created and migrated
- [ ] Subscription tiers functional (Free/Pro/Enterprise)
- [ ] Monthly billing cron job runs and charges correct amounts
- [ ] User billing dashboard fully functional
- [ ] Admin dashboard shows accurate MRR and churn metrics
- [ ] Invoices generated and deliverable as PDF
- [ ] Payment failures handled with retry logic and user notifications
- [ ] All Stripe webhook events idempotently handled
- [ ] Usage tracking accurate (verified against log)

## API Contracts

### POST /api/billing/subscribe
Request:
```json
{
  "tier": "pro",
  "payment_method_id": "pm_xxx"
}
```
Response:
```json
{
  "subscription_id": "sub_xxx",
  "status": "active",
  "renewal_date": "2026-03-26"
}
```

### GET /api/billing/usage
Response:
```json
{
  "period": "2026-02",
  "api_calls": 15000,
  "worker_runs": 120,
  "storage_gb": 5.2,
  "estimated_charge": 45.50
}
```

### POST /api/billing/payment-method
Request:
```json
{
  "payment_method_id": "pm_xxx"
}
```

## Tier Pricing

| Tier | Monthly Base | API Calls/mo | Worker Runs/mo | Price per 1k calls (overage) |
|------|--------------|--------------|----------------|-----------------------------|
| Free | $0 | 1,000 | 10 | N/A (hard limit) |
| Pro | $29 | 100,000 | 1,000 | $0.10 per 1k |
| Enterprise | Custom | Unlimited | Unlimited | Custom |

## Data Model Sketch

```sql
CREATE TABLE billing_customers (
  id UUID PRIMARY KEY,
  project_id INT REFERENCES projects(id),
  stripe_customer_id TEXT UNIQUE,
  email TEXT,
  billing_name TEXT,
  billing_address JSONB,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

CREATE TABLE subscriptions (
  id UUID PRIMARY KEY,
  billing_customer_id UUID REFERENCES billing_customers(id),
  tier TEXT, -- 'free', 'pro', 'enterprise'
  stripe_subscription_id TEXT,
  status TEXT, -- 'active', 'cancelled', 'past_due'
  started_at TIMESTAMP,
  renewal_date TIMESTAMP,
  created_at TIMESTAMP
);

CREATE TABLE usage_metrics (
  id SERIAL PRIMARY KEY,
  billing_customer_id UUID REFERENCES billing_customers(id),
  metric_date DATE,
  api_calls INT,
  worker_runs INT,
  storage_gb NUMERIC,
  UNIQUE(billing_customer_id, metric_date)
);

CREATE TABLE billing_charges (
  id UUID PRIMARY KEY,
  subscription_id UUID REFERENCES subscriptions(id),
  period_start DATE,
  period_end DATE,
  amount NUMERIC,
  invoice_url TEXT,
  paid BOOLEAN,
  created_at TIMESTAMP
);
```
