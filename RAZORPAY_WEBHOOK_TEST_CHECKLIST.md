# Razorpay Webhook Test Checklist

## Setup

- Import `RAZORPAY_WEBHOOK_TEST_MATRIX.postman_collection.json` in Postman.
- Set collection variables:
  - `baseUrl`
  - `webhookSecret`
  - `subscriptionId`
  - `adminId`
- Run requests in sequence.

## DB Verification Points

- `subscriptions`
  - `razorpaySubscriptionStatus`
  - `razorpayGraceUntil`
  - `razorpayLastPaymentFailureAt`
  - `razorpayPaymentFailureCount`
  - `razorpayLastWebhookEventAt`
  - `expiryDate`
- `users`
  - `isActive`
- `addonpurchases`
  - `providerRazorpaySubscriptionStatus`
- `subscriptionaddons`
  - `status`, `expiryDate`
- `billinghistories`
  - `razorpayPaymentId` (no duplicates)
- `razorpaywebhookevents`
  - `providerEventId`, `eventType`, `status`, `reason`

## Expected Outcome Matrix

1. `subscription.charged`
   - status -> `active`
   - grace cleared
   - failureCount reset to `0`
   - billing renewal created for `pay_charged_001`
2. duplicate `subscription.charged` (same `event_id`)
   - dedupe hit, no new billing row
3. `payment.failed`
   - status -> `payment_failed`
   - grace set
   - failureCount increment
   - user stays active during grace
4. `subscription.halted`
   - status -> `halted`
   - grace set/retained
5. `subscription.pending`
   - status -> `pending`
   - grace set/retained
6. `subscription.activated`
   - status -> `active`
   - grace cleared
   - failureCount reset
7. `subscription.updated`
   - status synced (usually active in payload sample)
   - no forced billing side-effect
8. `subscription.cancelled`
   - status -> `cancelled`
   - addon entitlements cancelled
   - user deactivated
9. `subscription.completed`
   - status -> `completed`
   - addon entitlements cancelled
   - user deactivated

## Optional cURL Example

```bash
BODY='{"event_id":"evt_charged_001","event":"subscription.charged","created_at":1714473600,"payload":{"subscription":{"entity":{"id":"sub_main_001","status":"active","plan_id":"plan_demo_001","notes":{"adminId":"ADMIN_ID"}}},"payment":{"entity":{"id":"pay_charged_001","subscription_id":"sub_main_001","amount":10000,"created_at":1714473600}}}}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$RAZORPAY_WEBHOOK_SECRET" -hex | sed 's/^.* //')
curl -X POST "http://localhost:3001/api/v1/razorpay/webhook" \
  -H "Content-Type: application/json" \
  -H "x-razorpay-signature: $SIG" \
  --data "$BODY"
```

## Newman Run (Automated Assertions)

- Assertions are embedded at collection level:
  - HTTP status must be `200`
  - response body must include `{ "status": "ok" }`
- Run command (PowerShell):

```powershell
./scripts/run-razorpay-webhook-matrix.ps1
```

- Direct Newman command:

```powershell
newman run RAZORPAY_WEBHOOK_TEST_MATRIX.postman_collection.json `
  --environment RAZORPAY_WEBHOOK_TEST_ENV.postman_environment.json `
  --reporters cli,json `
  --reporter-json-export newman-razorpay-webhook-report.json `
  --bail failure
```
