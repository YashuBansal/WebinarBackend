# Razorpay Subscription Flow Test Matrix (Plan + Renewals + Cancellation)

This document contains test cases for verifying that **plan subscription activation** and **recurring lifecycle events** correctly update your internal system, even when webhooks are detached or delayed.

Primary endpoints used by this app:
- Plan activation (callback-first): `POST /razorpay/payment-success` (frontend redirects here)
- Recurring lifecycle reconciliation: `POST /razorpay/webhook`

---

## Quick Observability Checklist (Always check)

### Logs to verify
- `RazorpayController payment-success`:
  - `phase: received`
  - `phase: updateClientPlan_start`
  - `phase: completed` with `outcome: plan_updated` (or failure)
- `SubscriptionService updateClientPlan_* phases`:
  - `updateClientPlan_start` / `admin_resolved` / `subscription_loaded`
  - `updateClientPlan_billing_created`
  - `updateClientPlan_subscription_saved`
  - `updateClientPlan_completed`
- `RazorpayWebhook` (for recurring):
  - `phase: verified`
  - `phase: handled` with `event: subscription.charged | cancelled | halted`
  - `Successfully processed recurring charge...` (from `handleSubscriptionCharged`)

### New trace markers (added for faster debugging)
- Webhook verification mode:
  - `flowStage: webhook_raw_body_mode`
  - `webhookRawBodyMode: raw_buffer | json_fallback`
- Plan cancel branch:
  - `flowStage: plan_cancel_applied`
- Addon entitlement cancel branch:
  - `flowStage: addon_entitlements_cancelled`
  - `outcome: ok | no_matching_purchase`

### DB fields to verify after each test
- `Subscription`:
  - `Subscription.plan`
  - `Subscription.expiryDate`
  - `Subscription.razorpaySubscriptionId`
  - `Subscription.razorpaySubscriptionStatus`
- `BillingHistory`:
  - billing document count increases correctly
  - idempotency works (no duplicate billing for same `razorpayPaymentId`)

---

## Prerequisites / Test Setup

### Webhook method: `ngrok`
Use ngrok to expose your local webhook endpoint to Razorpay.

1. Run backend locally.
2. Start ngrok:
   - Expose your local server webhook path (example):
     - `https://<your-ngrok-host>/razorpay/webhook`
3. In Razorpay dashboard (Test mode), set the webhook URL to the ngrok URL above.
4. Ensure the server env secrets match:
   - `RAZORPAY_WEBHOOK_SECRET` (or the secret you use)

### Webhook detached method (callback-first testing)
For plan activation tests, you can temporarily detach/disable webhook delivery by:
- not running ngrok, or
- pointing webhook URL to an unreachable address, or
- temporarily stopping webhook processing at the Razorpay side.

---

## A) Plan Activation Tests (Callback-first; webhook detached ok)
These validate that plan + billing update happens via `payment-success` callback, without webhook reliance.

### 1. Correct payment success (monthly)
- Expected:
  - Plan update is applied
  - Billing record is created
  - Redirect to `/plans`
- How:
  1. Trigger plan purchase in UI.
  2. Ensure webhook is detached (ngrok off).
  3. Confirm logs show `outcome: plan_updated` and `updateClientPlan_completed`.

### 2. Tampered callback query params
- Action:
  - Manually change `planId/adminId/durationType` in the callback URL before it hits backend.
- Expected:
  - Server ignores tampered query and uses pending checkout context.
  - Logs show `query_context_mismatch` but DB reflects correct pending context.
- How:
  1. Complete checkout and copy callback URL.
  2. Modify query params in URL.
  3. Call backend callback endpoint.

### 3. Duplicate callback replay
- Action:
  - Hit the same `payment-success` callback twice.
- Expected:
  - Billing idempotency prevents duplicates for same `razorpayPaymentId`.
  - Second attempt becomes idempotent (race-safe path).
- How:
  1. Reopen callback URL twice quickly.
  2. Verify no duplicate billing created.

### 4. Signature mismatch (invalid signature)
- Expected:
  - Backend rejects with failure and structured `signature_mismatch` logs.
- How:
  1. Modify signature in the callback body (or use an intentionally wrong payload).
  2. Verify server returns failed redirect and logs show rejection.

---

## B) Recurring Renewal & Status Tests (Webhook required)
These validate recurring lifecycle behavior through `POST /razorpay/webhook`.

### 5. On-time successful renewal
- Expected:
  - `subscription.charged` processed
  - expiryDate and billing updated
- How:
  1. Wait for a renewal cycle OR trigger a renewal using Razorpay test mechanics.
  2. Confirm `RazorpayWebhook handled subscription.charged`.
  3. Confirm `handleSubscriptionCharged` updates expiry + billing.

### 6. Late payment / retry scenario
- Expected:
  - Depending on Razorpay test cards behavior, status changes occur first, then later `subscription.charged` eventually updates internal state.
- How:
  1. Use Razorpay test cards that simulate delayed/failed capture.
  2. Trigger charge.
  3. Verify that only the eventual charge that leads to `subscription.charged` updates expiry/billing.

### 7. No payment leading to cancellation
- Expected:
  - `subscription.cancelled` processed
  - user deactivation happens only if subscription expired (based on your code logic)
- How:
  1. Make recurring charges fail repeatedly using Razorpay test failure setup.
  2. Verify webhook event `subscription.cancelled`.
  3. Check user and subscription status changes.

### 8. Subscription halted (temporary pause)
- Expected:
  - `subscription.halted` processed
  - status set to halted; deactivation behavior depends on expiry check
- How:
  1. Trigger halted condition from Razorpay test settings/cards.
  2. Confirm logs for `subscription.halted`.
  3. Validate `razorpaySubscriptionStatus` updated.

### 9. Duplicate webhook delivery
- Expected:
  - No duplicate billing / no inconsistent expiry due to idempotency checks.
- How:
  1. Replay the same webhook payload twice (manual POST or Razorpay replay).
  2. Confirm second run becomes a no-op via duplicate-payment guard/logs.

### 10. Webhook signature mismatch / wrong secret
- Expected:
  - Webhook returns 400 and logs show signature mismatch.
- How:
  1. Temporarily change webhook secret in your server env OR in Razorpay settings.
  2. Trigger a webhook.
  3. Confirm you receive 400 and signature mismatch logs.

### 11. Unhandled webhook event types
- Expected:
  - App should log `phase: noop` with `reason: unhandled_event_type`
- How:
  1. Trigger any other event type Razorpay sends.
  2. Confirm noop logging and no crash.

---

## C) Plan Upgrade / Previous Subscription Cancellation Tests
These validate the “cancel replaced provider subscription” logic when updating a plan.

### 12. Upgrade plan while current subscription active
- Expected:
  - Previous provider subscription is cancelled
- How:
  1. Start subscription on Plan A.
  2. Upgrade to Plan B before A expiry.
  3. Verify logs:
     - `cancelReplacedProviderSubscription`
     - includes `previousRazorpaySubscriptionId` and `newRazorpaySubscriptionId`

### 13. Rapid multiple upgrades (race test)
- Expected:
  - System ends in consistent plan state
  - billing remains idempotent
- How:
  1. Trigger upgrade twice quickly.
  2. Validate DB:
     - final `Subscription.plan` and `expiryDate` correct
     - billing duplicates do not occur

---

## D) (Optional) Add-on Subscription Lifecycle Tests
If your add-ons also depend on `subscription.charged` webhook behavior, verify:

### 14. Add-on recurring charge application
- Expected:
  - addon purchase is finalized/applied via subscription-charged handling
- How:
  1. Buy add-on.
  2. Trigger renewal charge.
  3. Validate addon purchase status in DB + logs.

### 15. Add-on cancellation/halt behavior
- Expected:
  - addon subscription status syncs correctly
  - no incorrect application occurs after cancellation/halt
- How:
  1. Force addon recurring to cancel/halt (test mode).
  2. Verify webhook event handling + DB status.

---

## Minimal “Manual Run” Workflow (Fast)
1. Run backend + confirm env secrets.
2. For plan activation tests: keep webhook detached.
3. For recurring tests: start ngrok and point Razorpay webhook to it.
4. Execute each case one-by-one.
5. After each case, check:
   - logs match expected phases
   - `Subscription` and `BillingHistory` reflect correct final state

