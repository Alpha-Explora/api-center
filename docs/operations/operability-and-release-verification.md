---
title: Go-live, credential recovery, and release verification
status: canonical
authority: operational
owner: platform-operators
audience: [operators, engineers, reviewers]
last_verified: "2026-11-14"
verification: repository
sources: [apps/gateway/src/domains/runtime-ops/operations, apps/gateway/src/domains/catalog-registry/registry, apps/payments/src/events, apps/management/src/features, scripts/release, supabase/migrations]
---
# Go-live, credential recovery, and release verification

Management provides a go-live checklist under a consumer service's **Governance** section. It combines environment registration, approvals, effective subscription access, credential metadata, and protected verification evidence. **Evidence** contains request diagnostics and payment event recovery. Test and live credentials remain separate; this workflow does not switch consumer traffic.

The implementation has repository and disposable PostgreSQL verification. Deployment, production database roles, Secret Manager permissions, protected CI identities, provider calls, and consumer acknowledgements still require environment acceptance. No production migration or provider operation is established by this document.

## Prepare an environment

1. Apply the additive `20261113000100` through `20261113000900` migrations using the normal migration workflow. The gateway owns `apic_runtime` evidence and diagnostics, `apic_catalog` service credential history, and `apic_governance` payment credential receipts. The payment runtime owns `shared_payment.payment_replay_attempts`. Verify each application's database role before enabling writes.
2. Set `DATABASE_ENABLED=true` and deploy the gateway with `APICENTER_RELEASE_SHA` equal to its actual 40-character Git commit.
3. Give the gateway read access to the configured Cloud Run services and revisions. Configure `APICENTER_VERIFICATION_DEPLOYMENTS` as a JSON array of `{serviceId, environment, project, region, service}` entries for each consumer and consumed runtime. Registry environment URLs must match the observed Cloud Run service origin. Custom-domain mappings and split traffic currently block verification.
4. Give the gateway's credential lifecycle identity access to read and add versions of the relevant service secrets. Configure `TRIBE_SECRET_SOURCE=gcp-secret-manager` and the project. This implementation does not grant IAM automatically.
5. Configure `APICENTER_VERIFICATION_RUNNERS` with explicit runner subjects, service IDs, and environments. Example: `[{"subject":"protected-verifier","serviceIds":["billing-api"],"environments":["test"]}]`. The runner JWT must also contain `verification:write` and the matching environment. A consumer JWT or platform secret cannot submit evidence.
6. Configure the payment runtime URL and internal token for the chosen environment and Cloud Run invocation permission. Management accesses it through the gateway and never accepts a caller-selected replay destination.

The deployment observer reads Cloud Run's serving revision and resolved image digest. It requires one revision receiving 100% of traffic. Evidence expires after 24 hours and becomes stale when gateway revision, consumer/runtime revisions, routes, scopes, dependencies, or credential versions change. Registry presence and historical health do not count as authenticated acceptance.

Each observed revision must expose its actual source commit as `APICENTER_RELEASE_SHA`. For a consumer maintained in a separate repository, set its protected deployment target's optional `expectedCommit` to that repository's intended 40-character commit. APICenter gateway and provider runtimes must still match the checked-out APICenter commit.

## Move a consumer from test to live

1. Keep the working test configuration. Register the service's live backend URL, and obtain the service and payment live-access approvals that apply to its project. Approval records currently have no configured expiry field; the checklist checks their exact action, target, and environment.
2. Provision a separate live service secret. Initial provisioning refuses to overwrite an enabled secret; use controlled rotation for an existing credential.
3. If the consumer uses payment API keys, register its live payment consumer and issue a live key. Copy the returned secret once into the consumer's backend secret manager. Management lists only prefixes and lifecycle metadata afterward.
4. Set the consumer's backend configuration to the live environment and matching live credentials, then deploy it. Tokens and keys must remain server-side. The generated template contains placeholders, never stored plaintext credentials.
5. Enter a reason and the live confirmation phrase in Management, then request protected verification. This queues a durable run; it does not invoke providers from the browser.
6. Run the protected verification job for the same service, environment, and deployed revision. Review the resulting evidence before handing production traffic to the consumer.

IAM subscription provisioning can remain `pending_validation` or `delivery_failed` after a key was issued. Resolve subscription setup separately; do not issue another key to retry subscription creation. An absent pipeline is explicitly not applicable for a service that does not consume Kafka.

## Rotate and recover credentials

Payment keys expire after 365 days. Rotation preserves previous keys for at most 24 hours, with each key's existing earlier expiry respected. Install the replacement, confirm authenticated usage, then revoke the previous key by its key ID. Targeted revocation does not revoke the replacement. Existing revoke-all behavior remains the emergency option.

Issuance and rotation require a UUID operation ID and store an immutable receipt in the same transaction as the key. Retrying the same operation never reveals plaintext again or silently issues a replacement. If the response was lost, inspect key metadata and revoke the inaccessible key, then deliberately create a new operation. Keep any still-working key until its replacement is installed.

Service-secret rotation uses these steps:

1. **Start:** the browser generates a replacement secret and sends only its SHA-256 hash. Save the one-time plaintext in the consumer's secret manager. Current and replacement secrets are accepted during overlap.
2. Deploy the replacement and obtain a token with it. The gateway records successful use of the replacement against the precise Secret Manager version.
3. **Verify replacement:** permitted only after that authentication evidence exists.
4. **Revoke old:** removes the old hash. Other gateway instances may retain cached credentials for up to 300 seconds. Previously issued JWTs retain their existing token lifetime; secret revocation does not revoke every token.

A Secret Manager write with an unknown result leaves the operation `uncertain`. Inspect the operation row and the actual secret version/history before changing it. Reconcile that specific external write under incident procedures; do not retry it with a new UUID or expose hashes in an incident message. Automated uncertain-write recovery is intentionally unavailable.

## Investigate requests and events

Request responses expose `X-Request-ID` and `X-Correlation-ID`. Diagnostics capture the final HTTP status, trusted service/project/environment context, route template, bounded error code, failure stage, duration, and an optional public payment resource ID. They exclude request/response bodies, query strings, recipients, credentials, and provider payloads. Queries cover at most seven days, return at most 100 records, and retain records for 30 days.

Organization-scoped service observers can read their service diagnostics. A platform administrator can look up an unattributed authentication failure by correlation ID from **Audit**. Unverified credentials are not used to infer tenant ownership. A successful token request supplies trusted placement context.

Successful single-resource payment responses link diagnostics to that resource's events in Management. The event panel searches within its latest 50 events; an empty filtered view does not prove no event exists. Events show the canonical public event ID and aggregate version. Publication, consumer acknowledgement, last delivery, and dead-letter state are separate facts; unavailable consumer telemetry is shown as unknown.

Replay requires an operator, reason, operation UUID, and live confirmation where applicable. It republishes the original stored event snapshot and preserves the canonical event ID and aggregate version. It does not repeat a charge, checkout, refund, or subscription command. Consumers must still deduplicate events.

A repeated replay operation returns its existing attempt. A `running` or `uncertain` attempt prevents another replay. Reconcile the original Pub/Sub publication and consumer state before any operator-controlled database correction; preserve the attempt and investigation record. There is no automatic timeout-to-retry transition or reconciliation UI for payment replay.

## Run release verification

Use Node 24 and a clean committed checkout for release acceptance:

```bash
npm run release:verify -- --phase repository --environment test --output /tmp/apicenter-repository.json
npm run release:verify -- --phase all --environment test --submit --output /tmp/apicenter-acceptance.json
```

Choose a new output path for each deliberate attempt. The runner reserves it before external work and refuses to overwrite an existing artifact. An unfinished artifact is evidence of an interrupted attempt that needs investigation. A dirty checkout can produce diagnostic results but cannot be releasable or submit accepted evidence. `repository` and `deployed` phases are useful individually; only `all` can mark a release releasable.

The manual `.github/workflows/release-verification.yml` selects a protected GitHub environment and always uploads the sanitized report. Configure its variables and secrets before use:

| Setting | Purpose |
| --- | --- |
| `APICENTER_VERIFY_WORKLOAD_IDENTITY_PROVIDER`, `APICENTER_VERIFY_SERVICE_ACCOUNT` | GitHub environment variables for Google identity federation and read-only deployment observation |
| `APICENTER_VERIFY_URL`, `APICENTER_VERIFY_SERVICE_SECRET` | Protected secrets mapped to runner `APICENTER_URL` and `APICENTER_SERVICE_SECRET` |
| `APICENTER_VERIFY_SERVICE_ID` | Variable mapped to runner `APICENTER_SERVICE_ID` |
| `APICENTER_VERIFY_DEPLOYMENTS` | JSON array of `{serviceId, service, project, region}`; include `gateway`, the consumer, and its provider runtimes |
| `APICENTER_VERIFICATION_RUNNER_TOKEN` | Dedicated, scoped runner JWT used to claim and submit the queued run |
| `APICENTER_VERIFY_CASES` | Protected JSON array of `{checkId, body}` acceptance fixtures |
| `APICENTER_VERIFY_RECIPIENT_ALLOWLIST` | Protected JSON array containing approved fixture recipients |
| `APICENTER_VERIFY_ALLOW_TEST_WRITES` | Explicit `true` to enable selected test provider writes |
| `APICENTER_VERIFY_ALLOW_LIVE_CASES` | Comma-separated, explicitly selected live check IDs |
| `APICENTER_VERIFY_LIVE_PHRASE`, `APICENTER_VERIFY_LIVE_REASON` | Exact `APPLY LIVE CHANGE` phrase and reason for selected live cases |

Without a claimed durable run, provider cases remain blocked even when fixtures and write flags are configured. `--submit` requires a previously queued current run. Without provider fixtures, the runner checks health, token issuance, denied unauthenticated discovery, and authenticated discovery, then reports missing provider acceptance. Mock runtimes do not satisfy provider acceptance; observed runtime `NODE_ENV` must be production.

Available fixture checks are `provider.email`, `provider.sms`, `provider.otp`, `provider.geo`, `provider.gauth`, and `provider.payments`. Email/SMS/OTP permit one exact allowlisted recipient. Google Auth uses a protected refresh-token fixture. Payments reads an owned existing plan and never creates a payment. Bodies and responses are excluded from artifacts. Refresh tokens, recipients, and credentials stay in protected secrets.

Provider timeouts or 5xx responses produce `PROVIDER_OUTCOME_UNKNOWN`. A submitted report leaves the run `uncertain`, blocking another run. A claimed run interrupted for 30 minutes also becomes uncertain. Investigate the original provider operation before using the platform-admin `POST /api/v1/admin/operations/verification/reconcile` endpoint with `{serviceId, environment, runId, reason}`. Reconciliation records attribution and a reason, changes the attempt to failed, and never grants readiness. Request a new deliberate run afterward.

`event_delivery` remains blocked until trusted consumer acknowledgement is available. The current runner does not manufacture that acknowledgement from Pub/Sub publication. Services requiring that check cannot become ready through this job alone. Accepting signed consumer evidence and automated reconciliation of unknown external writes remain explicit follow-up work.

Cloud Run observation follows the [v1 revision API](https://docs.cloud.google.com/run/docs/reference/rest/v1/namespaces.revisions). Repository checks and fixtures do not verify configured IAM, live provider delivery, or external consumer processing.
