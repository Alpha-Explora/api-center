---
title: "Payment event outbox operations"
status: canonical
authority: operational
owner: platform-operators
audience: [operators, engineers]
last_verified: "unverified"
verification: unverified
sources: ["packages/contracts/src/index.ts","apps/payments/src/server.ts"]
---
# Payment event outbox operations

Payment events are published from `shared_payment.payment_event_outbox` by a Cloud Run Job that claims bounded batches of pending rows and publishes them to Pub/Sub. This document covers running and operating that job. The job only drains the outbox; rows are added by the payment runtime. The consumer must deduplicate the stable `eventId`; Pub/Sub can redeliver a message after APICenter publishes but before its database acknowledgement.

## Deploy order

1. Apply the Supabase migrations through the environment's migration owner. `20261009000500_payment_outbox_claim_leases` is required before the dispatcher runs. It adds expiring worker claim tokens and a retry limit to the outbox. Confirm the `payments_runtime` role exists and that the dispatcher's login user is a member of it. See `docs/operations/shared-service-database-roles.md`.
2. Confirm the test/live Pub/Sub topics in `infra/gcp/pubsub/` exist. The payments runtime identity needs `roles/pubsub.publisher` on each topic. The dispatcher identity needs Secret Manager access to its database URL and network reachability to the database.
3. Deploy the matching payment image. The job runs `dist/events/paymentEventDispatcher.js` from that image, so deploy the image before replacing the job.
4. Replace the Cloud Run Job definition for the environment being deployed. Deploy test first; run only one command per deployment:

   Test:

   ```powershell
   gcloud run jobs replace infra/gcp/cloud-run/payment-event-dispatcher.test.yaml --region asia-southeast1
   ```

   Live, after the test acceptance checks pass:

   ```powershell
   gcloud run jobs replace infra/gcp/cloud-run/payment-event-dispatcher.live.yaml --region asia-southeast1
   ```

5. Grant the Cloud Scheduler caller service account `roles/run.invoker` on the corresponding job. Schedule a recurring HTTP `POST` to `https://run.googleapis.com/v2/projects/PROJECT_ID/locations/REGION/jobs/JOB_NAME:run` using an OAuth token from that service account and the `https://www.googleapis.com/auth/cloud-platform` scope. Use separate schedules and service accounts for test and live. The job itself has bounded work, no Cloud Run automatic retries, and returns a failed execution when any publish attempt cannot be recorded.
6. Trigger one controlled test webhook, then verify one outbox row, one Pub/Sub message, one successful claim acknowledgement, and consumer deduplication before enabling the live schedule.

Cloud Run documents the job YAML and `gcloud run jobs replace` flow in its [job creation guide](https://cloud.google.com/run/docs/create-jobs). Cloud Scheduler documents OAuth authentication for Google API targets [here](https://docs.cloud.google.com/scheduler/docs/http-target-auth?hl=en).

## Inspect pending and quarantined events

Use a database identity with read access. Avoid selecting message payloads into broad operator logs.

```sql
SELECT environment, status, count(*) AS event_count,
       min(created_at) AS oldest_created_at,
       min(available_at) FILTER (WHERE status = 'pending') AS earliest_retry_at
FROM shared_payment.payment_event_outbox
GROUP BY environment, status
ORDER BY environment, status;

SELECT id, environment, event_type, provider_event_id, attempts,
       max_attempts, last_error, quarantined_at, quarantine_expires_at
FROM shared_payment.payment_event_outbox
WHERE status = 'quarantined'
ORDER BY quarantined_at DESC
LIMIT 100;
```

The quarantine query intentionally omits the event payload. Review each row against the provider receipt and consumer evidence before replaying or resolving it. Preserve an operator, case reference, evidence, action, and timestamp in the incident system. Do not delete a webhook receipt or outbox row to force redelivery.

## Delivery limits and recovery

- Each invocation claims at most `APICENTER_PAYMENT_OUTBOX_BATCH_SIZE` rows (default 50, hard maximum 100) using `FOR UPDATE SKIP LOCKED` and a six-minute lease.
- A claim token gates both success and failure acknowledgements. A stale job cannot change a row claimed by a later job.
- Publish attempts use exponential delay capped at five minutes. Rows move to quarantine after `max_attempts` (default 8). A lost job is reclaimable after the lease expires.
- Publication is at least once. Consumers must persist and deduplicate `eventId` and use `aggregateVersion` to reject stale state changes.
- Runbook-level repair is required for quarantined rows and old receipts without outbox records. The dispatcher does not discard or silently reset them.
