# APICenter shared API platform

APICenter provides shared APIs to backend services in an organization. Teams use Management to register services and assign project placement, scopes, and shared-service dependencies. A registered backend calls APICenter through the server-side `@alpha-explora/apicenter-sdk` or the REST API.

The management hierarchy is:

```text
Organization → Tribe → Project → Service
```

Organization membership scopes Management access. The Registry view displays tribes, projects, and services.

## Workspace layout

- `apps/gateway`: NestJS gateway, authentication, registry, authorization, routing, quotas, and audit
- `apps/management`: organization-scoped console for registry and shared-service settings
- `apps/docs`: consumer and management documentation with REST and event references
- `apps/payments`, `apps/email`, `apps/sms`, `apps/otp`, `apps/geo`, `apps/gauth`: shared API runtimes
- `packages/contracts`: shared request, response, and event contracts
- `packages/sdk`: server-side TypeScript client

## Request flow

```text
Registered backend
  → @alpha-explora/apicenter-sdk or REST API
  → APICenter gateway: authentication, scopes, routing, quotas, idempotency
  → registered service or platform shared-service runtime
```

Common API namespaces:

| Path | Purpose |
| :--- | :--- |
| `/api/v1/tribes/:serviceId/*` | Calls to registered tribe services |
| `/api/v1/shared/:serviceId/*` | Calls to platform shared services such as email, SMS, OTP, Geo, and GAuth |
| `/api/v1/payments/*` | Provider-neutral payment resources |
| `/api/v1/auth/*` | Service token issuance and public key discovery |
| `/api/v1/health/live` and `/api/v1/health/ready` | Gateway liveness and readiness |

Register services through **Management → Registry**. Services do not self-register at application startup.

## Run the workspace

```bash
npm install
npm run dev
```

See [AGENTS.md](AGENTS.md) for workspace commands, package boundaries, and test locations. For a consumer integration, start at the [APICenter developer docs](apps/docs/content/docs/getting-started.mdx).

## SDK

The SDK provides typed `email`, `sms`, `otp`, `geo`, `googleAuth`, and `payments` clients. See [SDK integration](apps/docs/content/docs/sdk-usage.mdx) for package access, server-only credentials, idempotency, and examples.

## Documentation ownership

- Consumer and Management guides are published from [`apps/docs`](apps/docs).
- Operator procedures, architecture decisions, and internal evidence remain in [`docs`](docs/index.md).
- Follow [documentation maintenance rules](docs/constitution.md) when changing repository documentation.

The repository is proprietary and confidential to AlphaExplora.
