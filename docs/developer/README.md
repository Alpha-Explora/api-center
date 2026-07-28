# APICenter Developer Guide

This guide covers the active APICenter Turborepo. Cloud Run is the deployment target;
Google Pub/Sub is the payment lifecycle event transport; the checked-in contracts
and SDK are the public integration surface.

## Local Development

```powershell
npm ci
npm run typecheck
npm run check:monorepo
npm run check:boundaries:test
npm run contracts:validate
npm run check:contracts
npm run contracts:test
npm run sdk:build
npm run docs:test
```

Run the gateway locally with `npm run dev`. The private payment runtime is under
`apps/payments`; its JavaScript checks run with `npm run lint --workspace @apicenter/payments`.

## Current Boundaries

- `apps/gateway`: auth, registry, policy, quotas, routing, and public facade.
- `apps/payments`: PayMongo credentials, provider calls, canonical payment state,
  webhook verification, outbox, and Pub/Sub publishing.
- `apps/management`: operator provisioning and consumer/key management.
- `packages/contracts`: public OpenAPI and AsyncAPI artifacts.
- `packages/sdk`: TypeScript client used by consumer services.

`api-shared` and the former standalone management repository are retired migration
sources. Do not add new imports, manifests, or deployment contexts for them.

## Deployment

Use `docs/deployment-cloud-run.md` for the current Cloud Run deployment record and
`docs/apicenter-platform-setup.md` for service accounts, secrets, and Pub/Sub setup.
The Cloud Run manifests are under `infra/gcp/cloud-run/`; payment event topology is
under `infra/gcp/pubsub/`.

## Public Contracts

- `contracts/public/apicenter.openapi.yaml`
- `contracts/public/apicenter.asyncapi.yaml`
- `packages/sdk/src/`
- `docs/payments-platform-current.md`

Consumer services must call APICenter through the SDK. Provider credentials remain
inside APICenter-owned runtime secrets.