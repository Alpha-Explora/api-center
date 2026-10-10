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
- Gateway domain modules: Organized under `apps/gateway/src/domains/` (`auth-security`, `catalog-registry`, `compliance`, `gateway-proxy`, `governance`, `payments`, `runtime-ops`)
- Boundary rules: Strictly enforced by `scripts/check-boundaries.js` and `scripts/check-monorepo-boundary.js`
- Tests live under `tests/`: unit specs mirror source paths under `tests/unit/`, integration script tests live under `tests/integration/`, and e2e specs/config live under `tests/e2e/`

## Conventions

- File naming in `apps/gateway/src/` is kebab-case with Nest suffix patterns (`*.module.ts`, `*.service.ts`, `*.controller.ts`, `*.guard.ts`, `*.dto.ts`).
- Respect path aliases defined in `apps/gateway/tsconfig.json` (`@config/*`, `@shared/*`, `@auth/*`, etc.).
- Keep commit messages short and imperative (`feat:`, `fix:`, `refactor:`).



## Documentation workflow

Start at [docs/index.md](docs/index.md) and follow [the maintenance rules](docs/constitution.md). Keep internal docs separate from registered consumer guides. Update the affected source of truth with behavior changes, root CHANGELOG.md for user-visible delivery, and docs/log.md for documentation-bundle changes.

Run npm run check:documentation and npm run test:documentation for documentation changes. For public docs or contracts, also run npm run contracts:validate, npm run docs:build, npm run docs:test, and npm run typecheck --workspace @apicenter/docs. Promote completed plans into maintained docs, retire their pointers, and preserve explicit gaps for incomplete work. A repository check does not verify provider or deployment behavior.

CLAUDE.md points here rather than maintaining a second instruction copy.
