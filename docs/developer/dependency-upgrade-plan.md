# API Center Dependency Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan phase-by-phase. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade API Center and shared-services dependencies without breaking gateway routing, shared-service wrappers, readiness checks, Kafka publishing, or SDK contracts.

**Architecture:** Treat dependency work as three risk bands: runtime security upgrades first, observability upgrades second, then tooling/runtime major upgrades. Each phase must end with contract, typecheck, unit, e2e, build, and audit verification before moving on.

**Tech Stack:** Node.js, NestJS, OpenTelemetry, Jest, Vitest, TypeScript, Express, Resend, API Center SDK.

---

## Current Baseline

Patch/minor updates have already been applied in:

- `C:\Codes\apic\api-center`
- `C:\Codes\apic\api-shared-services`

Verified baseline commands:

```powershell
cd C:\Codes\apic\api-center
npm run check:contracts
npm run typecheck
npm run lint
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run build

cd C:\Codes\apic\api-shared-services
npm run ci
npm audit
```

Known remaining API Center audit clusters:

- NestJS 10 family: `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `@nestjs/swagger`, `@nestjs/terminus`, `@nestjs/testing`, CLI/schematics.
- OpenTelemetry family: `@opentelemetry/sdk-node`, OTLP exporters, Prometheus exporter, auto-instrumentations.
- Deferred major-only packages: Express 5, Resend 6, Jest 30, TypeScript 6, ESLint 10, Zod 4, Helmet 8, `http-proxy-middleware` 4.

Do not use `npm audit fix --force` as a bulk operation. Apply major upgrades intentionally, one phase at a time.

---

## Phase 0: Freeze Baseline and Protect the Current Work

**Purpose:** Make sure the current repo state is recoverable before major dependency upgrades.

**Files:**

- Review: `C:\Codes\apic\api-center\package.json`
- Review: `C:\Codes\apic\api-center\package-lock.json`
- Review: `C:\Codes\apic\api-shared-services\package.json`
- Review: `C:\Codes\apic\api-shared-services\package-lock.json`

- [ ] Capture current status in both repos.

```powershell
cd C:\Codes\apic\api-center
git status --short

cd C:\Codes\apic\api-shared-services
git status --short
```

Expected: only known dependency/doc/code changes are present.

- [ ] Commit or stash the current non-upgrade work before starting major upgrades.

Recommended commit shape if the current work is ready:

```powershell
cd C:\Codes\apic\api-center
git add .
git commit -m "chore: update api center docs and dependency baseline"

cd C:\Codes\apic\api-shared-services
git add .
git commit -m "chore: update shared services docs and dependency baseline"
```

- [ ] Re-run baseline verification after commit.

```powershell
cd C:\Codes\apic\api-center
npm run check:contracts
npm run typecheck
npm run lint
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run build

cd C:\Codes\apic\api-shared-services
npm run ci
```

Expected: all commands pass before major upgrade work begins.

---

## Phase 1: Upgrade NestJS Runtime Family

**Purpose:** Clear the NestJS runtime audit cluster while keeping API Center behavior stable.

**Files:**

- Modify: `C:\Codes\apic\api-center\package.json`
- Modify: `C:\Codes\apic\api-center\package-lock.json`
- Review as needed: `C:\Codes\apic\api-center\src\main.ts`
- Review as needed: `C:\Codes\apic\api-center\src\app.module.ts`
- Review as needed: `C:\Codes\apic\api-center\src\**\*.spec.ts`
- Review as needed: `C:\Codes\apic\api-center\tests\*.e2e-spec.ts`

- [ ] Upgrade only the NestJS family.

```powershell
cd C:\Codes\apic\api-center
npm install @nestjs/common@^11.1.19 @nestjs/core@^11.1.19 @nestjs/platform-express@^11.1.19 @nestjs/swagger@^11.4.2 @nestjs/terminus@^11.1.1 @nestjs/testing@^11.1.19 @nestjs/cli@^11.0.21 @nestjs/schematics@^11.1.0
```

- [ ] Run TypeScript first to catch API breaks.

```powershell
npm run typecheck
```

Expected: PASS. If it fails, fix only Nest-related compile errors.

- [ ] Run unit and e2e tests.

```powershell
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

Expected: PASS. Pay attention to validation pipe behavior, guards, interceptors, Swagger decorators, and Terminus health checks.

- [ ] Run build and runtime audit.

```powershell
npm run build
npm audit --omit=dev
```

Expected: NestJS audit cluster is gone. Remaining audit findings should mostly be OpenTelemetry or dev tooling.

- [ ] Commit this phase separately.

```powershell
git add package.json package-lock.json src tests
git commit -m "chore: upgrade nestjs runtime family"
```

---

## Phase 2: Upgrade OpenTelemetry and Metrics Exporters

**Purpose:** Clear the critical `protobufjs` and Prometheus exporter audit cluster without breaking metrics or tracing startup.

**Files:**

- Modify: `C:\Codes\apic\api-center\package.json`
- Modify: `C:\Codes\apic\api-center\package-lock.json`
- Review: `C:\Codes\apic\api-center\src\main.ts`
- Review: `C:\Codes\apic\api-center\src\app.module.ts`
- Search target: `C:\Codes\apic\api-center\src\**\*telemetry*`
- Search target: `C:\Codes\apic\api-center\src\**\*metrics*`

- [ ] Find current telemetry wiring.

```powershell
cd C:\Codes\apic\api-center
rg "opentelemetry|telemetry|metrics|prometheus|sdk-node|trace" src test tests
```

- [ ] Upgrade only OpenTelemetry packages.

```powershell
npm install @opentelemetry/sdk-node@^0.217.0 @opentelemetry/exporter-trace-otlp-http@^0.217.0 @opentelemetry/auto-instrumentations-node@^0.75.0 @opentelemetry/api@^1.9.1 @opentelemetry/sdk-trace-base@^2.7.1
```

- [ ] Run compile and tests.

```powershell
npm run typecheck
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

Expected: PASS. If telemetry constructor options changed, update only the telemetry wiring.

- [ ] Verify build and audit.

```powershell
npm run build
npm audit --omit=dev
```

Expected: `protobufjs` critical audit and Prometheus exporter audit are gone.

- [ ] Commit this phase separately.

```powershell
git add package.json package-lock.json src tests
git commit -m "chore: upgrade opentelemetry dependencies"
```

---

## Phase 3: API Center Runtime Majors With Low Surface Area

**Purpose:** Upgrade remaining runtime dependencies that affect request behavior but are not framework migrations.

**Implementation note:** `http-proxy-middleware@4` is not a low-surface upgrade for the current API Center runtime. Version 4 is ESM-only and declares Node `^22.15.0 || ^24.0.0 || >=26.0.0`, while API Center currently compiles CommonJS and the Docker images use Node 20. Keep `http-proxy-middleware@3` until a separate Node 22/ESM migration is planned and tested.

**Files:**

- Modify: `C:\Codes\apic\api-center\package.json`
- Modify: `C:\Codes\apic\api-center\package-lock.json`
- Review: `C:\Codes\apic\api-center\src\main.ts`
- Review: `C:\Codes\apic\api-center\src\external\**\*.ts`
- Review: `C:\Codes\apic\api-center\src\registry\**\*.ts`

- [ ] Upgrade one runtime package at a time.

```powershell
cd C:\Codes\apic\api-center
npm install helmet@^8.1.0
npm run typecheck
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

```powershell
npm install http-proxy-middleware@^4.0.0
npm run typecheck
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

If this fails with ESM parsing or Node engine issues, restore the compatible v3 line and defer this upgrade:

```powershell
npm install http-proxy-middleware@^3.0.5
npm run typecheck
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

```powershell
npm install zod@^4.4.3
npm run typecheck
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

- [ ] Build and audit after all three pass.

```powershell
npm run build
npm audit --omit=dev
```

- [ ] Commit this phase separately.

```powershell
git add package.json package-lock.json src tests
git commit -m "chore: upgrade api center runtime majors"
```

---

## Phase 4: Shared Services SDK Runtime Majors

**Purpose:** Upgrade SDK-side service test/runtime dependencies while preserving tribe-facing SDK contracts.

**Files:**

- Modify: `C:\Codes\apic\api-shared-services\package.json`
- Modify: `C:\Codes\apic\api-shared-services\package-lock.json`
- Review: `C:\Codes\apic\api-shared-services\tests\shared-services\runtime-gateways.test.ts`
- Review: `C:\Codes\apic\api-shared-services\shared-services\email-gateway\**\*.js`
- Review: `C:\Codes\apic\api-shared-services\shared-services\paymongo\**\*.js`

- [ ] Upgrade Express in the SDK test/runtime repo.

```powershell
cd C:\Codes\apic\api-shared-services
npm install express@^5.2.1
npm run ci
```

Expected: PASS. If route wildcard behavior changes, fix runtime gateway tests first, then implementation.

- [ ] Upgrade Resend after Express is stable.

```powershell
npm install resend@^6.12.3
npm run ci
```

Expected: PASS. Email gateway tests must still validate provider payload shape and no-secret fallback behavior.

- [ ] Commit this phase separately.

```powershell
git add package.json package-lock.json shared-services tests
git commit -m "chore: upgrade shared services runtime dependencies"
```

---

## Phase 5: Toolchain Majors

**Purpose:** Upgrade developer tooling after runtime security work is stable.

**Files:**

- Modify: `C:\Codes\apic\api-center\package.json`
- Modify: `C:\Codes\apic\api-center\package-lock.json`
- Modify: `C:\Codes\apic\api-shared-services\package.json`
- Modify: `C:\Codes\apic\api-shared-services\package-lock.json`
- Review as needed: Jest config in `C:\Codes\apic\api-center\package.json`
- Review as needed: TypeScript configs in both repos

- [ ] Upgrade TypeScript only after Nest and OpenTelemetry are stable.

```powershell
cd C:\Codes\apic\api-center
npm install -D typescript@^6.0.3 @types/node@^25.7.0
npm run typecheck
npm test -- --runInBand
npm run build

cd C:\Codes\apic\api-shared-services
npm install -D typescript@^6.0.3 @types/node@^25.7.0
npm run ci
```

- [ ] Upgrade Jest only after TypeScript is stable.

```powershell
cd C:\Codes\apic\api-center
npm install -D jest@^30.4.2 @types/jest@^30.0.0 ts-jest@latest
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

- [ ] Upgrade ESLint only after Jest is stable.

```powershell
npm install -D eslint@^10.3.0 @eslint/js@^10.0.1 eslint-config-prettier@^10.1.8 globals@^17.6.0
npm run lint
```

- [ ] Commit this phase separately.

```powershell
cd C:\Codes\apic\api-center
git add package.json package-lock.json eslint.config.* tsconfig*.json
git commit -m "chore: upgrade api center toolchain majors"

cd C:\Codes\apic\api-shared-services
git add package.json package-lock.json tsconfig*.json
git commit -m "chore: upgrade shared services toolchain majors"
```

---

## Phase 6: Final Verification and Deployment Readiness

**Purpose:** Prove the upgraded code is safe to deploy to GKE.

- [ ] Run full local verification.

```powershell
cd C:\Codes\apic\api-center
npm run check:contracts
npm run typecheck
npm run lint
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run build
npm audit --omit=dev

cd C:\Codes\apic\api-shared-services
npm run ci
npm audit
```

- [ ] Check major-only leftovers.

```powershell
cd C:\Codes\apic\api-center
npm outdated

cd C:\Codes\apic\api-shared-services
npm outdated
```

Expected: any remaining outdated packages are accepted intentionally and documented.

- [ ] Deploy only after local verification passes.

```powershell
cd C:\Codes\apic\api-center
kubectl apply -f gcp/gke/
kubectl rollout status deployment/api-center -n api-center --timeout=180s
```

- [ ] Verify live readiness after rollout.

```powershell
curl.exe -i https://api-center.itsandbox.site/api/v1/health/ready
```

Expected: HTTP 200.

---

## Recommended Commit Order

1. `chore: update api center docs and dependency baseline`
2. `chore: update shared services docs and dependency baseline`
3. `chore: upgrade nestjs runtime family`
4. `chore: upgrade opentelemetry dependencies`
5. `chore: upgrade api center runtime majors`
6. `chore: upgrade shared services runtime dependencies`
7. `chore: upgrade api center toolchain majors`
8. `chore: upgrade shared services toolchain majors`

Keep each commit independently revertible. Do not combine runtime upgrades with formatting-only changes.
