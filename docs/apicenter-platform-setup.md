> **Current payment eventing note:** APICenter payment lifecycle events use Google Pub/Sub (`apicenter.payment-events.test` and `.live`). Confluent/Kafka references in this document describe the legacy general data-pipeline surfaces and are not the active payment command or event path.

# APICenter Platform Setup

This is the operator guide for the current APICenter deployment model.

## Repositories

| Repo | Owns |
| --- | --- |
| `api-center` | Gateway runtime, auth, registry, proxying, policy checks, rate limits, readiness, metrics, and Confluent publishing. |
| `api-shared-services` | `@implementsprint/sdk`, shared-service manifests, shared-service runtimes, provider integrations, and SDK contract checks. |

Tribes install `@implementsprint/sdk` from the private registry. The SDK calls APICenter only. It does not call PayMongo, Resend, Google, or Confluent directly.

## Runtime Architecture

Synchronous calls:

```text
tribe service
  -> @implementsprint/sdk
  -> APICenter gateway
  -> registry, scope, consumes, and policy checks
  -> /api/v1/tribes/:serviceId/* or /api/v1/shared/:serviceId/*
  -> registered tribe or shared-service runtime
```

Asynchronous data pipeline:

```text
GCP API Gateway / APICenter shared services
  -> Confluent Cloud Kafka topics
  -> Confluent Amazon S3 Sink Connector
  -> AWS S3 raw data lake
```

Confluent Cloud is not in the synchronous proxy path for tribe-to-tribe calls. It is the asynchronous event and raw-data backbone.

## Confluent Ownership Rule

API Center owns Confluent credentials and publishing. Tribes do not receive
Confluent Cloud API keys, Kafka API keys, connector credentials, or AWS S3
credentials.

For new tribes, use the local `apicenter-management` tribe detail page to:

1. Provision `tribe.<ownerTribeId>.events` in Confluent Cloud. If the service
   is the tribe principal, `ownerTribeId` is the same as `serviceId`.
2. Add that topic to the existing `api-center-s3-sink` connector.
3. Keep tribe runtime code on the SDK path:

```text
tribe backend -> @implementsprint/sdk -> API Center -> Confluent Cloud -> S3
```

This is an operator-only management action. It does not create direct tribe
Confluent credentials.

## Current Cloud Resources

| Resource | Current role |
| --- | --- |
| GCP project | Hosts GKE, Secret Manager, Memorystore, Artifact Registry, and load-balancer resources. |
| GKE cluster | `api-center` in `asia-southeast1`; runs APICenter pods. |
| GKE namespace | `api-center`. |
| APICenter HPA | Current low-credit target is min 2 pods, max 3 pods. |
| Shared-service HPAs | `payment`, `sms`, `email`, `gauth`, `otp`, and `geo` run as internal `ClusterIP` services with HPA min 1, max 3. |
| Secret Manager | `api-center-prod` for gateway/platform secrets, `api-center-tribe-secret-<tribe-id>` for per-tribe secret hashes, and `api-shared-services-prod` for shared-service provider secrets. |
| Memorystore Redis | Registry/token cache, rate-limit counters, and shared-service OTP/SMS state. Current low-traffic target uses one 1 GiB Basic instance, `api-center-cache` at `10.88.197.107:6379`; verify the endpoint in GCP before pasting. |
| Postgres control-plane DB | Optional ACID store for durable management state. Keep disabled until the database is created and migrated; Redis remains the active source for now. See [database-control-plane.md](database-control-plane.md). |
| Shared-service Postgres schemas | Optional provider/domain records for payment, OTP, email, SMS, geo, and Google OAuth. These schemas are migrated from `api-shared-services` and remain disabled until runtime persistence is wired. |
| Confluent Cloud | Managed Kafka cluster and connector runtime. Use Kafka cluster API keys for `KAFKA_SASL_USERNAME` and `KAFKA_SASL_PASSWORD`. |
| AWS S3 | Raw data lake target for the Confluent S3 Sink connector. |

## Service Catalog

APICenter routes:

| Route | Purpose |
| --- | --- |
| `/api/v1/auth/*` | Token issuance, refresh, revocation, JWKS, and configured auth provider flows. |
| `/api/v1/registry/*` | Tribe and shared-service registration/discovery. |
| `/api/v1/tribes/:serviceId/*` | Synchronous tribe-to-tribe proxy path. |
| `/api/v1/shared/:serviceId/*` | Shared platform services proxy path. |
| `/api/v1/kafka/*` | Governed Kafka catalog and publish path backed by Confluent Cloud. |
| `/api/v1/analytics/shared-service-usage` | Protected admin JSON endpoint for shared-service runtime call counts by tribe and shared service. |
| `/api/v1/analytics/gateway-traffic` | Protected admin JSON endpoint for gateway traffic, error, Kafka publish-failure, readiness-failure, and latency counters. |
| `/api/v1/analytics/provider-usage` | Protected admin JSON endpoint that groups shared-service runtime calls by provider-facing shared service. |
| `/api/v1/analytics/alerts` | Protected admin JSON endpoint for read-only operational alerts derived from registry metadata and runtime counters. |
| `/api/v1/analytics/audit/events` | Protected admin JSON endpoint for recent registry, proxy, Kafka, and readiness audit events. |
| `/api/v1/health/*` and `/api/v1/metrics` | Runtime health, readiness, and metrics. |

Shared services:

| Service ID | Runtime | Internal service URL | Provider / function |
| --- | --- | --- | --- |
| `payment` | `api-shared-services/shared-services/paymongo` | `http://payment-service:4010` | PayMongo checkout, subscriptions, refunds, and webhooks. |
| `email` | `api-shared-services/shared-services/email-gateway` | `http://email-service:4012` | Resend email sending. |
| `sms` | `api-shared-services/shared-services/sms-gateway` | `http://sms-service:4011` | SMS gateway contract. Current implementation is platform-owned and can be wired to a carrier later. |
| `gauth` | `api-shared-services/shared-services/gauth-gateway` | `http://gauth-service:4013` | Google OAuth authorization URL, code exchange, refresh, and logout. |
| `otp` | `api-shared-services/shared-services/otp-gateway` | `http://otp-service:4014` | OTP generation, verification, and status. |
| `geo` | `api-shared-services/shared-services/geo-gateway` | `http://geo-service:4015` | Google Maps geocoding/reverse geocoding and local geofence checks. |

## SDK Wrappers Tribes Should Use

Typed wrappers:

- Payment: `paymentCreateCheckoutSession`, `paymentGetCheckoutSession`, `paymentCreateCustomer`, `paymentCreateProduct`, `paymentCreatePrice`, `paymentCreateSubscription`, `paymentGetSubscription`, `paymentCancelSubscription`, `paymentCreateRefund`
- Email: `emailSend`, `emailGetStatus`
- SMS: `smsSend`, `smsGetStatus`
- Google OAuth: `gauthGetAuthorizationUrl`, `gauthExchangeCode`, `gauthRefreshToken`, `gauthLogout`
- OTP: `otpGenerate`, `otpVerify`, `otpStatus`
- Geo: `geoGeocodeAddress`, `geoReverseGeocode`, `geoFenceCheck`
- Kafka: `kafkaGetGovernanceCatalog`, `kafkaPublish`

Generic calls are still available through `callService()` and `callSharedService()`, but new tribe integrations should prefer typed wrappers when a wrapper exists.

## API Center Secret Manager Payload

Secret name:

```text
api-center-prod
```

Paste a JSON object shaped like this. Do not put shared-service provider keys here.
On GKE, non-secret values such as Redis URLs may also be set by
`infra/gcp/gke/20-configmap.yaml`; ConfigMap environment variables take precedence
because the Secret Manager loader does not overwrite existing `process.env`
keys. If you keep Redis URLs in this secret, keep them identical to the
ConfigMap values.

```json
{
  "NODE_ENV": "production",
  "PLATFORM_ADMIN_SECRET": "<long-random-shared-registration-secret>",
  "AUTH_PROVIDER": "composite",
  "INTERNAL_JWT_ISSUER": "https://api-center.itsandbox.site",
  "INTERNAL_JWT_AUDIENCE": "api-center",
  "INTERNAL_JWT_ACCESS_TTL_SECONDS": "3600",
  "INTERNAL_JWT_REFRESH_TTL_SECONDS": "86400",
  "JWT_PRIVATE_KEY": "-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----",
  "JWT_PUBLIC_KEY": "-----BEGIN PUBLIC KEY-----\\n...\\n-----END PUBLIC KEY-----",
  "DESCOPE_BASE_URL": "https://api.descope.com",
  "DESCOPE_PROJECT_ID": "<descope-project-id>",
  "DESCOPE_AUDIENCE": "<descope-project-id>",
  "DESCOPE_ISSUER": "https://api.descope.com/v1/apps/<descope-project-id>",
  "REDIS_CACHE_URL": "redis://<api-center-cache-private-ip>:6379",
  "REDIS_RATE_LIMIT_URL": "redis://<api-center-cache-private-ip>:6379",
  "KAFKA_BROKERS": "<confluent-bootstrap-host>:9092",
  "KAFKA_SSL_ENABLED": "true",
  "KAFKA_SSL_REJECT_UNAUTHORIZED": "true",
  "KAFKA_SASL_MECHANISM": "plain",
  "KAFKA_SASL_USERNAME": "<confluent-kafka-cluster-api-key>",
  "KAFKA_SASL_PASSWORD": "<confluent-kafka-cluster-api-secret>",
  "TRIBE_SECRET_SOURCE": "gcp-secret-manager",
  "TRIBE_SECRET_GCP_PREFIX": "api-center-tribe-secret-",
  "TRIBE_SECRET_CACHE_TTL_SECONDS": "300"
}
```

`AUTH_PROVIDER=composite` is the recommended production mode. API Center issues
tribe machine-to-machine tokens itself using the `JWT_PRIVATE_KEY` /
`JWT_PUBLIC_KEY` pair, while still accepting Descope tokens for human/admin
flows during migration. Do not create one Descope app per tribe for API Center
M2M auth unless you intentionally switch back to `AUTH_PROVIDER=descope`.

`KAFKA_SASL_USERNAME` and `KAFKA_SASL_PASSWORD` are the Confluent Cloud Kafka cluster API key and secret. They are not the old self-managed cluster user/password and not the Confluent Cloud management API key unless that key was explicitly created with Kafka cluster scope.

Generate `PLATFORM_ADMIN_SECRET`:

```powershell
-join ((48..57 + 65..90 + 97..122) | Get-Random -Count 64 | ForEach-Object {[char]$_})
```

Generate a tribe secret hash:

```powershell
$raw = "tribe-raw-secret"
$bytes = [System.Text.Encoding]::UTF8.GetBytes($raw)
([System.Security.Cryptography.SHA256]::Create().ComputeHash($bytes) | ForEach-Object { $_.ToString("x2") }) -join ""
```

## Per-Tribe Secret Manager Payload

Do not add new `TRIBE_SECRET_*` keys to `api-center-prod`. Each tribe gets its
own Secret Manager secret:

```text
api-center-tribe-secret-<tribe-id>
```

Payload:

```json
{
  "serviceId": "orders-service",
  "secretHashSha256": "<sha256 hash of plaintext tribe secret>",
  "status": "active",
  "rotatedAt": "2026-05-14T00:00:00.000Z"
}
```

API Center reads this payload dynamically when
`TRIBE_SECRET_SOURCE=gcp-secret-manager` is set. Resolved hashes are cached for
`TRIBE_SECRET_CACHE_TTL_SECONDS`, so normal tribe onboarding does not require an
API Center restart.

Legacy rollback path: `TRIBE_SECRET_<SERVICE_ID_UPPER_SNAKE>` in
`api-center-prod` still works during migration and takes precedence over the
per-tribe Secret Manager secret. Remove those legacy keys after smoke tests
pass.

## Shared Services Secret Manager Payload

Secret name:

```text
api-shared-services-prod
```

Use one shared secret payload for provider-backed shared services if they run together, or split the same keys per service if each runtime has its own deployment secret.

```json
{
  "NODE_ENV": "production",
  "API_CENTER_URL": "http://api-center.api-center.svc.cluster.local",
  "PLATFORM_ADMIN_SECRET": "<same-value-as-api-center-prod>",
  "REDIS_URL": "redis://<api-center-cache-private-ip>:6379",
  "OTP_REDIS_URL": "redis://<api-center-cache-private-ip>:6379",
  "SMS_REDIS_URL": "redis://<api-center-cache-private-ip>:6379",
  "SHARED_SERVICES_DATABASE_ENABLED": "false",
  "SHARED_SERVICES_DATABASE_URL": "postgresql://shared_services_app:<password>@<supabase-pooler-host>:6543/postgres?pgbouncer=true",
  "PAYMENT_SUBSCRIPTIONS_ENABLED": "false",
  "PAYMENT_PROVIDER_MODE": "test",
  "PAYMENT_PROVIDER_NAME": "paymongo",
  "PAYMONGO_BASE_URL": "https://api.paymongo.com/v1",
  "PAYMONGO_TEST_SECRET_KEY": "<paymongo-test-secret-key>",
  "PAYMONGO_LIVE_SECRET_KEY": "<paymongo-live-secret-key>",
  "PAYMONGO_TEST_WEBHOOK_SECRET": "<paymongo-test-webhook-secret>",
  "PAYMONGO_LIVE_WEBHOOK_SECRET": "<paymongo-live-webhook-secret>",
  "RESEND_API_KEY": "<resend-api-key>",
  "EMAIL_FROM_ADDRESS": "noreply@alphaexplora.com",
  "GOOGLE_CLIENT_ID": "<oauth-client-id>",
  "GOOGLE_CLIENT_SECRET": "<oauth-client-secret>",
  "GOOGLE_REDIRECT_URI": "https://api-center.itsandbox.site/api/v1/shared/gauth/oauth/callback",
  "GOOGLE_MAPS_API_KEY": "<google-maps-api-key>",
  "GOOGLE_MAPS_GEOCODING_URL": "https://maps.googleapis.com/maps/api/geocode/json"
}
```

Use `PAYMENT_PROVIDER_MODE=test` until you are ready for live charges. Keeping test and live PayMongo keys in the same secret lets the runtime switch mode without editing credentials.

Keep `SHARED_SERVICES_DATABASE_ENABLED=false` until Supabase migrations have
been deployed from `api-shared-services`, and each shared-service
gateway has runtime persistence tests. The DB URL belongs in
`api-shared-services-prod`, not `api-center-prod`.

Keep `PAYMENT_SUBSCRIPTIONS_ENABLED=false` in production until the test
environment has proven catalog creation, subscription creation, cancellation,
invoice webhook persistence, and sanitized export events. The production
`payment-service` manifest also sets the flag to `"false"` as a live-charge
guard; the test overlay enables it only for `api-center-test`.

Optional shared-service migration command from `api-shared-services`:

```powershell
npx supabase link --project-ref <project-ref>
npx supabase db push --dry-run
npx supabase db push
```

## Legacy Keys To Remove

Remove these from GCP Secret Manager, `.env`, and old deployment notes:

```text
PAYMONGO_SECRET_KEY
PAYMONGO_WEBHOOK_SECRET
GEOLOCATION_API_URL
GEOLOCATION_API_KEY
GEOTAGGING_API_URL
GEOTAGGING_API_KEY
GEOFENCING_API_URL
GEOFENCING_API_KEY
EXTERNAL_ALLOWLIST_GEOLOCATION
EXTERNAL_ALLOWLIST_GEOTAGGING
EXTERNAL_ALLOWLIST_GEOFENCING
KAFKA_SSL_CA_PEM
```

Also remove old self-managed Kafka broker values such as:

```text
api-center-kafka-kafka-bootstrap.kafka.svc.cluster.local:9092
```

For Confluent Cloud, use the bootstrap endpoint shown in the Confluent cluster settings. It should look like a Confluent hostname on port `9092`.

## Where To Get Each Provider Secret

### Confluent Cloud

1. Open Confluent Cloud.
2. Select the Kafka cluster used by APICenter.
3. Go to API keys.
4. Create or select a key with Kafka cluster scope.
5. Use:
   - Key as `KAFKA_SASL_USERNAME`
   - Secret as `KAFKA_SASL_PASSWORD`
6. Copy the cluster bootstrap endpoint into `KAFKA_BROKERS`.

### PayMongo

1. Open PayMongo Dashboard.
2. Go to Developers > API keys.
3. Copy both test and live secret keys:
   - `PAYMONGO_TEST_SECRET_KEY`
   - `PAYMONGO_LIVE_SECRET_KEY`
4. Go to Developers > Webhooks.
5. Create one test webhook and one live webhook.
6. Use the one gateway URL:
   - `https://api-center.itsandbox.site/api/v1/shared/payment/webhooks`
7. Minimum event for checkout-only flows:
   - `checkout.session.payment.paid`
8. Add these if you use direct payment/refund flows:
   - `payment.paid`
   - `payment.failed`
   - `payment.refunded`
   - `payment.refund.updated`
9. Add these before enabling subscription smoke tests:
   - `subscription.created`
   - `subscription.active`
   - `subscription.past_due`
   - `subscription.paused`
   - `subscription.cancelled`
   - `invoice.created`
   - `invoice.paid`
   - `invoice.failed`
10. Copy each webhook signing secret into the matching test/live key.

The PayMongo public key is for browser/client-side flows. The current shared-service runtime uses server-side secret keys and webhook secrets.

Payment result pages use the hybrid model:

- API Center/shared services own checkout state, webhook processing, refunds,
  cancellation markers, and data export.
- Tribes own their branded success, cancelled, and failed pages.
- Tribe cancelled pages should call
  `POST /api/v1/shared/payment/checkout/sessions/:checkoutId/cancelled`, then
  read `GET /api/v1/shared/payment/checkout/sessions/:checkoutId/status`.

### Resend

1. Open Resend.
2. Add and verify your sending domain.
3. Create an API key.
4. Set `RESEND_API_KEY`.
5. Choose a sender address on the verified domain, for example `noreply@alphaexplora.com`, and set `EMAIL_FROM_ADDRESS`.

### Google OAuth

1. Open Google Cloud Console.
2. Go to APIs & Services > OAuth consent screen and configure the app.
3. Go to APIs & Services > Credentials.
4. Create OAuth client ID with application type `Web application`.
5. Add the authorized redirect URI:
   - `https://api-center.itsandbox.site/api/v1/shared/gauth/oauth/callback`
6. Copy:
   - Client ID to `GOOGLE_CLIENT_ID`
   - Client secret to `GOOGLE_CLIENT_SECRET`

If each tribe gets its own domain later, add each tribe callback URL to the same OAuth client or create separate OAuth clients per domain. The shared service can accept a per-request `redirectUri`, but Google must already allow that exact URI.

For tenant-branded Google login, keep APICenter's shared OAuth client as the
fallback client and add tenant-specific clients through
`GOOGLE_OAUTH_TENANT_CLIENTS_JSON` in the shared-services Secret Manager
payload. Tenant auth projects live under
`20-customer-runtime/apicenter/dedicated/tenant-<slug>/<auth-project-id>`, but
the runtime client ID and client secret stay centrally in APICenter Secret
Manager so `gauth` can resolve credentials without cross-project secret reads.
See `docs/operations/tenant-branded-google-oauth.md`.

### Google Maps Platform

1. Open Google Cloud Console.
2. Enable Maps Platform billing.
3. Enable the Geocoding API.
4. Create an API key.
5. Restrict it to the Geocoding API and the deployment egress/IP policy you use.
6. Store it as `GOOGLE_MAPS_API_KEY` in `api-shared-services-prod`.

Geo is a shared service now. Do not put Google Maps keys in `api-center-prod`.

### Redis / Memorystore

Use Memorystore private endpoints from the GCP console:

- `REDIS_CACHE_URL` is for registry/token/cache state.
- `REDIS_RATE_LIMIT_URL` is for APICenter rate-limit counters. For the current low-traffic setup, point this to the same Memorystore instance as `REDIS_CACHE_URL`.
- `REDIS_URL`, `OTP_REDIS_URL`, and `SMS_REDIS_URL` are used by shared-service runtimes that need provider-side state.

Use a separate rate-limit Redis only when traffic is high enough that counter churn can threaten registry or token state.

## Deployment Order

1. Update `api-center-prod` once with platform/runtime keys and the tribe secret
   resolver settings.
2. Update `api-shared-services-prod`.
3. If Supabase Postgres is being introduced, run API Center and shared-service
   Supabase migrations first, but keep both database feature flags disabled
   until runtime verification is ready.
4. Restart or redeploy APICenter only when its own platform secret changed.
5. In `api-shared-services`, run `scripts/sync-gke-secret.ps1` to copy
   `api-shared-services-prod` into the Kubernetes secret of the same name.
6. Apply `api-shared-services/infra/gcp/gke/00-shared-services.yaml`.
7. Confirm shared services self-register through `PLATFORM_ADMIN_SECRET`.
8. Register tribe manifests with `consumes` entries for the shared services they need.
9. Create `api-center-tribe-secret-<tribe-id>` for each tribe secret hash.
10. Provision `tribe.<tribe-id>.events` from the management console and add it
   to `api-center-s3-sink`. Microservices owned by that tribe use the same topic
   and carry `sourceServiceId` for attribution.
11. Issue a tribe token and smoke test one route per shared service.
12. Verify Confluent publishing and S3 sink delivery.

Current deployed shared-service image tag:

```text
c090386
```

After changing only shared-service provider secrets, run the secret sync and
restart only the affected shared-service deployment. Existing pods do not reload
environment variables automatically.

## Smoke Checks

Local:

```bash
cd api-shared-services
npm run ci

cd ../api-center
npm run check:contracts
npm run typecheck
npm run lint
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run build
```

Deployed:

```bash
curl https://api-center.itsandbox.site/api/v1/health/live
curl https://api-center.itsandbox.site/api/v1/health/ready
curl https://api-center.itsandbox.site/api/v1/metrics
```

In `/api/v1/metrics`, check for Kafka producer readiness and publish failure counters. In GKE, also check pod restarts and readiness probe failures before sending tribes to the gateway.

## Tribe Readiness Checklist

Before a tribe uses shared services:

- Tribe has a stable `serviceId`.
- `api-center-tribe-secret-<tribe-id>` exists and stores only the SHA-256 hash.
- API Center has a persistent internal JWT key pair in `JWT_PRIVATE_KEY` and
  `JWT_PUBLIC_KEY`; do not use generated in-memory keys in production.
- Tribe manifest is registered with correct `consumes`.
- Shared-service manifests are registered and healthy.
- Tribe installs `@implementsprint/sdk` from the private registry.
- Tribe calls wrappers instead of provider APIs directly.
- Provider credentials are only in shared-service secrets.
- Confluent publishing uses `kafkaPublish()` and governed topic names.

## Future Multi-Domain / Multi-Org Changes

If projects move to per-domain deployments later:

- Add each callback domain to Google OAuth authorized redirect URIs, or create one OAuth client per domain.
- Add and verify each sender domain in Resend, then set `EMAIL_FROM_ADDRESS` per environment.
- Create PayMongo webhooks per environment/domain if callback URLs differ.
- Keep `PLATFORM_ADMIN_SECRET` and tribe secrets per environment; do not reuse production secrets across orgs.
- Move billing by linking a new billing account to the GCP project, or create a new GCP project and redeploy with new Secret Manager, Memorystore, and Workload Identity bindings.
