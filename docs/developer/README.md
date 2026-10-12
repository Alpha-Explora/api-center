---
title: "APICenter Developer Guide"
status: canonical
authority: informative
owner: platform-maintainers
audience: [engineers, maintainers, agents]
last_verified: "2026-10-10"
verification: repository
sources: ["AGENTS.md","docs/architecture/current-architecture.md"]
---
# APICenter Developer Guide

This guide covers the active APICenter Turborepo monorepo. Cloud Run is the deployment target; Google Pub/Sub is the payment lifecycle event transport; `@alpha-explora/apicenter-contracts` and `@alpha-explora/apicenter-sdk` form the public integration surface.

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
- `apps/payments`: PayMongo credentials and provider calls, webhook verification, APICenter ownership/reconciliation records, and Pub/Sub publishing. PayMongo remains the source of truth for provider-backed payment resources.
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

## Documentation checks

Use [the documentation index](../index.md) for internal authorities. Consumer guides are registered in apps/docs/content/guides.json; the existing Fumadocs MDX integration renders their headings, links, tables, and code blocks.

Run npm run check:documentation, npm run test:documentation, npm run docs:build, npm run docs:test, and npm run typecheck --workspace @apicenter/docs. Documentation checks run automatically on relevant PRs; full CI and release publication stay manual.
