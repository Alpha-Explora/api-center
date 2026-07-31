# AGENTS.md

## Project Overview

APICenter is organized as a Turborepo monorepo featuring a central NestJS TypeScript API Gateway (`apps/gateway`) alongside specialized service runtimes (`apps/payments`, `apps/email`, etc.) and shared packages (`packages/contracts`, `packages/runtime`, `packages/sdk`).

## Workspace Layout

- `apps/gateway`: Central NestJS API Gateway control plane
- `apps/payments`: Payment data plane runtime
- `apps/email`, `apps/sms`, `apps/geo`, `apps/gauth`, `apps/otp`: Shared service runtimes
- `apps/management`: Management console web application
- `apps/docs`: Public developer documentation site
- `packages/contracts`: Shared schema definitions and contracts
- `packages/runtime`: Shared Node.js micro-runtime framework
- `packages/sdk`: Published `@alpha-explora/apicenter-sdk` client library

## Core Commands

### Install

```bash
npm install
```

### Build

```bash
npm run build
```

### Run (development)

```bash
npm run dev
```

### Test

```bash
npm run test
```

### Boundary & Monorepo Validation

```bash
npm run check:boundaries
npm run check:monorepo
```

### Lint and Format

```bash
npm run lint
npm run format
```

### Typecheck

```bash
npm run typecheck
```

## Architecture Notes

- Gateway Entry point: `apps/gateway/src/main.ts`
- Gateway Root module: `apps/gateway/src/app.module.ts`
- Gateway Domain modules: Organized under `apps/gateway/src/` (e.g. `auth`, `registry`, `tribes`, `health`, `metrics`, `quotas`, `approvals`, `policy`, `catalog`, `compliance`)
- Boundary rules: Strictly enforced by `scripts/check-boundaries.js` and `scripts/check-monorepo-boundary.js`
- Tests live under `tests/`: unit specs mirror source paths under `tests/unit/`, integration script tests live under `tests/integration/`, and e2e specs/config live under `tests/e2e/`

## Conventions

- File naming in `apps/gateway/src/` is kebab-case with Nest suffix patterns (`*.module.ts`, `*.service.ts`, `*.controller.ts`, `*.guard.ts`, `*.dto.ts`).
- Respect path aliases defined in `apps/gateway/tsconfig.json` (`@config/*`, `@shared/*`, `@auth/*`, etc.).
- Keep commit messages short and imperative (`feat:`, `fix:`, `refactor:`).


