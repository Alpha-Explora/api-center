# APICenter - Centralized API Gateway

APICenter is the **single, centralized API gateway** for the platform. Tribe-to-tribe calls, shared platform services, auth, registry, and governed event publishing route through APICenter. No tribe calls another tribe or provider API directly.

> **Current payment platform boundary (2026-07-27):** APICenter is the Turborepo source of truth. The TypeScript gateway exposes `/api/v1/payments/*`; the private `apps/payments` runtime owns PayMongo credentials, provider calls, webhook verification, canonical `shared_payment` state, and the outbox. Payment lifecycle delivery uses APICenter-owned Google Pub/Sub. `api-shared` is frozen migration source and is not a new feature target.

The private payments app is configured with `APICENTER_PAYMENTS_URL` and `APICENTER_PAYMENTS_INTERNAL_TOKEN`. Set `PUBSUB_DISPATCHER_ENABLED=true` only in a GCP runtime with Pub/Sub permissions; the dispatcher publishes pending outbox rows to `APICENTER_PAYMENT_EVENTS_TOPIC_TEST` or `APICENTER_PAYMENT_EVENTS_TOPIC_LIVE`.

> **For platform operators and contributors:** see [docs/developer/README.md](docs/developer/README.md) for local dev setup, testing, CI/CD, and GCP deployment.
>
> **Full platform setup:** see [docs/apicenter-platform-setup.md](docs/apicenter-platform-setup.md) for the current APICenter + shared services + provider secrets runbook.
>
> **Deploying?** Pick one:
>
> Current production uses Cloud Run. The old GKE Autopilot cluster and former
> GKE load balancer IP were removed after all shared services migrated to Cloud
> Run and passed public API Center route verification.
>
> - [Cloud Run deployment record](docs/deployment-cloud-run.md) - current production runtime, cutover evidence, gates, and rollback commands
> - [GKE Autopilot historical reference](infra/gcp/gke/README.md) - retired manifests, HPA min 2 / max 3, Memorystore, and former GCLB Ingress

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Quick Start â€” dev-jwt (zero config)](#quick-start--dev-jwt-zero-config)
3. [Auth Providers](#auth-providers)
   - [dev-jwt â€” Local Dev & CI](#1-dev-jwt--local-dev--ci-default)
  - [Internal Tribe JWT + Descope Fallback](#2-internal-tribe-jwt--descope-fallback)
4. [Service Registration](#service-registration)
5. [SDK Usage](#sdk-usage)
6. [Shared Geo and Payment Events](#shared-geo-and-payment-events)
7. [API Reference](#api-reference)

---

## Architecture Overview

```text
tribe service / browser / external client
  -> API Center public gateway
  -> auth, registry, consumes, scope, rate-limit, and circuit-breaker checks
  -> /api/v1/tribes/:serviceId/* or /api/v1/shared/:serviceId/*
  -> registered tribe or shared-service runtime

API Center instances are stateless. Redis is the current active registry, token,
rate-limit, and short-window analytics store. Optional Postgres schemas exist for
future durable control-plane and shared-service business state, but they are disabled
until Supabase migrations and cutover checks are complete.
```

### Route Namespaces

| Path | What it proxies |
|------|----------------|
| `/api/v1/tribes/:serviceId/*` | Tribe-to-tribe calls |
| `/api/v1/shared/:serviceId/*` | Legacy shared-service proxy namespace |
| `/api/v1/payments/*` | Authenticated provider-neutral payments facade |
| `/api/v1/external/:apiName/*` | Legacy external proxy namespace; current provider-backed functionality should be exposed as shared services or governed Kafka routes |
| `/api/v1/auth/*` | Token issuance / refresh / revocation |
| `/api/v1/registry/*` | Service self-registration |
| `/api/v1/health/*` | Liveness + readiness probes |

### Runtime Stores

Current production still uses Redis as the active registry/token/rate-limit
runtime store. The optional Postgres control-plane schema exists for durable
management state but should remain disabled until Supabase migrations are
applied, Redis data is backfilled, and parity checks pass.

| Store | Current role |
| --- | --- |
| Redis / Memorystore | Active registry source, token state, rate-limit counters, short-window analytics |
| API Center Postgres schemas | Optional durable control-plane state, disabled by default |
| APICenter payments Postgres schema | Canonical payment state owned by `apps/payments` |
| Google Pub/Sub | Payment lifecycle event delivery and consumer subscriptions |
| Secret Manager | Platform secrets, per-tribe secret hashes, provider secrets |

---

## Quick Start â€” dev-jwt (zero config)

No external dependencies. All tokens are self-issued by the gateway.

```bash
cp .env.example .env
# AUTH_PROVIDER=dev-jwt is already the default â€” no changes needed
docker compose -f deploy/local/docker-compose.yml up -d
```

The gateway is available at `http://localhost:3000`. Wait ~30 s for all containers to become healthy:

```bash
docker compose -f deploy/local/docker-compose.yml ps   # all services should show "healthy"
```

---

## Auth Providers

APICenter uses API Center-signed tribe JWTs for production machine-to-machine auth, Descope validation for human/admin tokens, and a local/CI issuer. Select one with `AUTH_PROVIDER`.

| Value | Use case | External dependency |
|-------|----------|---------------------|
| `dev-jwt` | Local dev, CI | None |
| `internal-jwt` | API Center-issued tribe M2M tokens only | Persistent API Center JWT key pair |
| `composite` | Production default: issue internal tribe JWTs, validate internal + Descope tokens | API Center JWT key pair; Descope only for human/admin token validation |
| `descope` | Legacy Descope-only M2M mode | Descope project |

---

### 1. dev-jwt - Local Dev & CI (default)

Self-contained RS256 JWT issuer. No external IdP required.

```bash
AUTH_PROVIDER=dev-jwt
```

**Key source priority:**

| Priority | Source | Config |
|----------|--------|--------|
| 1 | Vault Transit engine | `VAULT_TRANSIT_KEY=<key-name>` |
| 2 | PEM loaded from Vault KV | Vault KV at `VAULT_SECRET_PATH` with `jwt_private_key` |
| 3 | PEM from env vars | `JWT_PRIVATE_KEY` + `JWT_PUBLIC_KEY` |
| 4 | Ephemeral in-memory (default) | tokens lost on restart |

**Generate a stable local key pair:**

```bash
openssl genrsa 2048 > private.pem
openssl rsa -in private.pem -pubout > public.pem

# Inline into .env (escaping newlines):
JWT_PRIVATE_KEY="$(awk 'NF{printf "%s\\n",$0}' private.pem)"
JWT_PUBLIC_KEY="$(awk 'NF{printf "%s\\n",$0}' public.pem)"
```

**JWKS endpoint:**

```text
GET http://localhost:3000/api/v1/auth/.well-known/jwks.json
```

---

### 2. Internal Tribe JWT + Descope Fallback

```bash
AUTH_PROVIDER=composite
INTERNAL_JWT_ISSUER=https://api-center.itsandbox.site
INTERNAL_JWT_AUDIENCE=api-center
INTERNAL_JWT_ACCESS_TTL_SECONDS=3600
INTERNAL_JWT_REFRESH_TTL_SECONDS=86400
JWT_PRIVATE_KEY="<persistent-rs256-private-key-pem>"
JWT_PUBLIC_KEY="<persistent-rs256-public-key-pem>"
```

Use `composite` in production. API Center issues tribe M2M tokens itself and validates Descope tokens as a fallback for human/admin flows. New tribes need environment-scoped GCP Secret Manager records named `api-center-tribe-secret-<tribe-id>-test` and `api-center-tribe-secret-<tribe-id>-live`; they do not need one Descope app per tribe.

Descope-only M2M mode is retained only for historical local testing and should not be used for new tribe onboarding:

```bash
AUTH_PROVIDER=descope
DESCOPE_BASE_URL=https://api.descope.com
DESCOPE_PROJECT_ID=<your-descope-project-id>
DESCOPE_JWKS_URI=https://api.descope.com/<project-id>/.well-known/jwks.json
DESCOPE_TOKEN_ENDPOINT=https://api.descope.com/oauth2/v1/token
DESCOPE_ISSUER=https://api.descope.com/<project-id>
DESCOPE_AUDIENCE=api-center
DESCOPE_DEFAULT_CLIENT_SECRET=<m2m-client-secret>
```

Per-service Descope secret overrides are not part of the current APICenter tribe M2M contract:

```bash
DESCOPE_CLIENT_SECRET_PAYMENT_SERVICE=<service-secret>
```

---

### Google OAuth and Google APIs

Google OAuth and Google API credentials are owned by `api-shared-services`, not by API Center's auth provider switch. Register and call the shared services through `/api/v1/shared/gauth/*` and `/api/v1/shared/geo/*` using the SDK wrappers.

---

## Service Registration

Services register themselves at startup:

Shared platform service artifacts (service code and registration manifests) are owned in the sibling repository:

- `../api-shared-services/shared-services/`

```bash
curl -s -X POST http://localhost:3000/api/v1/registry/register \
  -H "Content-Type: application/json" \
  -d '{
    "serviceId":      "payment-service",
    "name":           "Payment Service",
    "baseUrl":        "http://payment-service:4001",
    "requiredScopes": ["payments:read", "payments:write"],
    "exposes":        ["payments:read", "payments:write"],
    "consumes":       ["user-service", "email-service"],
    "healthCheck":    "/health",
    "version":        "1.0.0"
  }'
```

After registration the service is immediately routable at `/api/v1/tribes/payment-service/*`.

### Bootstrap mode when tribe services are not available yet

If real tribe services are not ready, the gateway can preload manifests at startup:

```bash
REGISTRY_BOOTSTRAP_ENABLED=true
REGISTRY_BOOTSTRAP_ALLOW_IN_PRODUCTION=false
REGISTRY_BOOTSTRAP_MANIFESTS=examples/logistics-manifest.json,examples/demand-manifest.json
```

Behavior:

- Gateway loads listed manifest files during application bootstrap.
- Registered entries become immediately discoverable via `/api/v1/tribes` and `/api/v1/shared`.
- Duplicate `serviceId` values are skipped deterministically with startup warnings.
- In production, bootstrap is blocked unless `REGISTRY_BOOTSTRAP_ALLOW_IN_PRODUCTION=true` is explicitly set.
- This mode is intended for local/staging bootstrap and should be disabled once tribes self-register.

For migration from bootstrap manifests to real tribe startup registration, use the onboarding runbook:
[docs/developer/tribe-onboarding.md](docs/developer/tribe-onboarding.md).

**Per-service secret** (so the service can authenticate with the gateway):
```bash
# Generate and hash â€” gateway stores SHA-256, never plaintext
echo -n "my-plaintext-secret" | sha256sum | awk '{print $1}'

# Store the hash in Secret Manager, not in process env.
```

Runtime token requests must include `environment=test|live`. Create one Secret
Manager record per tribe and environment:

```text
api-center-tribe-secret-<tribe-id>-test
api-center-tribe-secret-<tribe-id>-live
```

The payload shape and IAM setup are documented in
[docs/apicenter-platform-setup.md](docs/apicenter-platform-setup.md).

---

## SDK Usage

Every tribe **must** use the shared SDK. Direct HTTP to the gateway is not permitted.

The TypeScript SDK source of truth is `packages/sdk` in this APICenter monorepo.
It calls only the gateway, never PayMongo. `AlphaCI` stores an APICenter API key
and keeps its own billing projection; it does not receive a PayMongo secret.

```typescript
import { TribeClient } from '@implementsprint/sdk';

const client = new TribeClient({
  gatewayUrl: process.env.APICENTER_URL,   // http://localhost:3000 (dev)
  tribeId:    process.env.APICENTER_TRIBE_ID,
  sourceServiceId: process.env.APICENTER_SERVICE_ID,
  secret:     process.env.MY_SERVICE_SECRET,
});

await client.authenticate();   // auto-refreshes before expiry

For payments, use the provider-neutral client from the same package:

```typescript
import { PaymentsClient } from "@apicenter/sdk";

const payments = new PaymentsClient({
  baseUrl: process.env.APICENTER_URL!,
  apiKey: process.env.APICENTER_API_KEY!,
  tribeId: process.env.APICENTER_TRIBE_ID!,
  environment: "test",
});

const checkout = await payments.createCheckout(input, "checkout-order-123");
```

// Tribe-to-tribe
const user = await client.callService('user-service', '/users/123');

// Shared platform service
await client.callSharedService('email-service', '/send', {
  method: 'POST',
  data: { to: 'user@example.com', template: 'welcome' },
});

// Draft payment wrapper (shared service)
const checkout = await client.paymentCreateCheckoutSession({
  referenceId: 'order-123',
  successUrl: 'https://app.example.com/payment/success',
  cancelUrl: 'https://app.example.com/payment/cancel',
  lineItems: [
    {
      name: 'Starter Plan',
      quantity: 1,
      amount: { value: 99900, currency: 'PHP' },
    },
  ],
});

const checkoutStatus = await client.paymentGetCheckoutSession(checkout.checkoutId);

await client.paymentCreateRefund('pay_123', {
  amount: { value: 5000, currency: 'PHP' },
  reason: 'customer_request',
});

// Shared geo service (Google Maps credentials stay in shared services)
const geo = await client.geoReverseGeocode({
  latitude: 13.7563,
  longitude: 100.5018,
});

const fence = await client.geoFenceCheck({
  latitude: 13.7563,
  longitude: 100.5018,
});

// Governed Kafka helpers backed by APICenter and Confluent Cloud
const kafkaGovernance = await client.kafkaGetGovernanceCatalog();
await client.publishTribeEvent({
  sourceServiceId: 'orders-service',
  key: 'order-123',
  eventType: 'order.created',
  payload: { orderId: 'order-123' },
});
```

**Error types:**
```typescript
import {
  AuthenticationError,    // 401 â€” bad credentials
  AuthorizationError,     // 403 â€” missing scopes
  ServiceNotFoundError,   // 404 â€” service not in registry
  RateLimitError,         // 429 â€” slow down (err.retryAfterMs available)
  GatewayTimeoutError,    // 504 â€” upstream too slow
  ServiceUnavailableError,// 503 â€” circuit breaker open
  NetworkError,           // no response from gateway
} from '@implementsprint/sdk';
```

**Optional constructor options:**

| Option | Default | Description |
|--------|---------|-------------|
| `timeout` | `30000` | Request timeout in ms |
| `maxRetries` | `3` | Retry attempts for transient failures |
| `retryBaseDelayMs` | `500` | Initial backoff delay (doubles each attempt with Â±25% jitter) |
| `correlationIdFactory` | â€” | Factory returning a correlation ID threaded across all requests |

---

## Shared Geo and Payment Events

Provider API credentials live in platform-owned runtimes; tribe services never hold them. Payment lifecycle events use APICenter-owned Google Pub/Sub and authenticated consumer push subscriptions. Kafka/Confluent is not part of the payment path.

Geo is not exposed through `/api/v1/external/*`. It is a platform-owned shared
service registered as `geo`, and tribes call it through `/api/v1/shared/geo/*`.

**Legacy non-payment Kafka:** The governed Kafka section below is retained only as historical guidance for non-payment platform events. Do not provision Confluent for the payment platform.

```bash
# Confluent Cloud producer used by governed Kafka publishing
KAFKA_BROKERS=<confluent-bootstrap-server>:9092
KAFKA_SSL_ENABLED=true
KAFKA_SASL_MECHANISM=plain
KAFKA_SASL_USERNAME=<confluent-api-key>
KAFKA_SASL_PASSWORD=<confluent-api-secret>

```

Tribes publish Kafka events through the governed SDK path:

```typescript
import { TribeClient } from '@implementsprint/sdk';

const client = new TribeClient({
  gatewayUrl: process.env.APICENTER_URL,
  tribeId: process.env.APICENTER_TRIBE_ID,
  sourceServiceId: process.env.APICENTER_SERVICE_ID,
  secret: process.env.ORDERS_SERVICE_SECRET,
});

await client.authenticate();

const governance = await client.kafkaGetGovernanceCatalog();
await client.publishTribeEvent({
  sourceServiceId: 'orders-service',
  key: 'order-123',
  eventType: 'order.created',
  payload: { orderId: 'order-123' },
});
```

Local end-to-end sandbox validation:

```powershell
./test-all-steps.ps1
```

## OpenAPI Contract Artifact

APICenter now generates an OpenAPI schema for non-Node consumers and generated client workflows.

```bash
npm run openapi:generate
```

Generated artifact location:

- `docs/openapi/openapi.json`

The script now performs service registration bootstrap and registry propagation checks across the gateway pool. Geo validation should use the shared `geo` service, while Confluent validation should use governed Kafka publish and S3 sink verification.

Required token scopes for governed Kafka publishing:

- `external:kafka:read` / `external:kafka:write`

Kafka tenant isolation rule:

- Governed tribe event publishing uses `tribe.<tribeId>.events` for the
  authenticated tribe. Microservices should keep the same `APICENTER_TRIBE_ID`
  and pass their registered backend ID as `sourceServiceId`.

To add reusable platform functionality, prefer a shared service manifest and SDK wrapper over a direct external proxy.

---

## API Reference

### Authentication

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/auth/token` | Issue M2M access + refresh token |
| `POST` | `/api/v1/auth/token/refresh` | Refresh an access token |
| `POST` | `/api/v1/auth/token/revoke` | Revoke a refresh token (or all tokens) |
| `GET` | `/api/v1/auth/.well-known/jwks.json` | JWKS endpoint (dev-jwt only) |

### Registry

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/registry/register` | Register a service |
| `GET` | `/api/v1/registry/services` | List all services |
| `GET` | `/api/v1/registry/services/:id` | Get a service |
| `PATCH` | `/api/v1/registry/services/:id/deprecate` | Deprecate a service (admin) |
| `DELETE` | `/api/v1/registry/services/:id` | Deregister a service (admin) |

### Routing

| Method | Path | Description |
|--------|------|-------------|
| `*` | `/api/v1/tribes/:serviceId/*` | Proxy to a registered tribe service |
| `*` | `/api/v1/shared/:serviceId/*` | Proxy to a shared platform service |
| `*` | `/api/v1/external/:apiName/*` | Legacy guarded external proxy namespace; no provider APIs are configured by default |

### Health

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/health/live` | Liveness â€” is the process running? |
| `GET` | `/api/v1/health/ready` | Readiness â€” Redis + Kafka connectivity |
| `GET` | `/nginx-health` | NGINX bypass health check |

---
