# Razorpay Recurring Configuration Guide (Off-Code)

To transition your system from one-time billing to Razorpay recurring billing automatically, several manual steps are required in the Razorpay Dashboard. This is because **Razorpay Subscriptions require "Plans" to be pre-defined within Razorpay.**

Please follow these steps verbatim to ensure the backend integration works faultlessly.

---

## 1. Create Razorpay Plans (For Each Plan Duration)

For **every duration** (Monthly, Quarterly, Yearly) in your backend `Plans`, you must create a dedicated Razorpay Plan. Note that any custom discounts will need their own plan or use Razorpay add-ons. 

**Steps:**
1. Log in to your [Razorpay Dashboard](https://dashboard.razorpay.com).
2. Navigate to **Subscriptions & Plans > Plans** from the left sidebar.
3. Click on **Create Plan**:
   - **Plan Name:** Use a clear identifier (e.g. `Pro Monthly`, `Starter Yearly`).
   - **Plan Description:** (Optional) describe the limits.
   - **Billing Frequency:** Set this to match the `duration` (e.g., Every 1 Month, Every 1 Year).
   - **Pricing:** Set the fixed recurrig amount. *Ensure this perfectly matches your `totalWithGST` backend price.*
4. **Save** the plan.
5. In the list of Plans, you will see an ID looking like `plan_L3x1vXYZ`. **Copy this Plan ID.**
6. **Backend Mapping:** Take this `plan_XYZ` ID and insert it into your Mongo DB `Plans` document under `planDurationConfig.[monthly].razorpayPlanId`. (You will need to write a lightweight DB script to seed these `razorpayPlanId` strings over time or configure them from your Super Admin panel).

---

## 2. Set Up Webhooks (CRITICAL)

Because recurring charges happen silently in the background when the 30/365 days expire, your backend must be explicitly notified to extend the user's `expiryDate`.

**Steps:**
1. In the Razorpay Dashboard, go to **Settings > Webhooks**.
2. Click **Add New Webhook**.
3. **Webhook URL:** `https://api.yourdomain.com/razorpay/webhook` (replace with your production backend API url).
4. **Secret:** Create a highly secure random string. (You must save this same string to your backend `.env` file as `RAZORPAY_WEBHOOK_SECRET`).
5. **Active Events:** You **must** select the following events:
   - `subscription.charged`
   - `subscription.cancelled`
   - `subscription.halted`
   - `subscription.authenticated` (Optional, good for debugging)
6. **Save Webhook.**

*Without this step, users will be charged by Razorpay, but their account expiry date on the SaaS will not update!*

---

## 3. Configure Frontend Checkout 

When you generate a `subscription_id` via your backend `/checkout` using `createSubscriptionOrder`, the frontend Razorpay initialization script slightly changes.

**Original One-Time Payment Script Config:**
```javascript
var options = {
    "key": "YOUR_KEY_ID", 
    "amount": "50000",
    "currency": "INR",
    "order_id": "order_IluGWxBm9U8zJ8", // CURRENT
    ...
};
```

**New Recurring Payment Script Config:**
```javascript
var options = {
    "key": "YOUR_KEY_ID", 
    "subscription_id": "sub_IluGWxBm9U8zJ8",  // CHANGE: Provide subscription_id instead of order_id
    // Note: Do NOT pass amount/currency when passing subscription_id. Razorpay sets this based on the plan.
    ...
};
```

Your `/payment-success` backend route has already been updated to parse `razorpay_subscription_id` in addition to the legacy `razorpay_order_id`, so existing non-recurring orders will continue to function.

---

## 4. Subscriptions Migration Strategy (Existing Users)
As discussed: **"Whenever they make their next payment."**
- Existing active users will stay on the legacy flow.
- When their `expiryDate` hits (or they manually renew earlier), they will trigger the frontend checkout. 
- Since we are now forcing subscriptions under the hood (assuming `razorpayPlanId` is mapped in DB), their *next* checkout will prompt them for a recurring mandate (e.g. e-Mandate on cards / UPI autopay). 
- From that moment forward, they will be completely transferred to recurring automatic billing. None of their backend credentials or historic billing history will be corrupted.

---

## 5. Security & Idempotency Checklist

- [x] Backend `.env` includes `RAZORPAY_WEBHOOK_SECRET` equal to the dashboard.
- [x] Test Mode has been verified (Run a mock webhook payload in postman targeting `/razorpay/webhook`).
- [x] Confirm no UI "Update Plan" buttons are broken for older non-mapped plans (it falls back to one-time gracefully).
