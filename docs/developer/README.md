# APICenter â€” Developer Guide

This guide is for contributors and platform operators who need to run, test, and deploy APICenter. For the full platform setup, provider-secret checklist, and shared-service deployment model see [../apicenter-platform-setup.md](../apicenter-platform-setup.md). For integration and SDK documentation see the [root README](../../README.md).

For future Descope human/admin auth usage, see
[descope-human-auth-reference.md](./descope-human-auth-reference.md).

---

## Table of Contents

1. [Local Development](#local-development)
2. [Infrastructure Ports](#infrastructure-ports)
3. [Horizontal Scaling](#horizontal-scaling)
4. [Testing All Functionality](#testing-all-functionality)
   - [Health & Readiness](#health--readiness)
   - [dev-jwt Auth Flow](#dev-jwt-auth-flow)
  - [Internal Tribe Token Flow](#internal-tribe-token-flow)
  - [Core Gateway Without Data Pipeline](#core-gateway-without-data-pipeline)
  - [Descope Validation Fallback](#descope-validation-fallback)
   - [Service Registry](#service-registry)
   - [Tribe-to-Tribe Calls](#tribe-to-tribe-calls)
   - [Shared Services](#shared-services)
   - [Shared Geo and Governed Kafka](#shared-geo-and-governed-kafka)
   - [Rate Limiting](#rate-limiting)
   - [Circuit Breaker](#circuit-breaker)
   - [Observability Stack](#observability-stack)
5. [Environment Variables Reference](#environment-variables-reference)
6. [Production Hardening Checklist](#production-hardening-checklist)
7. [Vault Init (first run, dev only)](#vault-init-first-run-dev-only)
8. [GCP Deployment â€” Cloud Run + Secret Manager + Cloud Build](#gcp-deployment--cloud-run--secret-manager--cloud-build)
   - [One-time GCP Project Setup](#one-time-setup)
   - [Required IAM Roles](#5-grant-required-iam-roles)
   - [Secret Creation and Rotation](#6-create-the-application-secret-in-secret-manager)
   - [Cloud Build Trigger](#cicd-flow-cloud-build)
   - [Cloud Run Deploy Steps](#manual-cloud-run-deploy)
   - [Environment Variables and Secrets](#environment-variable-setup)
9. [GKE Deployment with Horizontal Pod Autoscaling](#gke-deployment-with-horizontal-pod-autoscaling)
10. [Tribe Onboarding and Bootstrap Transition](#tribe-onboarding-and-bootstrap-transition)
11. [Shared Service Team Workflow](#shared-service-team-workflow)

---

## GKE Deployment with Horizontal Pod Autoscaling

For higher scale, VPC-private dependencies, or long-lived connections, deploy to **GKE Autopilot** instead of Cloud Run. Manifests live in [`infra/gcp/gke/`](../../infra/gcp/gke/) and include:

- Deployment + ConfigMap + ClusterIP Service
- HorizontalPodAutoscaler (2 to 3 pods, CPU 70% / mem 80%)
- PodDisruptionBudget `minAvailable: 1` for the current low-credit profile
- GKE Ingress + ManagedCertificate (Google-managed TLS)
- BackendConfig wiring GCLB health checks to `/api/v1/health/ready`
- Workload Identity binding so pods read GCP Secret Manager without keys
- `provision.sh` for one-time cluster + Memorystore + IP setup

**When to pick GKE over Cloud Run:**

| Need | Cloud Run | GKE |
| --- | --- | --- |
| â‰¤ ~10 instances, bursty traffic | âœ… simpler | overkill |
| > 10 instances or steady high QPS | maxScale ceiling | HPA, quota, and max replicas under operator control |
| Memorystore / VPC-only deps | needs Serverless VPC connector | âœ… native VPC |
| Long-lived connections (gRPC streaming, SSE) | limited | âœ… |
| Sub-second cold-start matters | cold starts | âœ… always-on min replicas |

See [`infra/gcp/gke/README.md`](../../infra/gcp/gke/README.md) for the full deploy walkthrough,
[`gke-cost-optimization-plan.md`](./gke-cost-optimization-plan.md) before changing
requests, HPA limits, or the PDB, and [`../production-costing.md`](../production-costing.md)
for the current production and maintenance cost model.
Use [`reliability-hardening-plan.md`](./reliability-hardening-plan.md) for the
implemented reliability phases, deploy smoke checks, and remaining Confluent
Secret Manager prerequisite.

---

## Tribe Onboarding and Bootstrap Transition

Use [tribe-onboarding.md](./tribe-onboarding.md) for the registration contract,
startup checklist, and migration plan from manifest bootstrap mode to real
tribe self-registration.

---

## Shared Service Team Workflow

Use [shared-service-team-workflow.md](./shared-service-team-workflow.md) for
cross-team ownership boundaries between AP Center, shared SDK delivery, and
shared service runtime implementation teams.

Shared contract snapshot and CI guard:

- [docs/contracts/shared-service-contract.json](../contracts/shared-service-contract.json)
- `npm run check:contracts`

---

## Local Development

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Docker Compose v2)
- Node.js 24 LTS (for running unit tests outside Docker)
- `jq` (optional, for pretty-printing JSON in the test examples below)

### First run

```bash
# Clone and install
npm install

# Copy env
cp .env.example .env

# Start the local sandbox (NGINX + 3 API containers + Redis + Vault + observability).
# Configure Confluent Cloud Kafka settings in .env before using readiness/publish checks.
docker compose -f deploy/local/docker-compose.yml up -d

# Watch container health (~30â€“60 s for all to become healthy)
watch docker compose -f deploy/local/docker-compose.yml ps
```

### Unit tests (outside Docker)

```bash
npm test              # all unit tests
npm run test:watch    # watch mode
npm run test:cov      # with coverage
npm run test:e2e      # end-to-end tests
```

### Lint and build

```bash
npm run lint          # ESLint
npm run typecheck     # tsc --noEmit
npm run build         # compile to dist/
```

### Hot-reload development server

```bash
npm run dev           # nest start --watch (connects to docker-compose infra)
```

---

## Infrastructure Ports

| Service | Port | URL | Purpose |
|---------|------|-----|---------|
| **NGINX** | **3000** | `http://localhost:3000` | **Consumer entrypoint â€” use this** |
| Vault UI | 8200 | `http://localhost:8200/ui` | Secrets (Token: `root`) |
| Prometheus | 9090 | `http://localhost:9090` | Metrics |
| Grafana | 3001 | `http://localhost:3001` | Dashboards (admin / admin) |
| Jaeger | 16686 | `http://localhost:16686` | Distributed tracing |

---

## Horizontal Scaling

Two edits to add a 4th container:

**`deploy/local/docker-compose.yml`** â€” copy the `api-center-3` block:
```yaml
api-center-4:
  <<: *api-center-common
  container_name: api-center-4
```

**`nginx.conf`** â€” add one line to the upstream block:
```nginx
server api-center-4:3000 max_fails=3 fail_timeout=20s;
```

Apply:
```bash
docker compose -f deploy/local/docker-compose.yml up -d api-center-4 && docker compose -f deploy/local/docker-compose.yml restart nginx
```

---

## Testing All Functionality

### Prerequisites

```bash
# jq for pretty JSON (optional but recommended)
brew install jq          # macOS
apt-get install jq       # Ubuntu/Debian

# Start the full stack
cp .env.example .env
docker compose -f deploy/local/docker-compose.yml up -d

# Wait for all services to become healthy (~30â€“60 s)
watch docker compose -f deploy/local/docker-compose.yml ps
```

---

### Health & Readiness

```bash
# Liveness â€” is the process running?
curl -s http://localhost:3000/api/v1/health/live | jq .
# â†’ { "status": "ok" }

# Readiness â€” can the process serve traffic? (checks Redis, Kafka)
curl -s http://localhost:3000/api/v1/health/ready | jq .
# Kafka readiness is currently always enforced; configure Confluent before using /ready.
# â†’ { "status": "ok", "details": { ... } }

# NGINX health (bypasses NestJS entirely)
curl -s http://localhost:3000/nginx-health
# â†’ healthy
```

---

### dev-jwt Auth Flow

```bash
# 1. Register a test service
curl -s -X POST http://localhost:3000/api/v1/registry/register \
  -H "Content-Type: application/json" \
  -d '{
    "serviceId": "test-service",
    "name": "Test Service",
    "baseUrl": "http://test-service:9999",
    "requiredScopes": ["test:read"],
    "exposes": ["test:read"],
    "consumes": [],
    "healthCheck": "/health",
    "version": "1.0.0"
  }' | jq .

# 2. Create api-center-tribe-secret-test-service-test in Secret Manager.
#    Its JSON payload must include tribeId, environment, secretHashSha256, and status.

# 3. Issue a token
RESPONSE=$(curl -s -X POST http://localhost:3000/api/v1/auth/token \
  -H "Content-Type: application/json" \
  -d '{"tribeId": "test-service", "secret": "test-secret", "environment": "test"}')
echo $RESPONSE | jq .

export ACCESS_TOKEN=$(echo $RESPONSE | jq -r '.data.accessToken')
export REFRESH_TOKEN=$(echo $RESPONSE | jq -r '.data.refreshToken')

# 4. Inspect the JWKS (available with dev-jwt, internal-jwt, and composite)
curl -s http://localhost:3000/api/v1/auth/.well-known/jwks.json | jq .

# 5. Refresh the token
curl -s -X POST http://localhost:3000/api/v1/auth/token/refresh \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\": \"$REFRESH_TOKEN\"}" | jq .

# 6. Revoke the refresh token (requires valid access token)
curl -s -o /dev/null -w "%{http_code}" \
  -X POST http://localhost:3000/api/v1/auth/token/revoke \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d "{\"refreshToken\": \"$REFRESH_TOKEN\"}"
# â†’ 204

# 7. Revoke all tokens for a subject
curl -s -o /dev/null -w "%{http_code}" \
  -X POST http://localhost:3000/api/v1/auth/token/revoke \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d "{\"refreshToken\": \"$REFRESH_TOKEN\", \"revokeAll\": true}"
# â†’ 204
```

---

### Internal Tribe Token Flow

```bash
# Configure API Center internal M2M tokens and restart gateway containers.
# Use composite in production if Descope token validation fallback is still needed.
export AUTH_PROVIDER=composite
export INTERNAL_JWT_ISSUER=https://api-center.itsandbox.site
export INTERNAL_JWT_AUDIENCE=api-center
export INTERNAL_JWT_ACCESS_TTL_SECONDS=3600
export INTERNAL_JWT_REFRESH_TTL_SECONDS=86400
export JWT_PRIVATE_KEY="<persistent-rs256-private-key-pem>"
export JWT_PUBLIC_KEY="<persistent-rs256-public-key-pem>"
docker compose -f deploy/local/docker-compose.yml up -d api-center-1 api-center-2 api-center-3

# Issue an APICenter token through gateway auth endpoint
curl -s -X POST http://localhost:3000/api/v1/auth/token \
  -H "Content-Type: application/json" \
  -d '{"tribeId": "api-center", "secret": "<service-secret>"}' | jq .
```

API Center validates the plaintext service secret against
`api-center-tribe-secret-<tribe-id>` in GCP Secret Manager, or a legacy
`TRIBE_SECRET_<SERVICE_ID_UPPER>` env hash during migration, and signs an
internal JWT with registry-derived `tribeId`, `permissions`, and `scopes`. New
tribes do not need a Descope app for machine-to-machine access.

### Core Gateway Without Data Pipeline

APICenter can run without Confluent Cloud, AWS S3, Athena, or raw-data exports.
Set `DATA_PIPELINE_ENABLED=false` and `KAFKA_ENABLED=false`.

This does not disable tribe authentication. Tribe services still request tokens
from `/api/v1/auth/token` with `tribeId` and plaintext `secret`. APICenter hashes
the plaintext, compares it to the configured tribe secret hash, issues an
internal JWT, and validates that JWT on proxied calls.

Do not store plaintext tribe secrets in committed files.

### Descope Validation Fallback

`AUTH_PROVIDER=composite` still validates Descope-issued tokens after internal
JWT validation fails. Keep `DESCOPE_PROJECT_ID`, `DESCOPE_ISSUER`,
`DESCOPE_AUDIENCE`, and `DESCOPE_JWKS_URI` configured if human/admin auth still
uses Descope. Per-tribe `DESCOPE_CLIENT_SECRET_<SERVICE_ID>` keys are only
needed if you intentionally switch back to `AUTH_PROVIDER=descope`.

---

### Google-backed shared services

Google OAuth and Google API integrations are implemented in `api-shared-services` and are reached through API Center as registered shared services. Use the setup runbook in `docs/apicenter-platform-setup.md` and SDK wrappers for `gauth` and `geo` instead of API Center `/auth/google` routes.

---

### Service Registry

```bash
# List all registered services
curl -s http://localhost:3000/api/v1/registry/services | jq .

# Get a specific service
curl -s http://localhost:3000/api/v1/registry/services/payment-service | jq .

# Register from an example manifest file
curl -s -X POST http://localhost:3000/api/v1/registry/register \
  -H "Content-Type: application/json" \
  -d @../api-shared-services/shared-services/manifests/payment-manifest.json | jq .

# Deprecate a service (requires platform admin secret)
curl -s -X PATCH \
  http://localhost:3000/api/v1/registry/services/payment-service/deprecate \
  -H "Content-Type: application/json" \
  -H "X-Platform-Admin-Secret: change-me-in-production" \
  -d '{"reason": "Replaced by payments-v2", "sunsetDate": "2025-12-31"}' | jq .

# Deregister a service
curl -s -X DELETE \
  http://localhost:3000/api/v1/registry/services/payment-service \
  -H "X-Platform-Admin-Secret: change-me-in-production" | jq .
```

---

### Tribe-to-Tribe Calls

```bash
# Prerequisites: both services registered; caller has a valid token

# GET through the gateway to a tribe service
curl -s "http://localhost:3000/api/v1/tribes/user-service/users/123" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq .

# POST to a tribe service
curl -s -X POST "http://localhost:3000/api/v1/tribes/payment-service/payments" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amount": 100, "currency": "USD"}' | jq .

# Verify the X-Correlation-ID header is injected
curl -sv "http://localhost:3000/api/v1/tribes/user-service/health" \
  -H "Authorization: Bearer $ACCESS_TOKEN" 2>&1 | grep -i "x-correlation"

# Supply your own correlation ID (traces the full request chain)
curl -s "http://localhost:3000/api/v1/tribes/user-service/users" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "X-Correlation-ID: my-trace-id-abc123" | jq .
```

---

### Shared Services

```bash
# Register a shared service (email, SMS, payments platform, etc.)
curl -s -X POST http://localhost:3000/api/v1/registry/register \
  -H "Content-Type: application/json" \
  -d @../api-shared-services/shared-services/manifests/email-manifest.json | jq .

# Call a shared service
curl -s -X POST "http://localhost:3000/api/v1/shared/email/send" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"to": "user@example.com", "template": "welcome"}' | jq .

# SMS shared service
curl -s -X POST "http://localhost:3000/api/v1/shared/sms/send" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"to": "+1234567890", "message": "Your code is 123456"}' | jq .
```

---

### Shared Geo and Governed Kafka

```bash
# List configured legacy external APIs for the current caller token.
# Current provider-backed APIs should be exposed as shared services.
curl -s http://localhost:3000/api/v1/external \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq .

# Shared geo lookup through API Center
curl -s -X POST "http://localhost:3000/api/v1/shared/geo/reverse-geocode" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"latitude":14.5995,"longitude":120.9842}' | jq .

# The API key is injected server-side â€” never exposed to the caller

# Kafka event publishing uses APICenter's governed Kafka routes and
# the server-side Confluent Cloud producer configuration.
```

---

### Rate Limiting

Default: **100 requests per 60 seconds** per service. Both limits are configurable.

```bash
# Hammer the health endpoint to trigger rate limiting
for i in $(seq 1 115); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    http://localhost:3000/api/v1/health/live)
  echo "Request $i: HTTP $STATUS"
  [ "$STATUS" = "429" ] && echo "  ^^^ Rate limited â€” Retry-After header present" && break
done

# Inspect rate limit headers
curl -sv http://localhost:3000/api/v1/health/live \
  -H "Authorization: Bearer $ACCESS_TOKEN" 2>&1 \
  | grep -i "x-ratelimit\|retry-after"
```

Change limits in `.env`:
```bash
RATE_LIMIT_WINDOW_MS=60000   # 60 second window
RATE_LIMIT_MAX=100           # max requests per window per service
```

---

### Circuit Breaker

```bash
# Register a service pointing to a non-existent host
curl -s -X POST http://localhost:3000/api/v1/registry/register \
  -H "Content-Type: application/json" \
  -d '{
    "serviceId": "broken-service",
    "name": "Broken Service",
    "baseUrl": "http://does-not-exist:9999",
    "requiredScopes": [],
    "exposes": [],
    "consumes": [],
    "healthCheck": "/health",
    "version": "1.0.0"
  }' | jq .

# First calls return 504 (upstream timeout)
for i in 1 2 3 4 5 6; do
  echo -n "Request $i: "
  curl -s -o /dev/null -w "HTTP %{http_code}\n" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    "http://localhost:3000/api/v1/tribes/broken-service/anything"
done

# After the threshold: 503 with circuit breaker open message
curl -s "http://localhost:3000/api/v1/tribes/broken-service/anything" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq .
# â†’ { "statusCode": 503, "message": "Circuit breaker open for broken-service" }
```

---

### Observability Stack

#### Prometheus metrics

```bash
# Raw metrics scrape (all request counters, durations, active connections)
curl -s http://localhost:3000/metrics | grep api_center

# Open Prometheus expression browser
open http://localhost:9090

# Useful queries:
# api_center_requests_total
# rate(api_center_requests_total[1m])
# api_center_request_duration_seconds_bucket
# api_center_active_requests
```

#### Management JSON analytics

API Center also exposes protected JSON analytics for the local management
console. These endpoints are not public user APIs; call them with a platform
admin secret or a JWT that has `platform:admin`.

```bash
curl -s "http://localhost:3000/api/v1/analytics/shared-service-usage?window=24h" \
  -H "X-Platform-Secret: $PLATFORM_ADMIN_SECRET" | jq .

curl -s "http://localhost:3000/api/v1/analytics/gateway-traffic?window=24h" \
  -H "X-Platform-Secret: $PLATFORM_ADMIN_SECRET" | jq .

curl -s "http://localhost:3000/api/v1/analytics/provider-usage?window=24h" \
  -H "X-Platform-Secret: $PLATFORM_ADMIN_SECRET" | jq .

curl -s "http://localhost:3000/api/v1/analytics/alerts?window=1h" \
  -H "X-Platform-Secret: $PLATFORM_ADMIN_SECRET" | jq .

curl -s "http://localhost:3000/api/v1/analytics/audit/events?limit=100" \
  -H "X-Platform-Secret: $PLATFORM_ADMIN_SECRET" | jq .
```

`shared-service-usage` is backed by hourly Redis buckets with an in-memory
fallback for local/dev. It records completed `/api/v1/shared/:serviceId/*`
proxy responses and returns per-tribe/per-shared-service totals, failures,
error rate, average latency, and last-used timestamp for `1h`, `24h`, `7d`,
or `30d` windows.

`gateway-traffic` uses the same bounded bucket model for proxy volume, 4xx/5xx
responses, Kafka publish failures, readiness failures, and latency signals.
`provider-usage` groups shared-service runtime calls by provider-facing shared
service for the management cost view. `alerts` derives read-only operational
alerts from runtime counters and registry metadata. `audit/events` keeps a
bounded recent-event list for registry lifecycle actions, proxied calls, Kafka
publish failures, and readiness failures.

#### Grafana dashboards

```bash
open http://localhost:3001   # admin / admin
```

1. **Configuration â†’ Data Sources â†’ Add data source**
   - Type: Prometheus, URL: `http://prometheus:9090` â†’ Save & Test
2. **+ â†’ Import** â†’ enter dashboard ID `1860` (Node.js metrics) â†’ Import
3. Or create a custom dashboard using the `api_center_*` metrics

#### Distributed tracing (Jaeger)

```bash
# Make some varied requests first
for path in health/live health/ready registry/services; do
  curl -s "http://localhost:3000/api/v1/$path" \
    -H "Authorization: Bearer $ACCESS_TOKEN" > /dev/null
done

open http://localhost:16686
# Service â†’ api-center â†’ Find Traces
# Click any trace to see the full request waterfall
```

#### Kafka audit trail

```bash
# Production audit records go to Confluent Cloud.
# Use the Confluent Cloud console or CLI to inspect topics.

# Key topics to inspect:
# api-center.audit.log            â€” every proxied request
# api-center.auth.token-issued    â€” M2M token issued
# api-center.auth.token-refreshed â€” token refreshed
# api-center.auth.token-revoked   â€” token revoked
# api-center.registry.registered  â€” service registered
# api-center.gateway.circuit-open â€” circuit breaker opened
```

#### Vault secrets browser

```bash
open http://localhost:8200/ui   # Token: root

# Or via CLI inside the container:
docker exec vault vault kv list secret/api-center
docker exec vault vault kv get secret/api-center/dev
```

---

## Environment Variables Reference

See [`.env.example`](../../.env.example) for the annotated full list. Key variables are summarised below.

### Core

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | NestJS listener port (inside container) |
| `NODE_ENV` | `development` | `development` or `production` |
| `ALLOWED_ORIGINS` | `*` | CORS origins â€” comma-separated or `*` |
| `PLATFORM_ADMIN_SECRET` | `change-me-in-production` | Required for admin endpoints |

### Auth provider selection

| Variable | Default | Values |
|----------|---------|--------|

Production tribe-token mode should use `composite` first, then optionally
`internal-jwt` after Descope validation fallback is no longer needed. Supported
provider values are `dev-jwt`, `internal-jwt`, `composite`, and `descope`.

### dev-jwt

| Variable | Default | Description |
|----------|---------|-------------|
| `DEV_JWT_ISSUER` | `api-center-dev` | JWT `iss` claim |
| `DEV_JWT_TTL_SECONDS` | `3600` | Access token TTL (seconds) |
| `DEV_JWT_REFRESH_TTL_MULTIPLIER` | `24` | Refresh TTL = access TTL Ã— this |
| `JWT_PRIVATE_KEY` | â€” | PEM private key (optional, for persistence) |
| `JWT_PUBLIC_KEY` | â€” | PEM public key (required when `JWT_PRIVATE_KEY` is set) |

### internal-jwt / composite

| Variable | Default | Description |
|----------|---------|-------------|
| `INTERNAL_JWT_ISSUER` | `api-center` | JWT `iss` claim for API Center-issued tribe tokens |
| `INTERNAL_JWT_AUDIENCE` | `api-center` | JWT `aud` claim for API Center-issued tribe tokens |
| `INTERNAL_JWT_ACCESS_TTL_SECONDS` | `3600` | Access token TTL |
| `INTERNAL_JWT_REFRESH_TTL_SECONDS` | `86400` | Refresh token TTL |
| `JWT_PRIVATE_KEY` | — | Persistent RS256 private key, required in production |
| `JWT_PUBLIC_KEY` | — | Matching RS256 public key, required in production |

### Descope

| Variable | Default | Description |
|----------|---------|-------------|
| `DESCOPE_BASE_URL` | `https://api.descope.com` | Descope API base URL |
| `DESCOPE_PROJECT_ID` | â€” | Descope project ID |
| `DESCOPE_JWKS_URI` | `<base>/<projectId>/.well-known/jwks.json` | JWKS endpoint override |
| `DESCOPE_TOKEN_ENDPOINT` | `<base>/oauth2/v1/token` | OAuth token endpoint |
| `DESCOPE_ISSUER` | â€” | Expected `iss` claim (required in production) |
| `DESCOPE_AUDIENCE` | â€” | Expected `aud` claim (required in production) |
| `DESCOPE_REFRESH_CLIENT_ID` | `api-center` | Client ID for refresh-token grants |
| `DESCOPE_DEFAULT_CLIENT_SECRET` | â€” | Default M2M client secret |
| `DESCOPE_CLIENT_SECRET_<SERVICE_ID_UPPER>` | â€” | Per-service Descope client secret override |

In `AUTH_PROVIDER=composite`, Descope settings are used for validation fallback
only. New tribe M2M tokens are issued by API Center and do not need
`DESCOPE_DEFAULT_CLIENT_SECRET` or per-service Descope client secrets.

### GCP Secret Manager

| Variable | Default | Description |
|----------|---------|-------------|
| `GCP_SECRET_NAME` | â€” | Secret name in GCP Secret Manager (leave unset for local dev) |
| `GCP_PROJECT_ID` | â€” | GCP project that owns the secret (falls back to `GOOGLE_CLOUD_PROJECT`) |
| `GCP_SECRET_VERSION` | `latest` | Secret version to fetch |

### Infrastructure

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_CACHE_URL` | `redis://localhost:6381` | Registry + token store |
| `REDIS_RATE_LIMIT_URL` | `redis://localhost:6380` | Rate-limit counters |
| `REDIS_TOKEN_TTL_SECONDS` | `3600` | Token TTL in Redis |
| `DATA_PIPELINE_ENABLED` | `false` | Enables governed Kafka/S3/Athena raw export when set to `true` |
| `KAFKA_ENABLED` | `false` | Enables Kafka client startup; also enabled automatically when `DATA_PIPELINE_ENABLED=true` |
| `KAFKA_BROKERS` | `<confluent-bootstrap-server>:9092` | Required only when Kafka/data pipeline is enabled |
| `KAFKA_SSL_ENABLED` | `true` | Required for Confluent Cloud when Kafka/data pipeline is enabled |
| `KAFKA_SASL_MECHANISM` | `plain` | Required for Confluent Cloud API keys when Kafka/data pipeline is enabled |
| `KAFKA_SASL_USERNAME` / `KAFKA_SASL_PASSWORD` | unset | Confluent API key/secret from Secret Manager when Kafka/data pipeline is enabled |
| `VAULT_ADDR` | `http://localhost:8200` | Vault server |
| `VAULT_TOKEN` | â€” | Root/dev token (dev only) |
| `VAULT_ROLE_ID` / `VAULT_SECRET_ID` | â€” | AppRole credentials (production) |
| `VAULT_DEV_MODE` | `true` | Set `false` in production |
| `JAEGER_ENDPOINT` | `http://localhost:14268/api/traces` | Jaeger HTTP collector |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Window in milliseconds |
| `RATE_LIMIT_MAX` | `100` | Max requests per window per service |

### Optional Postgres control plane

Keep these disabled until Supabase migrations have been applied and
Redis/Postgres parity checks pass.

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_ENABLED` | `false` | Enables API Center Postgres connectivity |
| `DATABASE_URL` | unset | Runtime DB URL for API Center control-plane schemas |
| `DATABASE_PROVIDER` | unset | Set to `supabase` when using Supabase Postgres |
| `REGISTRY_SOURCE` | `redis` | Active registry read source: `redis` or `postgres` |
| `REGISTRY_DUAL_WRITE` | `false` | Enables Redis + Postgres write migration mode |

Shared-service business schemas use `SHARED_SERVICES_DATABASE_URL` in the
`api-shared-services` repo and secret payload. Do not put shared-service DB
credentials in `api-center-prod`.

### Per-service tribe secrets

```text
Secret name: api-center-tribe-secret-<tribe-id>
```

```json
{
  "serviceId": "payment-service",
  "secretHashSha256": "<sha256-hash-of-plaintext-secret>",
  "status": "active",
  "rotatedAt": "2026-05-14T00:00:00.000Z"
}
```

Create `api-center-tribe-secret-payment-service-test` and
`api-center-tribe-secret-payment-service-live` for scoped test/live token
requests.

### Governed Kafka

Required only when `DATA_PIPELINE_ENABLED=true` or `KAFKA_ENABLED=true`.

```bash
KAFKA_BROKERS=<confluent-bootstrap-server>:9092
KAFKA_SSL_ENABLED=true
KAFKA_SASL_MECHANISM=plain
KAFKA_SASL_USERNAME=<confluent-api-key>
KAFKA_SASL_PASSWORD=<confluent-api-secret>
```

---

## Production Hardening Checklist

- [ ] `NODE_ENV=production`
- [ ] `PLATFORM_ADMIN_SECRET` â€” generate with `openssl rand -hex 32`
- [ ] `ALLOWED_ORIGINS` â€” explicit whitelist, **not** `*`
- [ ] **Vault**: `VAULT_DEV_MODE=false`, AppRole credentials (`VAULT_ROLE_ID` + `VAULT_SECRET_ID`)
- [ ] **Redis**: sentinel or cluster URLs with TLS (`rediss://`)
- [ ] **Kafka/data pipeline**: if `DATA_PIPELINE_ENABLED=true`, Confluent Cloud bootstrap in Secret Manager, SASL/SSL enabled, no self-managed broker address in production env
- [ ] **Descope**: set `DESCOPE_ISSUER` and `DESCOPE_AUDIENCE`
- [ ] TLS terminated at NGINX or upstream ingress â€” **never** expose port 3000 directly
- [ ] Rotate per-tribe `api-center-tribe-secret-<tribe-id>` secrets regularly
- [ ] Change Grafana default password (`GF_SECURITY_ADMIN_PASSWORD`)
- [ ] Restrict Vault UI, Kafka UI, and Prometheus to internal networks only
- [ ] `ENVOY_TRUST_HEADERS=false` unless behind a verified Envoy sidecar

---

## Vault Init (first run, dev only)

```bash
npm run vault:init
```

Enables the KV v2 and Transit secrets engines and creates a signing key.

---

## GCP Deployment â€” Cloud Run + Secret Manager + Cloud Build

This section covers a complete, production-ready deployment of APICenter on Google Cloud Platform using **Cloud Run** (serverless containers), **Secret Manager** (runtime secrets), and **Cloud Build** (CI/CD). All steps below assume you have the [Google Cloud SDK (`gcloud`)](https://cloud.google.com/sdk/docs/install) installed and authenticated.

---

### One-time Setup

#### 1. Create (or select) a GCP project

```bash
# Create a new project
gcloud projects create MY_PROJECT_ID --name="APICenter"
gcloud config set project MY_PROJECT_ID

# Enable billing (required for Cloud Run, Artifact Registry, etc.)
# https://console.cloud.google.com/billing
```

#### 2. Enable required APIs

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com \
  iam.googleapis.com
```

#### 3. Create an Artifact Registry repository

```bash
gcloud artifacts repositories create api-center \
  --repository-format=docker \
  --location=us-central1 \
  --description="APICenter container images"
```

#### 4. Create a dedicated Cloud Run service account

```bash
gcloud iam service-accounts create api-center-cloudrun \
  --display-name="APICenter Cloud Run SA"

export SA_EMAIL="api-center-cloudrun@MY_PROJECT_ID.iam.gserviceaccount.com"
```

#### 5. Grant required IAM roles

| Role | Purpose |
|------|---------|
| `roles/secretmanager.secretAccessor` | Read secrets at runtime |
| `roles/run.invoker` | Allow authenticated callers (if not public) |

```bash
# Allow the Cloud Run SA to read secrets
gcloud projects add-iam-policy-binding MY_PROJECT_ID \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/secretmanager.secretAccessor"

# Grant the Cloud Build SA permission to deploy to Cloud Run and act as the Cloud Run SA
export BUILD_SA="$(gcloud projects describe MY_PROJECT_ID \
  --format='value(projectNumber)')@cloudbuild.gserviceaccount.com"

gcloud projects add-iam-policy-binding MY_PROJECT_ID \
  --member="serviceAccount:${BUILD_SA}" \
  --role="roles/run.admin"

gcloud iam service-accounts add-iam-policy-binding "${SA_EMAIL}" \
  --member="serviceAccount:${BUILD_SA}" \
  --role="roles/iam.serviceAccountUser"

gcloud projects add-iam-policy-binding MY_PROJECT_ID \
  --member="serviceAccount:${BUILD_SA}" \
  --role="roles/artifactregistry.writer"
```

#### 6. Create the application secret in Secret Manager

The secret must be a JSON object whose keys map to environment variable names.

```bash
# Create the secret (initially empty)
gcloud secrets create api-center-prod \
  --replication-policy=automatic

# Add the first version â€” create a JSON file with your env vars:
cat > /tmp/api-center-secrets.json <<'EOF'
{
  "PLATFORM_ADMIN_SECRET": "change-me-generate-with-openssl-rand-hex-32",
  "JWT_PRIVATE_KEY": "-----BEGIN RSA PRIVATE KEY-----\n...",
  "JWT_PUBLIC_KEY": "-----BEGIN PUBLIC KEY-----\n...",
  "REDIS_CACHE_URL": "redis://10.x.x.x:6379",
  "REDIS_RATE_LIMIT_URL": "redis://10.x.x.x:6380",
  "DATA_PIPELINE_ENABLED": "false",
  "KAFKA_ENABLED": "false",
  "TRIBE_SECRET_SOURCE": "gcp-secret-manager",
  "TRIBE_SECRET_GCP_PREFIX": "api-center-tribe-secret-",
  "TRIBE_SECRET_CACHE_TTL_SECONDS": "300"
}
EOF

gcloud secrets versions add api-center-prod \
  --data-file=/tmp/api-center-secrets.json

# Remove the temp file immediately
rm /tmp/api-center-secrets.json
```

> **Note:** Any key present in the JSON secret will be merged into `process.env` at startup. Keys already set as Cloud Run env vars take precedence (they are not overridden).

#### 7. Grant the Cloud Run SA access to the specific secret

```bash
gcloud secrets add-iam-policy-binding api-center-prod \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/secretmanager.secretAccessor"
```

---

### CI/CD Flow (Cloud Build)

The `infra/gcp/cloud-build/cloudbuild.yaml` at the repository root defines the pipeline:

1. **`test`** â€” Install deps, lint, run unit tests
2. **`build`** â€” Build the Docker image from `docker/Dockerfile.gcp`
3. **`push`** â€” Push the image to Artifact Registry (tagged with `SHORT_SHA` and `latest`)
4. **`deploy`** â€” Deploy the new image to Cloud Run

#### Create a Cloud Build trigger

```bash
# Via gcloud (adjust --repo-name and --branch-pattern as needed)
gcloud builds triggers create github \
  --repo-name=API_Center \
  --repo-owner=YOUR_GITHUB_ORG \
  --branch-pattern="^main$" \
  --build-config=infra/gcp/cloud-build/cloudbuild.yaml \
  --substitutions=\
_REGION=us-central1,\
_SERVICE_NAME=api-center,\
_GCP_PROJECT_ID=MY_PROJECT_ID,\
_IMAGE_REPO=us-central1-docker.pkg.dev/MY_PROJECT_ID/api-center
```

Or configure the trigger in [Cloud Build â†’ Triggers](https://console.cloud.google.com/cloud-build/triggers) in the console, setting the same substitutions.

---

### Manual Cloud Run Deploy

To deploy without Cloud Build (e.g. from your local machine):

```bash
# Authenticate Docker with Artifact Registry
gcloud auth configure-docker us-central1-docker.pkg.dev

# Build and push
docker build -f docker/Dockerfile.gcp \
  -t us-central1-docker.pkg.dev/MY_PROJECT_ID/api-center/api-center:latest .
docker push us-central1-docker.pkg.dev/MY_PROJECT_ID/api-center/api-center:latest

# Deploy
gcloud run deploy api-center \
  --image=us-central1-docker.pkg.dev/MY_PROJECT_ID/api-center/api-center:latest \
  --region=us-central1 \
  --platform=managed \
  --service-account="${SA_EMAIL}" \
  --set-env-vars=NODE_ENV=production \
  --set-env-vars=GCP_PROJECT_ID=MY_PROJECT_ID \
  --set-env-vars=GCP_SECRET_NAME=api-center-prod \
  --allow-unauthenticated
```

Or use the declarative YAML definition:

```bash
# Fill in placeholders in infra/gcp/cloud-run/cloudrun.yaml first, then:
gcloud run services replace infra/gcp/cloud-run/cloudrun.yaml --region=us-central1
```

---

### Environment Variable Setup

Set non-sensitive env vars directly on the Cloud Run service. Sensitive values go into Secret Manager (see above).

| Variable | Where to set |
|----------|-------------|
| `NODE_ENV=production` | Cloud Run env var |
| `GCP_PROJECT_ID` | Cloud Run env var |
| `GCP_SECRET_NAME` | Cloud Run env var |
| `AUTH_PROVIDER` | Cloud Run env var |
| `PLATFORM_ADMIN_SECRET` | Secret Manager JSON |
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` | Secret Manager JSON |
| `REDIS_CACHE_URL` | Secret Manager JSON |
| `DATA_PIPELINE_ENABLED` / `KAFKA_ENABLED` | Cloud Run env var or Secret Manager JSON |
| `KAFKA_BROKERS` | Secret Manager JSON, only when data pipeline is enabled |
| `KAFKA_SASL_USERNAME` / `KAFKA_SASL_PASSWORD` | Secret Manager JSON, only when data pipeline is enabled |
| `TRIBE_SECRET_SOURCE` / `TRIBE_SECRET_GCP_PREFIX` / `TRIBE_SECRET_CACHE_TTL_SECONDS` | Secret Manager JSON or env var |

### Adding Per-Service Secrets

To add or update a tribe secret without modifying `api-center-prod`, create or
rotate a separate Secret Manager secret. The old `api-center-prod` edit flow
below is a legacy rollback path only.

1. Download the current secret version:
   ```bash
   gcloud secrets versions access latest \
     --secret=api-center-prod > /tmp/current.json
   ```

2. Edit `/tmp/current.json` â€” add or update the `TRIBE_SECRET_<NAME>` key.

3. Push as a new version:
   ```bash
   gcloud secrets versions add api-center-prod \
     --data-file=/tmp/current.json
   rm /tmp/current.json
   ```

4. The next container startup (or redeployment) will pick up the new version automatically. To force a reload without a new image:
   ```bash
   gcloud run services update api-center \
     --region=us-central1 \
     --set-env-vars=_FORCE_REDEPLOY="$(date +%s)"
   ```

---

### Secret Rotation

1. Create a new version of the secret (the old version remains accessible until you disable/destroy it):
   ```bash
   gcloud secrets versions add api-center-prod \
     --data-file=/tmp/new-secrets.json
   ```

2. Redeploy or restart the Cloud Run service so containers pick up `latest`:
   ```bash
   gcloud run services update api-center \
     --region=us-central1 \
     --image=us-central1-docker.pkg.dev/MY_PROJECT_ID/api-center/api-center:latest
   ```

3. After confirming the new version works, disable the old version:
   ```bash
   gcloud secrets versions disable OLD_VERSION_NUMBER \
     --secret=api-center-prod
   ```

4. To pin a specific version instead of always using `latest`, set `GCP_SECRET_VERSION=<version_number>` as a Cloud Run env var.

---

### Local Dev Notes

- Do **not** set `GCP_SECRET_NAME` in your local `.env` â€” leave it blank to use `process.env` directly (populated from `.env` via dotenv).
- To test Secret Manager locally, set `GCP_SECRET_NAME`, `GCP_PROJECT_ID`, and authenticate with:
  ```bash
  gcloud auth application-default login
  ```
  The GCP client library picks up Application Default Credentials automatically.
- The `docker/Dockerfile.gcp` image exposes port `8080` (Cloud Run default). The root `Dockerfile` and `deploy/local/docker-compose.yml` still use port `3000` for local development â€” nothing changes for local dev.

---

### Required IAM Roles â€” Summary

| Principal | Role | Purpose |
|-----------|------|---------|
| Cloud Run SA | `roles/secretmanager.secretAccessor` | Read secrets at runtime |
| Cloud Build SA | `roles/run.admin` | Deploy Cloud Run services |
| Cloud Build SA | `roles/iam.serviceAccountUser` | Act as Cloud Run SA during deploy |
| Cloud Build SA | `roles/artifactregistry.writer` | Push Docker images |
