# AGENTS.md

## Project Overview

APICenter is a NestJS TypeScript API gateway. It is backend-only (no frontend UI stack) and organized by domain modules under `src/`.

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

Alternative:

```bash
npm run start:dev
```

### Run (production build)

```bash
npm run build
npm run start:prod
```

### Test

```bash
npm run test
```

Run a single test file:

```bash
npm run test -- src/auth/auth.controller.spec.ts
```

Coverage:

```bash
npm run test:cov
```

E2E:

```bash
npm run test:e2e
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

- Entry point: `src/main.ts`
- Root module: `src/app.module.ts`
- Domain modules: `src/auth`, `src/external`, `src/registry`, `src/tribes`, `src/health`, `src/kafka`, `src/metrics`
- Shared infrastructure: `src/shared`, `src/shared-services`, `src/config`, `src/types`
- Tests are primarily colocated as `*.spec.ts` in `src/`, with e2e config in `tests/jest-e2e.json`

## Conventions

- File naming in `src/` is mostly kebab-case with Nest suffix patterns (`*.module.ts`, `*.service.ts`, `*.controller.ts`, `*.guard.ts`, `*.dto.ts`, `*.spec.ts`).
- Prefer existing path aliases from `tsconfig.json` (`@auth/*`, `@shared/*`, etc.) when appropriate.
- Keep commit messages short and imperative; optional prefixes (`feat:`, `fix:`, `docs:`) are acceptable but not consistently enforced in this repo.


