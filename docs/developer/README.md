# APICenter Developer Guide

This guide covers the active APICenter Turborepo monorepo. Cloud Run is the deployment target; Google Pub/Sub is the payment lifecycle event transport; `@apicenter/contracts` and `@alpha-explora/apicenter-sdk` form the public integration surface.

## Local Development

```powershell
npm ci
npm run typecheck
npm run check:monorepo
npm run check:boundaries
npm run sdk:test
npm run docs:test
```

Run the gateway locally with `npm run dev`. All shared microservice runtimes (`apps/email`, `apps/sms`, `apps/otp`, `apps/geo`, `apps/gauth`, `apps/payments`) are written in strict TypeScript and follow **100% Strict Enterprise Feature Architecture** (`features/<action>/`).

## Current Boundaries

- `apps/gateway`: Central NestJS API Gateway control plane organized by domain (`auth-security`, `catalog-registry`, `compliance`, `gateway-proxy`, `governance`, `payments`, `runtime-ops`).
- `apps/payments`: PayMongo credentials, provider calls, canonical payment state, webhook verification, and Pub/Sub publishing.
- `apps/email`, `apps/sms`, `apps/otp`, `apps/geo`, `apps/gauth`: Platform shared microservice runtimes.
- `apps/management`: Operator provisioning and consumer/key management.
- `apps/docs`: Static developer documentation site powered by Next.js, Fumadocs, and TailwindCSS.
- `packages/contracts`: Public TypeScript contracts and schema definitions.
- `packages/sdk`: Published `@alpha-explora/apicenter-sdk` client library.

## Deployment

Use `docs/deployment-cloud-run.md` for the Cloud Run deployment record and `docs/apicenter-platform-setup.md` for service accounts, secrets, and Pub/Sub setup.

## Public Contracts

- `packages/contracts/src/index.ts`
- `@alpha-explora/apicenter-sdk`
- `apps/docs/content/docs/`

Consumer services must call APICenter through the SDK or contract endpoints. Provider credentials remain inside APICenter-owned runtime secrets.