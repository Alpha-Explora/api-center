# APICenter - Centralized API Gateway

APICenter is the **single, centralized API gateway** and shared service platform. Tribe-to-tribe calls, shared platform services, auth, registry, and governed event publishing route through APICenter. No tribe calls another tribe or provider API directly.

> **Management console location:** The operator console lives at `apps/management` in this repository.
> **Current platform architecture:** APICenter is a Turborepo monorepo featuring a NestJS Gateway control plane (`apps/gateway`) and platform-owned shared microservices (`apps/payments`, `apps/email`, `apps/sms`, `apps/otp`, `apps/geo`, `apps/gauth`) built with **100% Strict Enterprise Feature Architecture** (`features/<action>/`).

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Quick Start — dev-jwt](#quick-start--dev-jwt)
3. [Shared Microservices & Contracts](#shared-microservices--contracts)
4. [SDK Usage](#sdk-usage)
5. [Documentation](#documentation--license)

---

## Architecture Overview

```text
tribe service / browser / external client
  -> APICenter public gateway (apps/gateway)
  -> auth, registry, scope, rate-limit, and circuit-breaker checks
  -> /api/v1/tribes/:serviceId/* or /api/v1/shared/:serviceId/*
  -> registered tribe or shared microservice runtime (apps/*)
```

The gateway composes authentication, routing, governance, and control-plane persistence. Runtime apps own durable service state. See the current architecture and database ownership docs for exact boundaries.

### Route Namespaces

| Path | What it proxies |
|------|----------------|
| `/api/v1/tribes/:serviceId/*` | Tribe-to-tribe calls |
| `/api/v1/shared/:serviceId/*` | Governed shared-service proxy namespace (`email`, `sms`, `otp`, `geo`, `gauth`) |
| `/api/v1/payments/*` | Provider-neutral payments facade (`apps/payments`) |
| `/api/v1/auth/*` | Token issuance / refresh / revocation |
| `/api/v1/registry/*` | Service self-registration |
| `/api/v1/health/*` | Liveness + readiness probes |

---

## Quick Start — dev-jwt

```bash
npm ci
npm run dev
```

The gateway is available at `http://localhost:3000`.

---

## Shared Microservices & Contracts

All shared microservices expose contract-backed DTOs from `@alpha-explora/apicenter-contracts`:

- **`apps/payments`**: PayMongo checkout sessions, payment intents, subscriptions, refunds, and webhooks.
- **`apps/email`**: Transactional email dispatch, status tracking, and template rendering.
- **`apps/sms`**: Transactional single SMS delivery and delivery status.
- **`apps/otp`**: Passcode generation, anti-brute-force rate limiting, and verification over SMS/Email.
- **`apps/geo`**: Address geocoding, reverse geocoding, and geofence boundary checks.
- **`apps/gauth`**: Multi-tenant Google OAuth 2.0 authorization, code exchange, token refresh, and OIDC ID Token verification.

---

## SDK Usage

Server-side services use the unified `@alpha-explora/apicenter-sdk` client for shared services and payments. See the [SDK integration guide](apps/docs/content/docs/sdk-usage.mdx) for GitHub Packages setup, credentials, idempotency, and typed examples.

```typescript
import { randomUUID } from 'node:crypto';
import { ApiCenter } from '@alpha-explora/apicenter-sdk';

const api = new ApiCenter({
  baseUrl: process.env.APICENTER_URL!,
  auth: {
    serviceId: process.env.APICENTER_SERVICE_ID!,
    environment: process.env.APICENTER_ENVIRONMENT as 'test' | 'live',
    secret: process.env.APICENTER_SERVICE_SECRET!,
  },
});

const sms = await api.sms.send(
  { to: '+639171234567', message: 'Your verification code is 849201' },
  { idempotencyKey: randomUUID() },
);
```

---

## Documentation & License

Start at [docs/index.md](docs/index.md) for the canonical architecture, operations, decisions, and evidence map. Follow [docs/constitution.md](docs/constitution.md) when maintaining documentation.

- **Developer Guide**: [docs/developer/README.md](docs/developer/README.md)
- **Public API Documentation**: [apps/docs](apps/docs)
- **Internal Domain Terminology**: [docs/internal/domain-terminology.md](docs/internal/domain-terminology.md)
- **License**: Proprietary and Confidential — AlphaExplora.
