## Pre‑Webinar Registration API — Risks and Improvements

This document assesses the current `POST /assignment/prewebinar` flow and outlines concrete, incremental improvements to make it more robust, scalable, and maintainable.

### Scope
- Controller: `@Post('/prewebinar')` → `assignmentService.addPreWebinarAssignments`
- Flow: attendee creation/update, tag handling, subscription quota checks, notifications, and auto‑assignment.

---

## Key Risks

### 1) Concurrency & Race Conditions
- Contact count increments and employee `dailyContactCount` updates can race under concurrent requests, leading to quota breaches or over‑assignment.
- Duplicate attendees can still be created if two requests for the same email+webinar arrive simultaneously before the duplicate check persists.
- Assignment selection (least loaded) is not atomic; another request may assign the same employee in parallel.

### 2) Transaction Boundaries & Partial Success
- Attendee creation, logging, notification, and assignment are not wrapped in a transactional unit. Partial failures can leave the system in inconsistent states (e.g., attendee created but assignment/log/notification missing).

### 3) Notification Delivery Durability
- `setTimeout` on the app process is volatile. Process restarts or crashes can drop notifications; there is no retry or DLQ.

### 4) Idempotency & Deduplication
- Deduplication hinges on email+webinar check only. Email formats/aliases and case normalization may still allow logical duplicates.
- No explicit idempotency key to protect against client retries or network timeouts causing duplicate side‑effects.

### 5) Data Validation & Normalization
- `tags` merging assumes arrays; non‑array payloads are silently skipped.
- Phone normalization may be inconsistent across locales without strict E.164 enforcement and country metadata.

### 6) Authorization & Multi‑Tenant Isolation
- Endpoint depends on `adminId` from context; insufficient checks could allow cross‑tenant resource access if other layers are misconfigured.

### 7) Performance & Scaling
- Hot paths (fetch webinar, subscription, existing attendee, previous assignment, employees) may cause multiple DB round‑trips per call.
- Missing or suboptimal indexes on attendee lookup by `(adminId, webinarId, email)` and assignment queries would degrade under scale.

### 8) Observability & Operability
- Limited structured logs around assignment decisions, quota rejections, and tag processing results.
- No metrics or tracing to debug latency spikes or capacity bottlenecks.

### 9) Error Handling & API Consistency
- Mixed return shapes/messages; clients may need to branch on message text.
- Some failures (e.g., failed notification) don’t surface in the API result; no post‑failure remediation.

### 10) Assignment Policy Robustness
- Least‑loaded selection may cause starvation or oscillations with frequent concurrent writes.
- Exclusion lists and role checks are applied, but there is no fairness window or cooldown.

### 11) Backpressure & Timeouts
- No explicit request timeouts or circuit breakers for dependent services; under degradation, requests can pile up.

### 12) Reprocessing & Replay Safety
- If upstream or clients retry events, side‑effects (logs, notifications, assignments) can repeat without idempotent guards.

---

## Improvements

### A) Concurrency Safety
- Use optimistic concurrency control/atomic updates for subscription `contactCount` and employee `dailyContactCount` (e.g., conditional increments with version fields or Mongo `$inc` with a guard query on limits).
- Enforce unique index on `(adminId, webinarId, normalizedEmail)` to prevent duplicates at the database level.
- Guard assignment with an atomic reservation step (e.g., claim document with compare‑and‑set) before finalizing.

### B) Transactional Integrity
- Introduce a transactional boundary where supported (Mongo multi‑document transactions if using a replica set) for attendee creation + assignment + log creation.
- Alternatively, adopt the transactional outbox pattern: persist side‑effects in an outbox table and have a worker deliver them reliably.

### C) Durable Asynchronous Processing
- Replace in‑process `setTimeout` with a job queue (e.g., BullMQ/RabbitMQ/SQS) for notifications and heavy side‑effects.
- Add retry with exponential backoff and DLQ for failures.

### D) Idempotency & Dedup Keys
- Accept `Idempotency-Key` header; store processed keys per `(adminId, webinarId)` window to short‑circuit duplicate side‑effects.
- Normalize emails using a strict policy (trim, lowercase, optionally alias handling for known providers) before uniqueness checks.

### E) Validation & Normalization
- Strengthen DTO validation: ensure `tags` is an array; coerce or reject otherwise with a clear error code.
- Enforce E.164 phone formatting with region inference or explicit `countryCode`; reject invalid numbers early.

### F) Authorization & Tenant Boundaries
- Re‑validate `adminId` ownership for all referenced entities (`webinar`, `attendee`, `employee`) in the same request.
- Add defense‑in‑depth checks at service boundaries to avoid cross‑tenant leakage.

### G) Performance & Indexing
- Ensure compound indexes:
  - Attendees: `(adminId, webinarId, normalizedEmail)`
  - Previous assignment lookup: `(adminId, attendeeEmail)`
  - Employees for assignment: `(adminId, role, isActive)`
- Batch or cache reads where safe (e.g., config and roles mapping from `configService`).

### H) Observability
- Add structured logs with correlation IDs (request id, adminId, webinarId, email) at key decision points.
- Expose metrics: counts of created/updated attendees, assignment success/fail, quota failures, queue latencies.
- Add distributed tracing around DB calls and external services.

### I) API Contracts & Errors
- Standardize response schema with machine‑readable `code` and `reason` fields; avoid client branching on free‑text `message`.
- Map failures consistently (e.g., 409 for duplicate, 429 for quota exhausted, 422 for validation).

### J) Assignment Policy
- Introduce fairness: round‑robin with capacity weighting, or leaky‑bucket per employee to avoid hotspots.
- Add a short‑term cooldown after assignment to reduce race collisions.

### K) Backpressure & Resilience
- Apply request timeouts and retries with jitter for internal calls.
- Use a bulkhead/queue for assignment decisions if throughput spikes.

### L) Replay & Reprocessing Safety
- Make logs/notifications/assignments idempotent via deterministic keys (e.g., `attendeeId:webinarId:eventType`).
- When consuming from queues/webhooks, validate signatures and timestamps; reject stale or tampered events.

### M) Testing & Verification
- Add concurrency tests for duplicate registration and assignment under load.
- Add contract tests for validation and response codes.
- Run load tests focusing on hot queries and index efficiency.

---

## Suggested Roadmap (Incremental)

1. Data safety (Week 1)
   - Unique index on `(adminId, webinarId, normalizedEmail)` and strict email/phone normalization.
   - Strengthen DTO validation for `tags` and required fields.

2. Concurrency & idempotency (Week 2)
   - Atomic increments with guard conditions for quotas and employee counts.
   - Add `Idempotency-Key` processing and dedup store.

3. Durability & observability (Week 3)
   - Replace `setTimeout` with a queue for notifications; implement retries + DLQ.
   - Add structured logs, key metrics, and tracing.

4. Assignment robustness (Week 4)
   - Introduce fair, capacity‑aware round‑robin with cooldown.
   - Optional: wrap attendee+assignment in a transaction or implement an outbox.

5. API consistency (Week 5)
   - Normalize error codes and standardized response schema.
   - Expand automated tests (concurrency/load/contract).

---

## Acceptance Criteria (Done When)
- Duplicate attendee writes are prevented at DB level and in application logic.
- Quota and daily limits cannot be exceeded under concurrent load.
- Notifications and side‑effects are durable with retries and DLQ.
- Standardized responses and validation errors are returned consistently.
- Assignment is fair, capacity‑aware, and observable.


