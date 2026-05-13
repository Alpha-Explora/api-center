# APICenter â€” Centralized API Gateway

APICenter is the **single, centralized API gateway** for the platform. Tribe-to-tribe calls, shared platform services, auth, registry, and governed event publishing route through APICenter. No tribe calls another tribe or provider API directly.

> **For platform operators and contributors:** see [docs/developer/README.md](docs/developer/README.md) for local dev setup, testing, CI/CD, and GCP deployment.
>
> **Full platform setup:** see [docs/apicenter-platform-setup.md](docs/apicenter-platform-setup.md) for the current APICenter + shared services + provider secrets runbook.
>
> **Deploying?** Pick one:
>
> - [Cloud Run](gcp/cloudrun.yaml) â€” single Knative Service, simplest path, scale 1â€“10
> - [GKE Autopilot + HPA](gcp/gke/README.md) â€” horizontal pod autoscaling 3â€“30, Memorystore, GCLB Ingress

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Quick Start â€” dev-jwt (zero config)](#quick-start--dev-jwt-zero-config)
3. [Auth Providers](#auth-providers)
   - [dev-jwt â€” Local Dev & CI](#1-dev-jwt--local-dev--ci-default)
  - [Descope â€” Enterprise OIDC](#2-descope--enterprise-oidc)
  - [Keycloak â€” Enterprise OIDC](#3-keycloak--enterprise-oidc)
4. [Service Registration](#service-registration)
5. [SDK Usage](#sdk-usage)
6. [Shared Geo and Governed Kafka](#shared-geo-and-governed-kafka)
7. [API Reference](#api-reference)

---

## Architecture Overview

```
Consumer (tribe SDK / browser / external client)
  â”‚
  â–¼  :3000  â† ONE entrypoint for everything
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  NGINX Load Balancer                            â”‚
â”‚  â€¢ Round-robin across 3 containers              â”‚
â”‚  â€¢ Passive health checks (auto remove/re-add)   â”‚
â”‚  â€¢ CORS preflight answered at NGINX level       â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”˜
           â”‚              â”‚              â”‚
  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â” â”Œâ”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â” â”Œâ”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”
  â”‚ api-center-1  â”‚ â”‚api-center-2â”‚ â”‚api-center-3â”‚
  â”‚  (stateless)  â”‚ â”‚ (stateless)â”‚ â”‚ (stateless)â”‚
  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜ â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜ â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
        All 3 share state via Redis (registry, tokens, rate-limit counters)
```

### Route Namespaces

| Path | What it proxies |
|------|----------------|
| `/api/v1/tribes/:serviceId/*` | Tribe-to-tribe calls |
| `/api/v1/shared/:serviceId/*` | Shared platform services (email, SMS, payments) |
| `/api/v1/external/:apiName/*` | Legacy external proxy namespace; current provider-backed functionality should be exposed as shared services or governed Kafka routes |
| `/api/v1/auth/*` | Token issuance / refresh / revocation |
| `/api/v1/registry/*` | Service self-registration |
| `/api/v1/health/*` | Liveness + readiness probes |

---

## Quick Start â€” dev-jwt (zero config)

No external dependencies. All tokens are self-issued by the gateway.

```bash
cp .env.example .env
# AUTH_PROVIDER=dev-jwt is already the default â€” no changes needed
docker-compose up -d
```

The gateway is available at `http://localhost:3000`. Wait ~30 s for all containers to become healthy:

```bash
docker-compose ps   # all services should show "healthy"
```

---

## Auth Providers

APICenter ships **two production auth providers** plus a local/CI issuer. Select one with `AUTH_PROVIDER`.

| Value | Use case | External dependency |
|-------|----------|---------------------|
| `dev-jwt` | Local dev, CI | None |
| `descope` | Enterprise OIDC with Descope tenant | Descope project |
| `keycloak` | Enterprise SSO, on-prem / cloud Keycloak | Keycloak server |

---

### 1. dev-jwt â€” Local Dev & CI (default)

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
| 4 | Ephemeral in-memory (default) | â€” tokens lost on restart |

**Generate a stable local key pair:**
```bash
openssl genrsa 2048 > private.pem
openssl rsa -in private.pem -pubout > public.pem

# Inline into .env (escaping newlines):
JWT_PRIVATE_KEY="$(awk 'NF{printf "%s\\n",$0}' private.pem)"
JWT_PUBLIC_KEY="$(awk 'NF{printf "%s\\n",$0}' public.pem)"
```

**JWKS endpoint (dev-jwt only):**
```
GET http://localhost:3000/api/v1/auth/.well-known/jwks.json
```

---

### 2. Descope â€” Enterprise OIDC

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

Per-service secret override follows the same pattern used in Keycloak:

```bash
DESCOPE_CLIENT_SECRET_PAYMENT_SERVICE=<service-secret>
```

### 3. Keycloak â€” Enterprise OIDC

#### Option A â€” Local Keycloak (dev / CI)

```bash
docker-compose --profile keycloak up -d
```

Add to `.env`:
```bash
AUTH_PROVIDER=keycloak
KEYCLOAK_BASE_URL=http://localhost:8080
KEYCLOAK_REALM=api-center
KEYCLOAK_DEFAULT_CLIENT_SECRET=dev-secret
```

The `keycloak` profile auto-imports `keycloak/realm-api-center.json`, which creates the `api-center` client with secret `dev-secret`.

#### Option B â€” Org / Production Keycloak

```bash
AUTH_PROVIDER=keycloak
KEYCLOAK_BASE_URL=https://<your-keycloak-host>
KEYCLOAK_REALM=<your-realm>
KEYCLOAK_JWKS_URI=https://<your-keycloak-host>/realms/<realm>/protocol/openid-connect/certs
KEYCLOAK_ISSUER=https://<your-keycloak-host>/realms/<realm>
KEYCLOAK_AUDIENCE=api-center
KEYCLOAK_DEFAULT_CLIENT_SECRET=<client-secret>
```

#### Creating a tribe client in Keycloak Admin UI

1. Log in â†’ select your realm â†’ **Clients â†’ Create client**
2. Client type: **OpenID Connect**, Client ID: `<service-id>` (e.g. `payment-service`)
3. Enable **Client authentication** â†’ Save
4. **Credentials** tab â†’ copy the secret
5. Set in `.env`: `KEYCLOAK_CLIENT_SECRET_PAYMENT_SERVICE=<secret>`

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

# Set in .env:
TRIBE_SECRET_PAYMENT_SERVICE=<sha256-hash>
```

---

## SDK Usage

Every tribe **must** use the shared SDK. Direct HTTP to the gateway is not permitted.

SDK source of truth now lives in the dedicated `api-shared-services` repository. The gateway repository is runtime-only and no longer publishes SDK artifacts.

Tribe repositories must install this SDK from the private registry. Configure `.npmrc` in each tribe repo before installing:

```ini
@implementsprint:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
always-auth=true
```

Reference template:

- `../api-shared-services/.npmrc.example`

```bash
npm install @implementsprint/sdk
```

```typescript
import { TribeClient } from '@implementsprint/sdk';

const client = new TribeClient({
  gatewayUrl: process.env.APICENTER_URL,   // http://localhost:3000 (dev)
  tribeId:    'my-service',
  secret:     process.env.MY_SERVICE_SECRET,
});

await client.authenticate();   // auto-refreshes before expiry

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
const tenantTopic = TribeClient.buildTenantTopic('orders-service', 'events');
await client.kafkaPublish({
  topic: tenantTopic,
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

## Shared Geo and Governed Kafka

Provider API credentials live in platform-owned shared services; tribe services never hold them.

Geo is not exposed through `/api/v1/external/*`. It is a platform-owned shared
service registered as `geo`, and tribes call it through `/api/v1/shared/geo/*`.

Kafka is not exposed through `/api/v1/external/*`. Tribe event publishing goes through governed SDK helpers and the API Center producer connection to Confluent Cloud.

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
  tribeId: 'orders-service',
  secret: process.env.ORDERS_SERVICE_SECRET,
});

await client.authenticate();

const governance = await client.kafkaGetGovernanceCatalog();
const topic = TribeClient.buildTenantTopic('orders-service', 'events');
await client.kafkaPublish({
  topic,
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

- Governed Kafka publish calls only accept topics that start with
  `tribe.<tribeId>.` for the authenticated tribe.

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

