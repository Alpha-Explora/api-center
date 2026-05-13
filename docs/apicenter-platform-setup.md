# APICenter Platform Setup

This is the operator guide for the current APICenter deployment model.

## Repositories

| Repo | Owns |
| --- | --- |
| `api-center` | Gateway runtime, auth, registry, proxying, policy checks, rate limits, readiness, metrics, and Confluent publishing. |
| `api-shared-services` | `@apicenter/sdk`, shared-service manifests, shared-service runtimes, provider integrations, and SDK contract checks. |

Tribes install `@apicenter/sdk` from the private registry. The SDK calls APICenter only. It does not call PayMongo, Resend, Google, or Confluent directly.

## Runtime Architecture

Synchronous calls:

```text
tribe service
  -> @apicenter/sdk
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

## Current Cloud Resources

| Resource | Current role |
| --- | --- |
| GCP project | Hosts GKE, Secret Manager, Memorystore, Artifact Registry, and load-balancer resources. |
| GKE cluster | `api-center` in `us-central1`; runs APICenter pods. |
| GKE namespace | `api-center`. |
| APICenter HPA | Current low-credit target is min 2 pods, max 3 pods. |
| Secret Manager | `api-center-prod` for gateway secrets. Use `api-shared-services-prod` for shared-service provider secrets. |
| Memorystore Redis | Registry/token cache, rate-limit counters, and shared-service OTP/SMS state. Current low-traffic target uses one 1 GiB Basic instance, `api-center-cache` at `10.34.181.131:6379`; verify the endpoint in GCP before pasting. |
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
| `/api/v1/health/*` and `/api/v1/metrics` | Runtime health, readiness, and metrics. |

Shared services:

| Service ID | Runtime | Provider / function |
| --- | --- | --- |
| `payment` | `api-shared-services/shared-services/paymongo` | PayMongo checkout, payment lookup, refunds, and webhooks. |
| `email` | `api-shared-services/shared-services/email-gateway` | Resend email sending. |
| `sms` | `api-shared-services/shared-services/sms-gateway` | SMS gateway contract. Current implementation is platform-owned and can be wired to a carrier later. |
| `gauth` | `api-shared-services/shared-services/gauth-gateway` | Google OAuth authorization URL, code exchange, refresh, and logout. |
| `otp` | `api-shared-services/shared-services/otp-gateway` | OTP generation, verification, and status. |
| `geo` | `api-shared-services/shared-services/geo-gateway` | Google Maps geocoding/reverse geocoding and local geofence checks. |

## SDK Wrappers Tribes Should Use

Typed wrappers:

- Payment: `paymentCreateCheckoutSession`, `paymentGetCheckoutSession`, `paymentCreateRefund`
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
`gcp/gke/20-configmap.yaml`; ConfigMap environment variables take precedence
because the Secret Manager loader does not overwrite existing `process.env`
keys. If you keep Redis URLs in this secret, keep them identical to the
ConfigMap values.

```json
{
  "NODE_ENV": "production",
  "PLATFORM_ADMIN_SECRET": "<long-random-shared-registration-secret>",
  "DESCOPE_BASE_URL": "https://api.descope.com",
  "DESCOPE_PROJECT_ID": "<descope-project-id>",
  "DESCOPE_TOKEN_ENDPOINT": "https://api.descope.com/oauth2/v1/apps/token",
  "DESCOPE_DEFAULT_CLIENT_SECRET": "<descope-app-secret>",
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
  "TRIBE_SECRET_<SERVICE_ID>": "<sha256-of-tribe-secret>"
}
```

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
  "PAYMENT_PROVIDER_MODE": "test",
  "PAYMENT_PROVIDER_NAME": "paymongo",
  "PAYMONGO_BASE_URL": "https://api.paymongo.com/v1",
  "PAYMONGO_TEST_SECRET_KEY": "<paymongo-test-secret-key>",
  "PAYMONGO_LIVE_SECRET_KEY": "<paymongo-live-secret-key>",
  "PAYMONGO_TEST_WEBHOOK_SECRET": "<paymongo-test-webhook-secret>",
  "PAYMONGO_LIVE_WEBHOOK_SECRET": "<paymongo-live-webhook-secret>",
  "RESEND_API_KEY": "<resend-api-key>",
  "EMAIL_FROM_ADDRESS": "noreply@itsandbox.site",
  "GOOGLE_CLIENT_ID": "<oauth-client-id>",
  "GOOGLE_CLIENT_SECRET": "<oauth-client-secret>",
  "GOOGLE_REDIRECT_URI": "https://api-center.itsandbox.site/api/v1/shared/gauth/oauth/callback",
  "GOOGLE_MAPS_API_KEY": "<google-maps-api-key>",
  "GOOGLE_MAPS_GEOCODING_URL": "https://maps.googleapis.com/maps/api/geocode/json"
}
```

Use `PAYMENT_PROVIDER_MODE=test` until you are ready for live charges. Keeping test and live PayMongo keys in the same secret lets the runtime switch mode without editing credentials.

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
6. Use the gateway URL:
   - `https://api-center.itsandbox.site/api/v1/shared/payment/webhooks`
7. Minimum event for checkout-only flows:
   - `checkout.session.payment.paid`
8. Add these if you use direct payment/refund flows:
   - `payment.paid`
   - `payment.failed`
   - `payment.refunded`
   - `payment.refund.updated`
9. Copy each webhook signing secret into the matching test/live key.

The PayMongo public key is for browser/client-side flows. The current shared-service runtime uses server-side secret keys and webhook secrets.

### Resend

1. Open Resend.
2. Add and verify your sending domain.
3. Create an API key.
4. Set `RESEND_API_KEY`.
5. Choose a sender address on the verified domain, for example `noreply@itsandbox.site`, and set `EMAIL_FROM_ADDRESS`.

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

1. Update `api-center-prod`.
2. Update `api-shared-services-prod`.
3. Restart or redeploy APICenter so it reads the new Secret Manager version.
4. Deploy or restart shared-service runtimes so they read provider secrets.
5. Confirm shared services self-register through `PLATFORM_ADMIN_SECRET`.
6. Register tribe manifests with `consumes` entries for the shared services they need.
7. Issue a tribe token and smoke test one route per shared service.
8. Verify Confluent publishing and S3 sink delivery.

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
- `TRIBE_SECRET_<SERVICE_ID>` exists in `api-center-prod` as a SHA-256 hash.
- Tribe manifest is registered with correct `consumes`.
- Shared-service manifests are registered and healthy.
- Tribe installs `@apicenter/sdk` from the private registry.
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
