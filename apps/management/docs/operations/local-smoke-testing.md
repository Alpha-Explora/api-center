# Local Shared-Service Smoke Testing

This console can request a temporary tribe bearer token and run allowlisted
shared-service checks through the live API Center proxy.

## Phase Position

This is the active phase after internal tribe token auth. Run this before
starting the production-readiness plan.

Execution order:

1. `2026-05-14-internal-tribe-token-auth.md` - completed and deployed.
2. `local-smoke-testing.md` - current phase.
3. `2026-05-14-production-readiness-next-phases.md` - next phase after smoke tests pass.

## Prerequisites

- `apicenter-management` is running locally.
- `.env.local` contains:
  - `API_CENTER_BASE_URL=https://api-center.itsandbox.site`
  - `API_CENTER_PLATFORM_ADMIN_SECRET=<platform admin secret>`
  - `NEXT_PUBLIC_API_CENTER_BASE_URL=https://api-center.itsandbox.site`
- API Center is configured once with per-tribe Secret Manager lookup:
  - `TRIBE_SECRET_SOURCE=gcp-secret-manager`
  - `TRIBE_SECRET_GCP_PREFIX=api-center-tribe-secret-`
  - `TRIBE_SECRET_CACHE_TTL_SECONDS=300`
- Local provisioning requires:
  - `GOOGLE_CLOUD_PROJECT=apicenter-alpha-20260623`
  - `GCP_IMPERSONATE_SERVICE_ACCOUNT=apicenter-mgmt-provisioner@apicenter-alpha-20260623.iam.gserviceaccount.com`
  - your active `gcloud auth login` user must have
    `roles/iam.serviceAccountTokenCreator` on that service account
- Local Confluent topic provisioning requires these server-only `.env.local`
  values:
  - `CONFLUENT_ENVIRONMENT_ID=<env-id>`
  - `CONFLUENT_KAFKA_CLUSTER_ID=lkc-850n9q`
  - `CONFLUENT_KAFKA_REST_ENDPOINT=https://pkc-ldvj1.ap-southeast-2.aws.confluent.cloud:443`
  - `CONFLUENT_KAFKA_API_KEY=<cluster-scoped Kafka API key>`
  - `CONFLUENT_KAFKA_API_SECRET=<cluster-scoped Kafka API secret>`
  - `CONFLUENT_CLOUD_API_KEY=<cloud management API key>`
  - `CONFLUENT_CLOUD_API_SECRET=<cloud management API secret>`
  - `CONFLUENT_S3_CONNECTOR_NAME=api-center-s3-sink`
  - `CONFLUENT_DEFAULT_RETENTION_MS=604800000`
- API Center is running with internal tribe token issuance:
  - `AUTH_PROVIDER=composite` or `AUTH_PROVIDER=internal-jwt`
  - `JWT_PRIVATE_KEY` and `JWT_PUBLIC_KEY` configured once for the platform
- The `smoke-tribe` registry entry exists and declares the shared services it
  is allowed to call in `consumes`.

No Descope Inbound App is required for `smoke-tribe` when API Center uses
internal tribe token mode. Descope remains separate for human/user auth.

## Register The Smoke Tribe

Open:

```text
http://localhost:3000/tribes/new
```

Use **Smoke preset**. It creates a local-only test tribe manifest:

- service ID: `smoke-tribe`
- backend URL: `http://localhost:4019`
- consumes: `gauth`, `geo`, `payment`, `email`, `sms`, `otp`

The backend URL can be localhost for registry and token testing. The production
API Center proxy cannot call that backend unless the service is deployed or
exposed through a tunnel.

## Request A Token

Open:

```text
http://localhost:3000/smoke-tests?tribeId=smoke-tribe
```

Use **Secret hash helper** first:

1. Click **Generate secret**, or paste your own plaintext secret.
2. Click **Create hash** if you pasted your own plaintext.
3. Click **Provision secret**.
4. Confirm the created secret name is:

```text
api-center-tribe-secret-smoke-tribe
```

The local route writes this Secret Manager payload:

```json
{
  "serviceId": "smoke-tribe",
  "secretHashSha256": "<sha256 hash of plaintext smoke secret>",
  "status": "active",
  "rotatedAt": "<timestamp>"
}
```

Do not add `TRIBE_SECRET_SMOKE_TRIBE` to `api-center-prod` for new tribes. That
legacy key is only a rollback/migration path.

Restart API Center only after changing the one-time resolver configuration in
`api-center-prod`, not for ordinary tribe onboarding:

```powershell
kubectl -n api-center rollout restart deployment/api-center
kubectl -n api-center rollout status deployment/api-center --timeout=5m
```

The helper runs in the browser. It does not create a local file and does not
send the plaintext anywhere until you explicitly request a token.

Enter:

- tribe ID: `smoke-tribe`
- plaintext tribe secret: the plaintext value whose SHA-256 hash was stored as
  `api-center-tribe-secret-smoke-tribe`

The console sends the secret to the local route `/api/local/auth/token`, which
forwards to API Center. The plaintext secret is cleared after success. The
bearer token stays in React memory only and disappears on refresh.

If token request fails with a Descope `/oauth2/v1/apps/token` error, the live API
Center deployment is still using `AUTH_PROVIDER=descope`. Switch to
`AUTH_PROVIDER=composite`, make sure the JWT key pair exists in Secret Manager,
and restart the API Center deployment.

## Provision The Tribe Event Topic

Open:

```text
http://localhost:3000/tribes/smoke-tribe
```

In **Confluent data pipeline**:

1. Click **Provision topic**.
2. Confirm the result references:

```text
tribe.smoke-tribe.events
```

3. Click **Add to S3 sink**.
4. Confirm the connector result references:

```text
api-center-s3-sink
```

This only provisions Confluent infrastructure for API Center. Do not give tribes
Confluent API keys. Tribes publish events through API Center's governed Kafka
SDK wrapper.

## Local Tribe Cleanup

For test tribes, prefer deprovisioning in this order:

1. Delete the tribe credential secret.
2. Remove the topic from the S3 sink connector if it was added only for the
   test.
3. Deregister the API Center registry entry.

Do not delete Confluent topics or S3 objects as part of routine smoke cleanup.

## Run Checks

Start with **Run safe checks**. These call health endpoints, Google auth
authorization URL creation, and the local geofence check.

Provider-impacting checks are disabled until the confirmation checkbox is
selected. Those checks may create PayMongo checkout test data, send email/SMS,
or create OTP records depending on live shared-service configuration.

Payment checks are split into operator groups:

- **Payment health** runs `/health` and safe subscription read checks.
- **Checkout session** creates a PayMongo checkout session when provider mode is configured.
- **Subscription setup** creates deterministic smoke customer, product, and recurring price records.
- **Subscription lifecycle** creates and cancels the deterministic smoke subscription.

The subscription-impacting checks use fixed smoke IDs:

```text
cus_smoke_management
prod_smoke_management
price_smoke_management_monthly
sub_smoke_management
```

Keep `PAYMENT_SUBSCRIPTIONS_ENABLED=false` in live production until the test
environment proves the full subscription lifecycle and PayMongo recurring
product behavior.

## Verify Runtime Usage

After calls complete, open:

```text
http://localhost:3000/shared-services/usage
http://localhost:3000/tribes/smoke-tribe
http://localhost:3000/audit
```

Runtime call counts appear only after API Center records proxy analytics for the
selected time window.


