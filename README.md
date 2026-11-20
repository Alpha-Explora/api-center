# APICenter shared API platform

APICenter gives an organization's backends shared APIs (email, SMS, OTP, geolocation, Google sign-in and payments) behind one application key. Teams manage access in the Management console; a backend calls APICenter through the server-side `@alpha-explora/apicenter-sdk` or the REST API.

The model is:

```text
Organization → Project → Environment (test, live) → Application → keys and grants
```

People get access through organization membership, teams and project roles. Each environment has its own applications, keys (`ak_test_…`, `ak_live_…`), capability grants, quotas and webhooks; nothing is shared between test and live. Live serves traffic only after a readiness check and an activation approved by a second person.

## Workspace layout

- `apps/gateway`: NestJS gateway and control plane: application keys, grants, quotas, routing to runtimes, published APIs, console administration and audit
- `apps/management`: the Management console (Next.js)
- `apps/docs`: consumer and Management documentation with REST and event references
- `apps/payments`, `apps/email`, `apps/sms`, `apps/otp`, `apps/geo`, `apps/gauth`, `apps/webhooks`: shared service runtimes
- `packages/contracts`, `packages/runtime`, `packages/sdk`: shared contracts, the runtime library, and the published SDK

## Request flow

```text
Backend with an application key
  → @alpha-explora/apicenter-sdk or REST API
  → APICenter gateway: key check, grant, quota, signed runtime context
  → shared service runtime, or a project's published API
```

| Path | Purpose |
| :--- | :--- |
| `/api/v1/shared/:capability/*` | Shared services: email, SMS, OTP, geolocation, Google sign-in |
| `/api/v1/payments/*` | Payments (checkouts, intents, links, refunds, subscriptions) |
| `/api/v1/apis/:apiId/*` | APIs that projects publish to other projects in the organization |
| `/api/v1/whoami` | Who an application key belongs to and what it may do |
| `/api/v1/admin/control-plane/*` | Console administration (platform credential and signed-in members only) |
| `/api/v1/health/live`, `/api/v1/health/ready` | Gateway liveness and readiness |

## Run the workspace

```bash
npm install
npm run db:generate   # also runs automatically before npm run typecheck and npm test
npm run dev
```

See [AGENTS.md](AGENTS.md) for commands, package boundaries and test locations, and [CONTRIBUTING.md](CONTRIBUTING.md) for the pull request workflow. For a consumer integration, start at the [APICenter developer docs](apps/docs/content/docs/getting-started.mdx).

## SDK

The SDK provides typed `email`, `sms`, `otp`, `geo`, `auth.google` and `payments` clients, plus `whoami()` and webhook verification. See [SDK integration](apps/docs/content/docs/sdk-usage.mdx) and `packages/sdk/README.md`.

## Documentation ownership

- Consumer and Management guides are published from [`apps/docs`](apps/docs).
- Operator procedures, architecture decisions and internal evidence remain in [`docs`](docs/index.md).
- Follow the [documentation maintenance rules](docs/constitution.md) when changing repository documentation.

The repository is proprietary and confidential to AlphaExplora.
