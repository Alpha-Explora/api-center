# One APICenter Environment-Aware Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move consumers toward one APICenter URL while safely supporting `test` and `live` through required environment identity, environment-scoped secrets, token claims, routing guards, shared-service provider routing, and Management visibility.

**Architecture:** APICenter remains the single control plane and gateway URL. Runtime calls carry `APICENTER_ENVIRONMENT`, API Center validates the matching environment-scoped tribe secret, issues tokens with environment claims, and routes to tribe backends or shared-service runtimes by environment. Shared services keep separate runtimes where real-world side effects, provider credentials, or cost require isolation, especially payment.

**Tech Stack:** NestJS 11, TypeScript, Prisma/Supabase Postgres, GCP Secret Manager, Redis, Next.js 16 Management, `@alpha-explora/apicenter` SDK, Jest, Vitest.

---

## Locked Decisions

- Consumer backends use one gateway URL: `APICENTER_URL=https://api-center.itsandbox.site`.
- `APICENTER_ENVIRONMENT=test|live` is required. No URL inference, no silent default.
- Tribe secrets are environment-scoped:
  - `api-center-tribe-secret-<tribe-id>-test`
  - `api-center-tribe-secret-<tribe-id>-live`
- Tokens include `tribeId`, `sourceServiceId`, `environment`, permissions, and scopes.
- Tribe backend routing key: `serviceId + environment`.
- Shared-service routing key: `sharedServiceId + environment`.
- API Center blocks environment leaks before proxying, quota enforcement, provider forwarding, and event publishing.
- Management shows one service with environment rows instead of duplicate services.
- Target deployment shape is one GKE cluster, one APICenter runtime platform, and one Management deployment after leak guards and environment-scoped secrets are enforced.
- Only payment is split into separate provider runtimes for now: `payment-test` and `payment-live`. Email, SMS, OTP, Google auth, and geo stay single-runtime unless provider risk later justifies a split.
- Database isolation uses an `environment` column, composite constraints, indexes, and optional clean views. Do not create separate test/live schemas for the same owner/domain.
- API Center must validate that `sourceServiceId` is registered, active, owned by `tribeId`, and active for the requested environment before issuing a token.
- Legacy transition mode must use an explicit service-to-environment map. Do not infer missing environment from URL, deployment, or service name.
- Secret resolver caches, refresh tokens, webhook idempotency, data-pipeline exports, usage rollups, and quota decisions must all be keyed by environment.
- One Management deployment requires stronger live-action guardrails than test actions.
- Environment must never be defaulted to `test` by database defaults, Prisma model defaults, SDK constructors, proxy headers, or Management deployment configuration. Missing environment is an error except for explicitly allowlisted legacy warn-mode clients.
- Runtime routing environment is token-derived only. API Center must reject or strip caller-supplied environment override headers, query params, and body fields before proxying.
- Tribe secret identity is based on `tribeId` / `ownerTribeId`, not `sourceServiceId`. `sourceServiceId` identifies the registered calling service for routing, audit, usage, and quota evidence.

## Canonical Naming Model

Use these names consistently so `live`, `prod`, deployment labels, provider modes, and database fields do not collapse into one ambiguous `environment` word.

| Concept | Canonical name | Allowed values | Where it may appear | Where it must not appear |
| --- | --- | --- | --- | --- |
| Public APICenter runtime identity | `runtimeEnvironment` / `APICENTER_ENVIRONMENT` | `test`, `live` | SDK, token claims, registry environment rows, quota, audit, usage, Management target rows | `prod`, `production`, provider/pipeline storage names |
| Management deployment label | `managementDeploymentEnvironment` / `MANAGEMENT_ENVIRONMENT` | `local`, `test`, `live` | Management readiness, auth mode, deployment banner | Authorization decisions for a target row without also reading the row's `runtimeEnvironment` |
| Node/build mode | `nodeEnvironment` / `NODE_ENV` | `development`, `test`, `production` | Build behavior, Next/Nest runtime checks | API Center routing, token claims, service registry rows |
| Physical data-pipeline lane | `pipelineLane` / `physicalPipelineEnvironment` | `test`, `prod` | Athena topics, S3/Athena partitions that already use `prod`, Confluent topic prefixes | SDK contracts, service manifests, Management live-action UX labels |
| Payment/provider mode | `providerMode` | `test`, `live` | Payment provider credentials, webhook verification, payment route selection | Data-pipeline topic prefixes, Node build mode |
| Secret Manager deployment bundle | `deploymentSecretBundleName` | existing names such as `api-center-prod`, `api-shared-services-prod` | GCP/Kubernetes deployment secret bundles only | Tribe handoff, SDK env examples, registry environment rows |

Locked naming decisions:

- `live` is the only public production runtime value. Do not introduce `prod` into SDK requests, token claims, service manifests, registry rows, shared-service usage, quota, audit, or Management target-environment actions.
- `prod` is allowed only as a physical infrastructure lane where an external system already uses it, primarily Athena/S3/Confluent topic prefixes and legacy deployment secret bundles.
- Any `live -> prod` conversion must happen in a named boundary helper such as `toPhysicalPipelineEnvironment(runtimeEnvironment)`. Inline string substitutions, generic `environment` variables, or UI labels that expose `prod` for a live APICenter action are not acceptable.
- Existing `api-center-prod` and `api-shared-services-prod` Secret Manager bundles may remain for deployment compatibility, but docs must describe them as deployment bundles. New tribe/runtime secret names use `-test` or `-live`, not `-prod`.
- Function and variable names should include the domain when they cross a boundary: use `parseRuntimeEnvironment`, `parsePipelineLane`, `toPhysicalPipelineEnvironment`, `resolveManagementDeploymentEnvironment`, and `resolveProviderMode` instead of repeated generic helpers like `readEnvironment` or `environment`.

## Naming Findings To Fix

1. **Management data-pipeline routes overload `environment`.**
   `apicenter-management/src/app/api/local/data-pipeline/health/route.ts` and `quality/route.ts` parse `environment=test|prod`. These routes are reading a physical pipeline lane, not APICenter runtime identity. Keep a backwards-compatible `environment` query alias temporarily, but add `pipelineLane=test|prod` and rename internal variables, response metadata, schemas, and tests to `pipelineLane`.

2. **Live promotion UI leaks `prod` terminology.**
   `apicenter-management/src/components/environment-promotion-panel.tsx` queries plan assignments with `environment: "prod"` and tells operators to assign a plan tier for the prod environment, while the panel is a live promotion workflow. The UI and client helper should request a public `runtimeEnvironment: "live"` and map to any storage `prod` value only inside an API/provider adapter.

3. **Plan-tier and service-detail components mix live and prod.**
   `apicenter-management/src/components/tribe-plan-tier-panel.tsx` exposes environments `["test", "prod"]`, and `service-detail/service-detail-content.tsx` toggles pipeline rows with `"prod"` while the surrounding service detail uses `test|live`. Rename these UI-facing controls to `test|live`; only the pipeline data source should know the physical `prod` lane.

4. **API Center lifecycle evidence has an ambiguous pipeline boundary.**
   `api-center/src/operations/service-lifecycle-evidence.controller.ts` calls `pipelineHealth.listHealth("live")`, while historical pipeline health records and several specs use `prod`. Add an explicit `toPhysicalPipelineEnvironment("live") === "prod"` mapping and tests so lifecycle evidence is public `live` but queries physical pipeline `prod`.

5. **Secret bundle names can be mistaken for runtime environments.**
   Existing GCP bundles such as `api-center-prod` and `api-shared-services-prod` are deployment bundles, not public APICenter runtime values. Add docs and lint coverage so no new SDK, manifest, tribe secret, or registry examples use `prod`.

6. **Multiple generic parser/helper names make reviews harder.**
   There are repeated helpers such as `readRuntimeEnvironment` and local `environment` variables across API Center, SDK, and Management. Long term, centralize naming helpers per repo and require domain-specific names at boundaries.

## Legacy And Redundancy Findings To Fix

These are broader than `live` versus `prod`. They cover stored legacy records, code-level compatibility paths, duplicate env names, stale docs, and UI/API naming that can make future reviews harder.

1. **Legacy service registry records still exist in the active catalog.**
   Inventory evidence shows temporary/test-only services such as `codex-owner-20260520024731`, `codex-owner-20260520024731-orders`, `codex-probe`, `codex-smoke-*`, and services with `https://api-center-test.itsandbox.site` backend URLs. Every active legacy service must be migrated to explicit environment rows, marked test-only with a sunset, or retired. Do not gate this on runtime access to third-party services; this is APICenter catalog ownership.

2. **Legacy Secret Manager records are still enabled after scoped copies.**
   `api-center-test-tribe-secret-*` and unscoped `api-center-tribe-secret-<tribe-id>` records were copied to scoped `api-center-tribe-secret-<tribe-id>-test|live` records for several services. The plan must include the full lifecycle: inventory, scoped copy, verify metadata, remove allowlist/map references, disable old versions for rollback, then delete legacy records after the rollback window.

3. **Code-level legacy secret fallback remains by design but needs a removal slice.**
   `api-center/src/registry/tribe-secret-resolver.service.ts`, token request DTO tests, `.env.example`, and docs still support `APICENTER_LEGACY_TRIBE_SECRET_FALLBACK`, `APICENTER_LEGACY_ENVIRONMENT_ALLOWLIST`, `APICENTER_LEGACY_ENVIRONMENT_MAP`, and env-backed legacy hash validation. That is acceptable only during warn mode. Add an enforce-mode removal task that fails if these code paths still run when all active services are migrated.

4. **Old endpoint names remain in docs and tests.**
   `https://api-center-test.itsandbox.site` and `https://api-center-management-test.itsandbox.site` still appear in docs, tests, and archived runbooks. Archive-only references can remain, but active docs, examples, env files, and test fixtures should use the one URL `https://api-center.itsandbox.site` plus `APICENTER_ENVIRONMENT=test|live`.

5. **Deployment env aliases are redundant and should be consolidated.**
   Management currently reads `MANAGEMENT_ENVIRONMENT`, `MANAGEMENT_ENV`, and `NEXT_PUBLIC_MANAGEMENT_ENV`; API Center and Management also distinguish server/base URL and public/base URL names. Keep compatibility aliases only at process boundaries. Internally use one canonical config object with `managementDeploymentEnvironment`, `apiCenterBaseUrl`, and `publicApiCenterBaseUrl`, then lint against direct `process.env.MANAGEMENT_ENV` reads outside that resolver.

6. **SDK URL aliases should have a deprecation path.**
   The SDK smoke scripts accept `APICENTER_URL` and `APICENTER_GATEWAY_URL`. Keep `APICENTER_URL` as canonical and mark `APICENTER_GATEWAY_URL` as transitional. Add a contract check so new docs/examples do not introduce more URL aliases.

7. **Provider-specific fallback naming remains from earlier Power BI work.**
   Management still has legacy `POWERBI_NORTH_STAR_*` fallback support while newer docs describe provider-neutral BI naming. If the current platform no longer needs Power BI fallback, add it to the redundancy cleanup. If it must remain, isolate it in one provider adapter and stop surfacing it in general APICenter docs.

8. **`ownerTribeId` and `sourceServiceId` are not redundant but need clearer naming.**
   Do not collapse these fields. `ownerTribeId` is the tribe/security/quota boundary; `sourceServiceId` is the calling backend/service attribution. The redundancy to remove is places that default, infer, or present them as interchangeable.

## Target Consumer Env Shape

```env
APICENTER_URL=https://api-center.itsandbox.site
APICENTER_ENVIRONMENT=test
APICENTER_TRIBE_ID=church-donations
APICENTER_SERVICE_ID=church-donations
APICENTER_TRIBE_SECRET=<test-secret-issued-by-platform>
```

```env
APICENTER_URL=https://api-center.itsandbox.site
APICENTER_ENVIRONMENT=live
APICENTER_TRIBE_ID=church-donations
APICENTER_SERVICE_ID=church-donations
APICENTER_TRIBE_SECRET=<live-secret-issued-by-platform>
```

For monoliths, `APICENTER_SERVICE_ID` should be the registered monolith service ID. Do not invent per-module service IDs until the backend is split into independently deployed services.

## File Structure

### API Center

- Modify: `api-center/src/types.ts` for shared environment type helpers.
- Modify: `api-center/src/shared/dto/token-request.dto.ts` for required `environment` and optional `sourceServiceId`.
- Modify: `api-center/src/auth/auth-provider.interface.ts`, `auth.service.ts`, `auth.controller.ts`, JWT providers, `jwt-auth.guard.ts`, and `api-center/src/types.ts` for environment token claims and source-service request context.
- Create: `api-center/src/registry/environment-secret-name.ts` for Secret Manager naming.
- Modify: `api-center/src/registry/tribe-secret-resolver.service.ts` and `registry.service.ts` for environment-scoped validation.
- Create: `api-center/src/shared/proxy/environment-leak-guard.ts` for cross-environment blocking.
- Modify: `api-center/src/shared/proxy-handler.ts` to use environment-aware target URLs and cache keys.
- Create: `api-center/src/shared-services/shared-service-routing.service.ts` for shared-service runtime target resolution, with payment split and same-runtime mappings for lower-risk shared services.
- Modify: analytics, quota, policy, circuit-breaker, health, and promotion-evidence services so all runtime records include explicit `environment` and `sourceServiceId` where applicable.
- Modify: Supabase migrations/Prisma models so control-plane and shared-service tables use `environment` columns, composite uniqueness, and clean views instead of per-environment schemas.
- Modify: docs and `.env.example` for the new rollout model.
- Create and maintain: `api-center/docs/visualizations/one-apicenter-environment-aware-routing-tracker.html` as the human-readable decisions, plan, and slice tracker. Use `$build-web-apps:frontend-app-builder` when creating or materially redesigning this HTML artifact.

### SDK

- Modify: `api-shared-services/src/TribeClient.ts` to require `environment`, send it in `/auth/token`, and attach `X-APICenter-Environment`.
- Modify: `api-shared-services/src/types.ts` for `ApicenterEnvironment` and environment-aware token response.
- Modify: SDK tests and docs.

### Management

- Modify: `apicenter-management/src/lib/schemas.ts` to require environment for secret provisioning.
- Modify: `apicenter-management/src/app/api/local/tribe-secrets/route.ts` and `[serviceId]/route.ts` to use environment-scoped secret names.
- Modify: `sdk-config-panel.tsx` and `service-detail/environment-section.tsx` to show per-environment handoff and readiness.

---


## Visual Tracking Artifact

Create a static, browser-openable HTML tracker so the plan is easy to digest and review without reading the full Markdown every time.

**Required file:**
- `api-center/docs/visualizations/one-apicenter-environment-aware-routing-tracker.html`

**Creation rule:**
- When creating or materially redesigning this HTML tracker, use `$build-web-apps:frontend-app-builder`.
- Keep it static and repo-local; opening the file directly in a browser should work without a dev server.
- Use a dense operational dashboard style, not a marketing page.

**Tracker must show:**
- Locked decisions and non-negotiable guardrails.
- Current task slices with checkbox status, owner repo, dependencies, and verification gates.
- Critical risks and their resolution status.
- Database constraint matrix and migration readiness.
- Management/SDK rollout readiness.
- Test/live deployment and smoke status.
- Last updated date, commit/reference if available, and what changed in the latest slice.

**Maintenance rule:**
- Every implementation slice must update both this Markdown plan checkbox state and the HTML tracker before the slice is considered done.
- When a checkbox is completed in this Markdown plan, mirror the status in the HTML tracker in the same commit.
## Task 0: Inventory Current Runtime State Before Design Changes

**Files:**
- Create: `api-center/docs/operations/one-url-environment-migration-inventory.md`
- Create: `api-center/docs/visualizations/one-apicenter-environment-aware-routing-tracker.html`

- [x] **Step 1: Inventory active services and environments**

Record every active service with `serviceId`, `ownerTribeId`, current backend URLs, declared environment rows, lifecycle status, and current consumers.

```powershell
cd C:\Codes\apic\api-center
npm run registry:verify
```

Expected: registry verification succeeds, and the inventory doc lists every active service that will need a new `APICENTER_ENVIRONMENT` handoff.

- [x] **Step 2: Inventory current tribe secret names**

Record existing Secret Manager names for active tribes and identify which need new environment-scoped records:

```text
api-center-tribe-secret-<tribe-id>
api-center-tribe-secret-<tribe-id>-test
api-center-tribe-secret-<tribe-id>-live
```

Do not record plaintext secrets in the inventory document.

- [x] **Step 3: Inventory shared-service consumers and payment records**

Record which services consume `payment`, `email`, `sms`, `otp`, `gauth`, and `geo`. For payment, record whether existing provider records can be classified as `test` or `live` before database backfill.

- [x] **Step 4: Inventory SDK versions**

Record active services still using an SDK version that does not send `APICENTER_ENVIRONMENT`. These services must either be upgraded before enforce mode or added to the temporary legacy environment map.

- [x] **Step 5: Create the visual decision and rollout tracker**

Using `$build-web-apps:frontend-app-builder`, create `api-center/docs/visualizations/one-apicenter-environment-aware-routing-tracker.html` with these dashboard sections:

```text
Decisions: one URL, required environment, token-derived routing, no DB defaults, tribe-secret identity
Slice Tracker: Task 0 through Task 11 with status, repo, dependencies, verification command, last updated
Critical Risks: environment override, DB defaults, target-env Management authorization, tribe-vs-service secret identity, prod/live pipeline mapping
Database Matrix: table, environment columns, constraints, indexes, grants, RLS/exposure check
Rollout Gates: warn mode, SDK major, secret provisioning, service smoke, enforce mode, rollback
Deployment Status: API Center live/test image, Management base URL, Supabase migration state
```

The tracker must be readable as a standalone HTML file opened from disk and must not require a dev server.

- [x] **Step 6: Commit the inventory and tracker**

```powershell
cd C:\Codes\apic\api-center
git add docs/operations/one-url-environment-migration-inventory.md docs/visualizations/one-apicenter-environment-aware-routing-tracker.html
git commit -m "docs: inventory one-url environment migration state"
```

## Task 1: Define The Environment Contract

**Files:**
- Modify: `api-center/src/types.ts`
- Modify: `api-center/src/shared/dto/token-request.dto.ts`
- Create: `api-center/src/shared/dto/token-request.dto.spec.ts`
- Modify: `api-shared-services/src/types.ts`

- [x] **Step 1: Write failing API Center DTO tests**

Add tests that prove `environment` is required, `test` and `live` are accepted, and `production` is rejected.

```ts
import { validate } from "class-validator";
import { TokenRequestDto } from "./token-request.dto";

const dto = (input: Partial<TokenRequestDto>) => Object.assign(new TokenRequestDto(), input);

describe("TokenRequestDto", () => {
  it("requires environment", async () => {
    const errors = await validate(dto({ tribeId: "church-donations", secret: "secret" }));
    expect(errors.some((error) => error.property === "environment")).toBe(true);
  });

  it.each(["test", "live"])("accepts %s", async (environment) => {
    await expect(
      validate(dto({ tribeId: "church-donations", sourceServiceId: "church-donations", secret: "secret", environment } as any)),
    ).resolves.toHaveLength(0);
  });

  it("rejects production", async () => {
    const errors = await validate(dto({ tribeId: "church-donations", secret: "secret", environment: "production" } as any));
    expect(errors.some((error) => error.property === "environment")).toBe(true);
  });
});
```

- [x] **Step 2: Run failing test**

```powershell
cd C:\Codes\apic\api-center
npm test -- --runInBand src/shared/dto/token-request.dto.spec.ts
```

Expected: FAIL because `environment` is not implemented.

- [x] **Step 3: Add API Center environment type**

In `api-center/src/types.ts`:

```ts
export const APICENTER_RUNTIME_ENVIRONMENT_KEYS = ["test", "live"] as const;
export type ApicenterRuntimeEnvironment = (typeof APICENTER_RUNTIME_ENVIRONMENT_KEYS)[number];

export function isApicenterRuntimeEnvironment(value: unknown): value is ApicenterRuntimeEnvironment {
  return typeof value === "string" && APICENTER_RUNTIME_ENVIRONMENT_KEYS.includes(value as ApicenterRuntimeEnvironment);
}

// Keep the registry's broader ServiceEnvironmentKey only while migrating existing staging/uat/demo records.
// Token issuance, gateway routing, provider routing, usage, quota, and evidence must use ApicenterRuntimeEnvironment.
```

- [x] **Step 4: Add DTO fields**

In `token-request.dto.ts`, add `environment` and `sourceServiceId`:

```ts
@ApiProperty({ example: "test", enum: SERVICE_ENVIRONMENT_KEYS })
@IsString()
@IsNotEmpty({ message: "environment is required" })
@IsIn(SERVICE_ENVIRONMENT_KEYS, { message: "environment must be one of: test, live" })
environment!: ServiceEnvironmentKey;

@ApiProperty({ example: "church-donations", required: false, maxLength: 80 })
@IsOptional()
@IsString()
@MaxLength(80, { message: "sourceServiceId is too long" })
sourceServiceId?: string;
```

- [x] **Step 5: Add SDK public type**

In `api-shared-services/src/types.ts`:

```ts
export type ApicenterEnvironment = "test" | "live";
```

Add `environment: ApicenterEnvironment` and `sourceServiceId?: string` to `TokenResponse`.

- [x] **Step 6: Verify and commit**

```powershell
cd C:\Codes\apic\api-center
npm test -- --runInBand src/shared/dto/token-request.dto.spec.ts
npm run typecheck
git add src/types.ts src/shared/dto/token-request.dto.ts src/shared/dto/token-request.dto.spec.ts
git commit -m "feat: require environment in token requests"

cd C:\Codes\apic\api-shared-services
npm run typecheck
git add src/types.ts
git commit -m "feat: expose APICenter environment type"
```

## Task 2: Update SDK Runtime Contract

**Files:**
- Modify: `api-shared-services/src/TribeClient.ts`
- Modify: `api-shared-services/tests/TribeClient.auth.test.ts`
- Modify: `api-shared-services/tests/TribeClient.shared-services.test.ts`
- Modify: `api-shared-services/tests/fixtures/tribe-client.ts` and every `tests/TribeClient*.test.ts` fixture/helper that constructs `TribeClient`
- Modify: SDK README and consumer examples in the same slice so examples compile with the required `environment`

- [x] **Step 1: Write failing SDK tests**

Add tests that constructor validation fails without `environment`, and `authenticate()` posts environment and source service ID.

```ts
it("throws when environment is missing", () => {
  expect(
    () =>
      new TribeClient({
        gatewayUrl: "https://api-center.itsandbox.site",
        tribeId: "church-donations",
        secret: "secret",
      } as any),
  ).toThrow("APICenter environment is required");
});

it("sends environment during authentication", async () => {
  const client = new TribeClient({
    gatewayUrl: "https://api-center.itsandbox.site",
    environment: "test",
    tribeId: "church-donations",
    sourceServiceId: "church-donations",
    secret: "secret",
  });

  await client.authenticate();

  expect(post).toHaveBeenCalledWith("/api/v1/auth/token", {
    tribeId: "church-donations",
    sourceServiceId: "church-donations",
    environment: "test",
    secret: "secret",
  });
});
```

- [x] **Step 2: Run failing SDK tests**

```powershell
cd C:\Codes\apic\api-shared-services
npm test -- tests/TribeClient.auth.test.ts
```

Expected: FAIL because `TribeClientOptions.environment` is not implemented.

- [x] **Step 3: Implement SDK option and header**

In `TribeClient.ts`:

```ts
import type { ApicenterEnvironment } from "./types";

const VALID_APICENTER_ENVIRONMENTS = new Set(["test", "live"]);

export interface TribeClientOptions {
  gatewayUrl: string;
  environment: ApicenterEnvironment;
  tribeId: string;
  secret: string;
  sourceServiceId?: string;
  timeout?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  correlationIdFactory?: () => string;
  discoveryCacheTtlMs?: number;
}
```

Add field and constructor validation:

```ts
private readonly environment: ApicenterEnvironment;

if (!options.environment || !VALID_APICENTER_ENVIRONMENTS.has(options.environment)) {
  throw new TribeClientError("APICenter environment is required and must be one of: test, live");
}
this.environment = options.environment;
```

Add header:

```ts
"X-APICenter-Environment": options.environment,
```

Update token request:

```ts
const response = await this.http.post("/api/v1/auth/token", {
  tribeId: this.tribeId,
  sourceServiceId: this.sourceServiceId,
  environment: this.environment,
  secret: this.secret,
});
```

- [x] **Step 4: Verify SDK**

```powershell
cd C:\Codes\apic\api-shared-services
npm run typecheck
npm test -- tests/TribeClient*.test.ts
npm run build
npm run pack:check
```

Expected: all pass.

- [x] **Step 5: Commit SDK slice**

```powershell
cd C:\Codes\apic\api-shared-services
git add src/TribeClient.ts src/types.ts tests/TribeClient.auth.test.ts tests/TribeClient.shared-services.test.ts
git commit -m "feat: require APICenter environment in SDK"
```

## Task 3: Add Environment Claims To Token Issuance

**Files:**
- Modify: `api-center/src/auth/auth-provider.interface.ts`
- Modify: `api-center/src/auth/auth.service.ts`
- Modify: `api-center/src/auth/auth.controller.ts`
- Modify: `api-center/src/auth/internal-jwt.provider.ts`
- Modify: `api-center/src/auth/dev-jwt.provider.ts`
- Modify: related auth specs

- [x] **Step 1: Write failing auth controller test**

Add a test proving the token response and `issueTribeToken` context include `environment` and `sourceServiceId`.

```ts
expect(auth.issueTribeToken).toHaveBeenCalledWith(
  "church-donations",
  expect.any(Array),
  expect.any(Array),
  expect.objectContaining({ environment: "test", sourceServiceId: "church-donations" }),
);
expect(result.data).toEqual(
  expect.objectContaining({ tribeId: "church-donations", sourceServiceId: "church-donations", environment: "test" }),
);
```

- [x] **Step 2: Run failing auth tests**

```powershell
cd C:\Codes\apic\api-center
npm test -- --runInBand src/auth/auth.controller.spec.ts src/auth/auth.service.spec.ts
```

Expected: FAIL because auth context is not passed yet.

- [x] **Step 3: Add token issue context**

In `auth-provider.interface.ts`:

```ts
export interface JwtClaims {
  sub: string;
  tribeId?: string;
  sourceServiceId?: string;
  environment?: ServiceEnvironmentKey;
  permissions?: string[];
  scopes?: string[];
  exp?: number;
  [key: string]: unknown;
}

export interface TokenIssueContext {
  tribeId?: string;
  sourceServiceId?: string;
  environment?: ServiceEnvironmentKey;
}
```

Update provider method signatures to accept optional `context?: TokenIssueContext`.

- [x] **Step 4: Pass context through AuthService and refresh-token storage**

```ts
async issueTribeToken(
  tribeId: string,
  permissions: string[] = [],
  scopes: string[] = [],
  context: TokenIssueContext,
): Promise<IssuedToken> {
  if (!context.environment) throw new ValidationError("environment is required");
  const sourceServiceId = context.sourceServiceId ?? tribeId;
  return this.issueToken(tribeId, permissions, scopes, { ...context, tribeId, sourceServiceId });
}
```

Persist `environment`, `tribeId`, and `sourceServiceId` with refresh token metadata. This is mandatory: refreshing a `test` token must produce another `test` token and must never depend on request-body defaults, server deployment defaults, or legacy fallback. Extend `RefreshTokenRecord` with typed `environment: ApicenterRuntimeEnvironment` and `sourceServiceId: string`.

Add refresh tests proving a `test` refresh token mints a `test` access token and a `live` refresh token mints a `live` access token.

- [x] **Step 5: Sign claims in JWT providers**

In internal/dev JWT providers, include:

```ts
{
  sub: serviceId,
  tribeId: context?.tribeId ?? serviceId,
  sourceServiceId: context?.sourceServiceId,
  environment: context?.environment,
  permissions,
  scopes,
}
```

- [x] **Step 6: Validate source service ownership before issuing tokens**

Before issuing a token, API Center must prove `sourceServiceId` is safe to put into token claims:

```ts
const sourceServiceId = dto.sourceServiceId ?? tribeId;
const sourceService = this.registry.get(sourceServiceId);
if (!sourceService) {
  throw new UnauthorizedError(`Unknown source service: ${sourceServiceId}`);
}
if ((sourceService.ownerTribeId ?? sourceService.serviceId) !== tribeId) {
  throw new ForbiddenError(`Source service '${sourceServiceId}' is not owned by tribe '${tribeId}'`);
}
const sourceEnvironment = sourceService.environments?.find((row) => row.environment === environment);
if (!sourceEnvironment || sourceEnvironment.status !== "active") {
  throw new ForbiddenError(`Source service '${sourceServiceId}' is not active in ${environment}`);
}
```

Add tests for unknown source service, wrong owner tribe, and inactive/missing source environment.

- [x] **Step 7: Update AuthController**

```ts
const { tribeId, secret, environment, sourceServiceId } = dto;
const isValid = await this.registry.validateSecret(tribeId, secret, environment);
...
const token = await this.auth.issueTribeToken(tribeId, permissions, scopes, {
  environment,
  sourceServiceId: sourceServiceId ?? tribeId,
});
```

Return `environment` and `sourceServiceId` in the response data and token-issued event payload.

- [x] **Step 7A: Attach source-service context in JwtAuthGuard**

Extend `AuthenticatedRequest` with `sourceServiceId?: string` and set it from validated claims:

```ts
req.tribeId = claims.tribeId ?? claims.sub;
req.sourceServiceId = claims.sourceServiceId ?? req.tribeId;
req.user = claims;
```

All downstream proxy, usage, quota, audit, and shared-service code must use `req.sourceServiceId` as the calling service identity and `req.tribeId` as the owner/quota identity. Add guard tests that a token with `tribeId=church-donations` and `sourceServiceId=church-api` exposes both values distinctly.

- [x] **Step 8: Verify and commit**

```powershell
cd C:\Codes\apic\api-center
npm test -- --runInBand src/auth/auth.controller.spec.ts src/auth/auth.service.spec.ts src/auth/internal-jwt.provider.spec.ts src/auth/dev-jwt.provider.spec.ts
npm run typecheck
git add src/auth src/shared/dto/token-request.dto.ts src/types.ts
git commit -m "feat: issue environment-scoped APICenter tokens"
```

## Task 4: Resolve Tribe Secrets By Environment

**Files:**
- Create: `api-center/src/registry/environment-secret-name.ts`
- Modify: `api-center/src/registry/tribe-secret-resolver.service.ts`
- Modify: `api-center/src/registry/registry.service.ts`
- Modify: resolver and registry specs

- [x] **Step 1: Write failing resolver tests**

Add an explicit cache regression test: resolve `church-donations` in `test`, then resolve `church-donations` in `live`, and assert two different Secret Manager resource names are read or cached under two different keys.

Add tests expecting `church-donations` test auth to read:

```text
projects/<project>/secrets/api-center-tribe-secret-church-donations-test/versions/latest
```

and reject a live secret submitted for `environment=test`.

- [x] **Step 2: Run failing resolver tests**

```powershell
cd C:\Codes\apic\api-center
npm test -- --runInBand src/registry/tribe-secret-resolver.service.spec.ts
```

Expected: FAIL because resolver only accepts `serviceId`.

- [x] **Step 3: Create secret-name helper**

```ts
import { ServiceEnvironmentKey } from "../types";

const DEFAULT_SECRET_PREFIX = "api-center-tribe-secret-";

export function buildEnvironmentSecretId(
  tribeId: string,
  environment: ServiceEnvironmentKey,
  prefix = process.env.TRIBE_SECRET_GCP_PREFIX || DEFAULT_SECRET_PREFIX,
): string {
  const normalized = tribeId.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(normalized)) {
    throw new Error(`Invalid tribeId for Secret Manager lookup: ${tribeId}`);
  }
  return `${prefix}${normalized}-${environment}`;
}
```

- [x] **Step 4: Update resolver signatures**

```ts
async validateEnvironmentSecret(tribeId: string, secret: string, environment: ApicenterRuntimeEnvironment): Promise<boolean>
async resolveEnvironmentSecretHash(tribeId: string, environment: ApicenterRuntimeEnvironment): Promise<string | null>
async validateLegacySecret(tribeId: string, secret: string): Promise<boolean>
```

The environment-scoped API must require `environment` and must never fall back to the legacy secret. Legacy validation is a separate warn-mode path that runs only after allowlist and explicit `APICENTER_LEGACY_ENVIRONMENT_MAP` checks pass. Secret resolver cache keys must include environment, for example `<tribeId>:<environment>`, so a test hash and live hash can never share one cache entry. Secret Manager JSON payloads must include `tribeId` and `environment`, and resolver tests must reject a payload whose environment does not match the requested environment.

- [x] **Step 5: Update RegistryService**

```ts
validateEnvironmentSecret(tribeId: string, secret: string, environment: ApicenterRuntimeEnvironment): Promise<boolean> {
  return this.tribeSecretResolver.validateEnvironmentSecret(tribeId, secret, environment);
}

validateLegacySecret(tribeId: string, secret: string): Promise<boolean> {
  return this.tribeSecretResolver.validateLegacySecret(tribeId, secret);
}
```

- [x] **Step 6: Verify and commit**

```powershell
cd C:\Codes\apic\api-center
npm test -- --runInBand src/registry/tribe-secret-resolver.service.spec.ts src/registry/registry.service.spec.ts src/auth/auth.controller.spec.ts
npm run typecheck
git add src/registry src/auth/auth.controller.ts src/auth/auth.controller.spec.ts
git commit -m "feat: resolve tribe secrets by environment"
```

## Task 5: Block Cross-Environment Runtime Leaks

**Files:**
- Create: `api-center/src/shared/proxy/environment-leak-guard.ts`
- Create: `api-center/src/shared/proxy/environment-leak-guard.spec.ts`
- Modify: `api-center/src/shared/proxy-handler.ts`
- Modify: `api-center/src/shared/proxy-handler.spec.ts`
- Modify: circuit-breaker, health, and emergency-route helpers that cache or decide by target service

- [x] **Step 1: Write leak guard tests**

Test cases:

```ts
expect(enforceEnvironmentAccess({ callerEnvironment: "test", target })).toMatchObject({ environment: "test" });
expect(() => enforceEnvironmentAccess({ callerEnvironment: undefined, target })).toThrow("APICenter token is missing environment");
expect(() => enforceEnvironmentAccess({ callerEnvironment: "staging" as any, target })).toThrow("APICenter token environment is invalid");
```

Add proxy tests proving all caller-controlled environment selectors are rejected or stripped before routing:

```ts
expect(() => proxyWith({ tokenEnvironment: "test", headers: { "x-apicenter-target-environment": "live" } }))
  .toThrow("Environment override headers are not allowed");
expect(() => proxyWith({ tokenEnvironment: undefined })).toThrow("APICenter token is missing environment");
```

- [x] **Step 2: Implement guard**

Runtime routing must derive from the validated token claim only. Do not accept `requestedEnvironment`, query params, body params, service URL inference, deployment env, or `X-APICenter-Target-Environment`.

```ts
export function enforceEnvironmentAccess(input: {
  callerEnvironment?: string;
  target: { serviceId: string; environments?: Array<{ environment: ApicenterRuntimeEnvironment; baseUrl: string; status?: string }> };
}) {
  if (input.callerEnvironment !== "test" && input.callerEnvironment !== "live") {
    throw new ForbiddenError("APICenter token is missing environment");
  }
  const record = input.target.environments?.find((env) => env.environment === input.callerEnvironment);
  if (!record?.baseUrl) {
    throw new ServiceUnavailableError(`Service '${input.target.serviceId}' has no ${input.callerEnvironment} runtime URL`);
  }
  if (record.status && record.status !== "active") {
    throw new ServiceUnavailableError(`Service '${input.target.serviceId}' ${input.callerEnvironment} environment is ${record.status}`);
  }
  return record;
}
```

- [x] **Step 3: Wire proxy handler**

Use `req.user.environment` to select the target environment before creating proxy middleware. Cache proxy middleware by `${serviceId}:${environment}`. Strip any inbound `X-APICenter-*` identity headers from the caller before forwarding. Record `environment`, `tribeId`, and `sourceServiceId` on `ServiceCallObservation`.

- [x] **Step 4: Key runtime state by target environment**

Circuit breakers, route health, proxy cache, emergency disablement, smoke-test status, and route telemetry must be keyed by `targetServiceId + environment`. A test failure must never open or disable a live route. Registry invalidation should clear all environment entries for the changed service.

- [x] **Step 5: Verify and commit**

```powershell
cd C:\Codes\apic\api-center
npm test -- --runInBand src/shared/proxy/environment-leak-guard.spec.ts src/shared/proxy-handler.spec.ts src/shared/proxy/proxy-auth-context.spec.ts src/shared/proxy/proxy-quota-context.spec.ts
npm run typecheck
git add src/shared/proxy src/shared/proxy-handler.ts src/shared/proxy-handler.spec.ts
git commit -m "feat: block cross-environment proxy leaks"
```

## Task 6: Route Shared Services By Environment

**Files:**
- Create: `api-center/src/shared-services/shared-service-routing.service.ts`
- Create: `api-center/src/shared-services/shared-service-routing.service.spec.ts`
- Modify: `api-center/src/shared-services/shared-services.module.ts`
- Modify: `api-center/src/shared/proxy-handler.ts`
- Modify: `api-shared-services/docs/shared-service-runtime-deployment-matrix.md`

- [x] **Step 1: Write routing tests**

```ts
describe("SharedServiceRoutingService", () => {
  it("resolves payment test and live targets", () => {
    const service = new SharedServiceRoutingService({
      SHARED_SERVICE_ROUTE_PAYMENT_TEST: "http://payment-test:4010",
      SHARED_SERVICE_ROUTE_PAYMENT_LIVE: "http://payment-live:4010",
    } as any);

    expect(service.resolve("payment", "test").targetUrl).toBe("http://payment-test:4010");
    expect(service.resolve("payment", "live").targetUrl).toBe("http://payment-live:4010");
  });

  it("throws when live payment route is missing", () => {
    const service = new SharedServiceRoutingService({ SHARED_SERVICE_ROUTE_PAYMENT_TEST: "http://payment-test:4010" } as any);
    expect(() => service.resolve("payment", "live")).toThrow("Missing shared-service route");
  });
});
```

- [x] **Step 2: Implement routing service**

```ts
@Injectable()
export class SharedServiceRoutingService {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  resolve(sharedServiceId: string, environment: ApicenterRuntimeEnvironment) {
    const key = `SHARED_SERVICE_ROUTE_${sharedServiceId}_${environment}`.toUpperCase().replaceAll("-", "_");
    const targetUrl = this.env[key]?.trim();
    if (!targetUrl) {
      throw new ServiceUnavailableError(`Missing shared-service route ${key} for ${sharedServiceId} ${environment}`);
    }
    return { sharedServiceId, environment, targetUrl };
  }
}
```

- [x] **Step 3: Wire shared proxy path and trusted identity headers**

When `ProxyHandler` handles namespace `shared`, resolve target URL from `SharedServiceRoutingService.resolve(serviceId, callerEnvironment)` while still using registry metadata for authorization, scopes, lifecycle, and `consumes`.

Before forwarding, strip all caller-supplied `X-APICenter-*`, `X-Tribe-Id`, and source identity headers, then inject authoritative headers from validated claims only:

```text
X-APICenter-Environment: <req.user.environment>
X-APICenter-Source-Service-Id: <req.sourceServiceId>
X-Tribe-Id: <req.tribeId>
X-APICenter-Correlation-Id: <req.correlationId>
```

Add shared-service proxy tests proving same-runtime services receive distinct `test` and `live` context and that spoofed caller headers are overwritten or rejected.

- [x] **Step 4: Document runtime env vars**

Add to `shared-service-runtime-deployment-matrix.md`:

```env
SHARED_SERVICE_ROUTE_PAYMENT_TEST=http://payment-test.api-center.svc.cluster.local:4010
SHARED_SERVICE_ROUTE_PAYMENT_LIVE=http://payment-live.api-center.svc.cluster.local:4010
SHARED_SERVICE_ROUTE_EMAIL_TEST=http://email.api-center.svc.cluster.local:4012
SHARED_SERVICE_ROUTE_EMAIL_LIVE=http://email.api-center.svc.cluster.local:4012
SHARED_SERVICE_ROUTE_SMS_TEST=http://sms.api-center.svc.cluster.local:4011
SHARED_SERVICE_ROUTE_SMS_LIVE=http://sms.api-center.svc.cluster.local:4011
SHARED_SERVICE_ROUTE_OTP_TEST=http://otp.api-center.svc.cluster.local:4014
SHARED_SERVICE_ROUTE_OTP_LIVE=http://otp.api-center.svc.cluster.local:4014
SHARED_SERVICE_ROUTE_GAUTH_TEST=http://gauth.api-center.svc.cluster.local:4013
SHARED_SERVICE_ROUTE_GAUTH_LIVE=http://gauth.api-center.svc.cluster.local:4013
SHARED_SERVICE_ROUTE_GEO_TEST=http://geo.api-center.svc.cluster.local:4015
SHARED_SERVICE_ROUTE_GEO_LIVE=http://geo.api-center.svc.cluster.local:4015
```

For this phase, only payment has separate test/live runtimes. Email, SMS, OTP, Google auth, and geo deliberately point test/live route variables at the same runtime while APICenter still injects and records `environment` on every call. Split another runtime only when provider credentials, cost, compliance, or side effects justify it.

The env-var routing table is phase 1 only. Add a follow-up durable route table to the database plan so Management can audit, approve, and roll back route changes:

```text
apic_catalog.shared_service_runtime_routes
  shared_service_id
  environment
  target_url
  status
  version
  approval_id
  created_at
  updated_at
```

- [x] **Step 5: Verify and commit**

```powershell
cd C:\Codes\apic\api-center
npm test -- --runInBand src/shared-services/shared-service-routing.service.spec.ts src/shared-services/shared-services.controller.spec.ts src/shared/proxy-handler.spec.ts
npm run typecheck
git add src/shared-services src/shared/proxy-handler.ts src/shared/proxy-handler.spec.ts
git commit -m "feat: route shared services by environment"

cd C:\Codes\apic\api-shared-services
git add docs/shared-service-runtime-deployment-matrix.md
git commit -m "docs: document environment-scoped shared-service routes"
```

## Task 6A: Route Payment Webhooks By Environment

**Files:**
- Modify: `api-center/src/shared-services/payment-webhook.controller.ts`
- Modify: `api-center/src/shared-services/payment-webhook.controller.spec.ts`
- Modify: `api-shared-services/shared-services/paymongo/src/routes/paymongo.routes.js`
- Modify: `api-shared-services/shared-services/paymongo/src/services/paymongo/webhookService.js`
- Modify: `api-shared-services/tests/shared-services/paymongo-webhooks.test.ts`

- [x] **Step 1: Add webhook environment tests**

Payment webhooks are signature-authenticated provider callbacks, not APICenter bearer-token calls, so the environment contract must be deterministic before persistence or event publishing.

Use explicit environment-scoped webhook routes:

```text
POST /api/v1/shared/payment/webhooks/test
POST /api/v1/shared/payment/webhooks/live
```

Add tests proving PayMongo test webhooks resolve to `environment=test`, live webhooks resolve to `environment=live`, and mismatched signatures are rejected before persistence or event publishing.

```ts
expect(result.environment).toBe("test");
expect(providerEventKey).toEqual(expect.objectContaining({ environment: "test" }));
```

- [x] **Step 2: Split webhook secret resolution**

Webhook verification must use environment-specific provider secrets. Each route verifies only its matching secret:

```text
PAYMONGO_TEST_WEBHOOK_SECRET -> /webhooks/test -> environment=test
PAYMONGO_LIVE_WEBHOOK_SECRET -> /webhooks/live -> environment=live
```

Do not infer environment from payload amount, service ID, provider mode, or generic URL path. If a provider later forces one callback URL, implement a separate dual-secret matcher that rejects ambiguous matches and persists nothing until exactly one environment is resolved.

- [x] **Step 3: Make webhook idempotency environment-aware**

Payment webhook idempotency must include environment:

```text
environment + provider + provider_event_id
```

A test provider event and a live provider event with the same provider ID must not collide.

- [x] **Step 4: Forward authoritative environment to payment runtime**

The API Center webhook controller must resolve the payment runtime through `SharedServiceRoutingService.resolve("payment", environment)`, inject `X-APICenter-Environment`, and reject missing payment routes before provider persistence.

- [x] **Step 5: Verify and commit webhook routing**

```powershell
cd C:\Codes\apic\api-center
npm test -- --runInBand src/shared-services/payment-webhook.controller.spec.ts
npm run typecheck
git add src/shared-services/payment-webhook.controller.ts src/shared-services/payment-webhook.controller.spec.ts
git commit -m "feat: route payment webhooks by environment"

cd C:\Codes\apic\api-shared-services
npm test -- tests/shared-services/paymongo-webhooks.test.ts
git add shared-services/paymongo/src/routes/paymongo.routes.js shared-services/paymongo/src/services/paymongo/webhookService.js tests/shared-services/paymongo-webhooks.test.ts
git commit -m "feat: persist payment webhooks by environment"
```

## Task 7: Track Environment In Audit, Usage, Quota, And Evidence

**Files:**
- Modify: `api-center/src/analytics/gateway-traffic.service.ts`
- Modify: `api-center/src/analytics/shared-service-usage.service.ts`
- Modify: `api-center/src/quotas/tribe-quota-enforcer.service.ts`
- Modify: `api-center/src/policy/policy-engine.service.ts`
- Modify: `api-center/src/operations/promotion-evidence-bundle.service.ts`
- Modify: matching specs

- [x] **Step 1: Add focused tests**

Add assertions that every durable or rollup record includes environment:

```ts
expect(observation.environment).toBe("test");
expect(observation.rollup_key).toContain("church-donations:test:payment");
expect(quotaDecision).toEqual(expect.objectContaining({ environment: "test" }));
```

Promotion evidence for live must include:

```ts
expect(bundle).toEqual(
  expect.objectContaining({
    serviceId: "church-donations",
    sourceEnvironment: "test",
    targetEnvironment: "live",
  }),
);
```

- [x] **Step 2: Use one rollup key shape**

```ts
const rollupKey = [
  input.source_service_id,
  input.environment,
  input.shared_service_id ?? input.target_service_id ?? input.target_type,
  input.route_family,
].join(":");
```

- [x] **Step 3: Ensure required audit events include environment**

Required audit events should carry:

```ts
{
  serviceId,
  sourceServiceId,
  tribeId,
  environment,
  sharedServiceId,
  quotaEvaluationId,
  promotionEvidenceId,
}
```

- [x] **Step 4: Verify and commit**

```powershell
cd C:\Codes\apic\api-center
npm test -- --runInBand src/analytics/audit-events.service.spec.ts src/analytics/gateway-traffic.service.spec.ts src/analytics/shared-service-usage.service.spec.ts src/operations/promotion-evidence-bundle.service.spec.ts src/quotas/tribe-quota-enforcer.service.spec.ts src/policy/policy-engine.service.spec.ts
npm run typecheck
git add src/analytics src/operations src/quotas src/policy
git commit -m "feat: track runtime evidence by environment"
```

## Task 7A: Add Database Environment Columns, Constraints, And Clean Views

**Files:**
- Create: `api-center/supabase/migrations/<generated>_add_environment_runtime_constraints.sql`
- Modify: `api-center/prisma/schema.prisma`
- Modify: `api-shared-services/supabase/migrations/<generated>_add_shared_payment_environment_views.sql`
- Modify: `api-shared-services/prisma/shared-services/schema.prisma`
- Modify: `api-center/docs/database-control-plane.md`
- Modify: `api-shared-services/docs/shared-service-database-schemas.md`
- Modify or create DB verification scripts that check roles, exposed schemas, grants, constraints, and missing environment defaults

- [x] **Step 1: Write the database rule into docs first**

Add this rule to both database docs:

```text
Environment is a required row attribute, not a schema boundary and not a defaulted value. Use owner/domain schemas such as apic_runtime and shared_payment, add an explicit environment column where records differ by test/live, enforce composite uniqueness that includes environment, and expose clean test/live views only for operator readability. Application code must supply environment on every write; database and Prisma defaults must not silently classify rows as test.
```

- [x] **Step 2: Preflight runtime roles and Supabase exposure before migrations**

Before applying or dry-running migrations in test or live, discover and verify the real runtime DB roles. The migration must not fail halfway because `api_center_app` or the shared-services app role is missing.

```sql
select rolname, rolinherit, rolcanlogin
from pg_roles
where rolname in ('api_center_app', 'shared_services_app');
```

If a required app role is missing in test, create the non-login grant role before migration:

```sql
create role api_center_app nologin inherit;
```

For live, role creation must be an explicit reviewed operation recorded in the migration inventory. Add grants and default privileges for all new tables/views in the same migration slice.

Add a verification gate that checks Supabase Data API exposed schemas remain private. If any `apic_*`, `api_center*`, or `shared_*` schema is exposed to browser clients, require RLS on every exposed table plus ownership and environment predicates before any `anon` or `authenticated` grant.

- [x] **Step 3: Add a table-by-table environment constraint matrix**

Document every existing and planned environment-bearing table before writing DDL. At minimum cover:

```text
apic_catalog.service_environments: environment check test|live after inventory/migration decision
apic_governance.approval_requests: target_environment check test|live
apic_governance.entitlement_assignments: environment check test|live
apic_governance.promotion_evidence_bundles or apic_audit.evidence_snapshots: source_environment + target_environment check test|live
apic_runtime.event_topic_onboarding_states: environment check test|live or explicit pipeline-lane mapping
apic_runtime.pipeline_feedback_actions: environment check test|live or explicit pipeline-lane mapping
apic_runtime.usage_rollups: environment check test|live
apic_runtime.quota_evaluations: environment check test|live
apic_runtime.health_snapshots: environment check test|live
apic_runtime.smoke_test_runs: environment check test|live
apic_catalog.shared_service_runtime_routes: environment check test|live
apic_audit.audit_events: first-class environment/source_service_id/correlation_id query path
shared_payment.* provider tables: environment check test|live with provider_mode consistency
```

If any existing table still uses `prod`, Task 7B must either map `live -> prod` at pipeline boundaries or migrate those rows/assets to `live`; do not mix vocabularies without a named mapping.

- [x] **Step 4: Add APIC control-plane migration**

Create the migration with the repo script:

```powershell
cd C:\Codes\apic\api-center
npm run db:migration:new -- add_environment_runtime_constraints
```

Use real current table names. The current control-plane rollup table is `apic_runtime.usage_rollups`, not `apic_runtime.shared_service_usage_rollups`.

The SQL must follow this shape for each affected table:

```sql
alter table apic_runtime.usage_rollups
  add column if not exists environment text;

-- Backfill from verified inventory before enforcing not null.
-- Replace this with Task 0's checked source-service/environment mapping.
update apic_runtime.usage_rollups rollup
set environment = inventory.environment
from apic_runtime.environment_backfill_inventory inventory
where inventory.service_id = rollup.consumer_service_id
  and rollup.environment is null;

-- Do not set a default. Missing environment must fail after enforcement.
alter table apic_runtime.usage_rollups
  alter column environment set not null,
  add constraint usage_rollups_environment_check
    check (environment in ('test', 'live'));

create index if not exists usage_rollups_environment_window_idx
  on apic_runtime.usage_rollups (environment, window_start desc);

create unique index if not exists usage_rollups_env_service_target_window_uidx
  on apic_runtime.usage_rollups (environment, consumer_service_id, target_service_id, route_family, window_start);
```

For audit/evidence queries, prefer first-class columns and indexes over JSON-only metadata where exports require `serviceId + environment + correlationId`:

```sql
create index if not exists audit_events_env_resource_correlation_idx
  on apic_audit.audit_events (environment, resource_type, resource_id, correlation_id, created_at desc);
```

If a table cannot receive first-class columns in this slice, document the exception and add a follow-up before compliance export is marked durable.

- [x] **Step 5: Add clean APIC views only where useful**

Use views for operator readability, not separate schemas, and keep Supabase-safe security posture:

```sql
create or replace view apic_runtime.live_usage_rollups
with (security_invoker = true) as
select * from apic_runtime.usage_rollups
where environment = 'live';

create or replace view apic_runtime.test_usage_rollups
with (security_invoker = true) as
select * from apic_runtime.usage_rollups
where environment = 'test';

revoke all on apic_runtime.live_usage_rollups from public;
revoke all on apic_runtime.test_usage_rollups from public;
grant select on apic_runtime.live_usage_rollups to api_center_app;
grant select on apic_runtime.test_usage_rollups to api_center_app;
```

Do not give browser clients direct table or view access unless RLS and grants are explicitly reviewed.

- [x] **Step 6: Add shared payment environment constraints and views**

Create the shared-services migration with its repo script:

```powershell
cd C:\Codes\apic\api-shared-services
npm run db:shared:migration:new -- add_shared_payment_environment_views
```

Payment tables should use `environment` as a required column and include it in provider uniqueness. Existing records must be classified from provider mode, webhook secret, API key family, or Task 0 inventory before `not null` is enforced.

Add a shared-payment matrix for every existing payment table, including checkout sessions, payments, refunds, customers, products, prices, subscriptions, subscription events, invoices, receipts, webhook events, and idempotency records. For each table record:

```text
table name
backfill source
whether environment is direct or inherited from parent row
provider_mode mapping: provider_mode='test' -> environment='test', provider_mode='live' -> environment='live'
consistency check between provider_mode and environment
unique indexes that must include environment
retention/minimization rule
```

Example shape:

```sql
alter table shared_payment.checkout_sessions
  add column if not exists environment text;

update shared_payment.checkout_sessions session
set environment = case
  when session.provider_mode = 'test' then 'test'
  when session.provider_mode = 'live' then 'live'
end
where session.environment is null;

alter table shared_payment.checkout_sessions
  alter column environment set not null,
  add constraint checkout_sessions_environment_check
    check (environment in ('test', 'live')),
  add constraint checkout_sessions_provider_mode_environment_check
    check ((provider_mode = 'test' and environment = 'test') or (provider_mode = 'live' and environment = 'live'));

create unique index if not exists checkout_sessions_env_provider_checkout_uidx
  on shared_payment.checkout_sessions (environment, provider, provider_checkout_id);

create or replace view shared_payment.live_checkout_sessions
with (security_invoker = true) as
select * from shared_payment.checkout_sessions
where environment = 'live';
```

Do not store raw provider secrets or full webhook payloads unless explicitly approved. Add retention comments for checkout/payment records, webhook/idempotency rows, provider metadata, and audit evidence.

- [x] **Step 7: Update Prisma models**

Add required `environment String` fields to affected models and update unique/index declarations so environment is included where test/live can share provider IDs. Do not use `@default("test")` on runtime/provider tables.

Example model shape:

```prisma
model SharedPaymentCheckoutSession {
  id                 String   @id @default(uuid())
  environment        String
  provider           String
  providerMode       String   @map("provider_mode")
  providerCheckoutId String
  serviceId          String
  tribeId            String
  status             String
  createdAt          DateTime @default(now())

  @@unique([environment, provider, providerCheckoutId])
  @@index([environment, serviceId, createdAt])
}
```

- [x] **Step 8: Verify database migration dry runs**

```powershell
cd C:\Codes\apic\api-center
npm run db:validate
npm run db:migration:push:dry
npm run db:verify:control-plane -- --app-role <discovered_app_role>

cd C:\Codes\apic\api-shared-services
npm run db:shared:validate
npm run db:shared:migration:push:dry
```

Expected: migrations add columns/indexes/views without creating `*_test` or `*_live` schemas, without DB defaults for environment, and without exposing private schemas to `anon` or `authenticated`.

Add verification SQL that fails if any runtime/provider environment column has a default:

```sql
select table_schema, table_name, column_name, column_default
from information_schema.columns
where column_name in ('environment', 'target_environment', 'source_environment')
  and column_default is not null
  and table_schema in ('apic_catalog', 'apic_governance', 'apic_runtime', 'apic_audit', 'shared_payment');
```

- [x] **Step 9: Commit database slice**

```powershell
cd C:\Codes\apic\api-center
git add supabase/migrations prisma/schema.prisma docs/database-control-plane.md
git commit -m "feat: add environment constraints to runtime data"

cd C:\Codes\apic\api-shared-services
git add supabase/migrations prisma/shared-services/schema.prisma docs/shared-service-database-schemas.md
git commit -m "feat: add environment constraints to shared payment data"
```

## Task 7B: Isolate Event And Data-Pipeline Outputs By Environment

**Files:**
- Modify: `api-center/src/shared-services/shared-service-event-publisher.ts`
- Modify: `api-center/src/data-pipeline/*`
- Modify: `api-center/docs/data-pipeline/tribe-event-contract.md`
- Modify: related data-pipeline and event publisher specs

- [x] **Step 1: Add event environment tests**

Event publishing tests must assert environment is present in every platform event envelope:

```ts
expect(publishedEvent).toEqual(expect.objectContaining({ environment: "test" }));
```

- [x] **Step 2: Define `live` versus `prod` pipeline lane mapping**

The runtime contract uses `test|live`, while existing data-pipeline code and historical records may use `test|prod`. Choose one of these before implementing exports:

```text
Option A: runtime live maps to physical pipeline lane prod.
Option B: migrate all pipeline topics, S3 prefixes, Athena views, schema registry records, docs, and DB rows from prod to live.
```

For phase 1, prefer Option A if existing Athena/S3 assets are still named `prod`; add tests at publish/export/read boundaries proving `environment=live` in runtime evidence maps to `prod` only at the physical pipeline adapter boundary and never leaks back into API/Management contracts.

- [x] **Step 3: Add export partition rules**

Data-pipeline exports must partition or tag records by environment:

```text
tribe_id=<tribeId>/environment=<test|live>/event_date=<yyyy-mm-dd>/...
```

Test events must never write to live export prefixes, live Athena views, or live BI datasets.

- [x] **Step 4: Add leak guard for event publishing**

If token environment is `test`, event publish requests must emit `environment=test` and must be blocked from selecting a live topic/export target. If token environment is `live`, event publish requests must emit `environment=live`.

- [x] **Step 5: Verify and commit data-pipeline isolation**

```powershell
cd C:\Codes\apic\api-center
npm test -- --runInBand src/shared-services/shared-service-event-publisher.spec.ts src/data-pipeline/event-schema-registry.service.spec.ts
npm run typecheck
git add src/shared-services/shared-service-event-publisher.ts src/data-pipeline docs/data-pipeline/tribe-event-contract.md
git commit -m "feat: isolate event exports by environment"
```

## Task 8: Update Management For Environment-Scoped Operations

**Files:**
- Modify: `apicenter-management/src/lib/schemas.ts`
- Modify: `apicenter-management/src/app/api/local/tribe-secrets/route.ts`
- Modify: `apicenter-management/src/app/api/local/tribe-secrets/[serviceId]/route.ts`
- Modify: `apicenter-management/src/lib/server/require-management-action.ts` or equivalent action authorization helper
- Modify: `apicenter-management/src/lib/server/action-policy.ts`, action confirmation, and audit helpers that decide write risk
- Modify: `apicenter-management/src/components/sdk-config-panel.tsx`
- Modify: `apicenter-management/src/components/service-detail/environment-section.tsx`
- Modify: related tests

- [x] **Step 1: Add schema, route, action-policy, and audit tests**

Secret provisioning must require `tribeId`, `sourceServiceId`, and `environment`, and produce secret IDs from `tribeId`:

```text
api-center-tribe-secret-church-donations-test
api-center-tribe-secret-church-donations-live
```

Add tests proving target-environment guardrails do not use Management deployment environment:

```ts
expect(liveSecretRotationWith({ MANAGEMENT_ENVIRONMENT: "test", inputEnvironment: "live" }))
  .toRequireTypedPhraseAndReason();
expect(liveRouteChangeWith({ MANAGEMENT_ENVIRONMENT: "local", inputEnvironment: "live" }))
  .toRequireElevatedApproval();
```

Apply the same target-environment authorization requirement to live secret delete/rotation, shared-service route changes, quota disablement, environment disablement, payment provider actions, and break-glass actions.

- [x] **Step 2: Update schema**

```ts
tribeId: z.string().min(1),
sourceServiceId: z.string().min(1),
environment: z.enum(["test", "live"]),
```

`tribeId` / `ownerTribeId` is the secret identity. `sourceServiceId` is the registered service that will use the secret and appear in SDK handoff, token claims, audit, and usage records.

- [x] **Step 3: Update provisioning route**

Server-side action authorization must key off `input.environment`, not `MANAGEMENT_ENVIRONMENT`:

```ts
await requireManagementAction({
  environment: input.environment,
  action: "tribe-secret.provision",
  actionRisk: input.environment === "live" ? "provider-write" : "standard-write",
  typedPhrase: input.typedPhrase,
  reason: input.reason,
  session,
});

const secretId = `${prefix}${input.tribeId}-${input.environment}`;
const payload = JSON.stringify({
  tribeId: input.tribeId,
  environment: input.environment,
  provisionedForServiceIds: [input.sourceServiceId],
  sourceServiceId: input.sourceServiceId,
  secretHashSha256: input.secretHashSha256.toLowerCase(),
  status: "active",
  rotationState: "active_current",
  rotatedAt,
  auditEvidence: [...],
});
```

- [x] **Step 4: Update SDK config panel**

Show one URL with per-environment blocks. Use owner tribe ID for `APICENTER_TRIBE_ID` and registered service ID for `APICENTER_SERVICE_ID`:

```env
APICENTER_URL=https://api-center.itsandbox.site
APICENTER_ENVIRONMENT=test
APICENTER_TRIBE_ID=<owner-tribe-id>
APICENTER_SERVICE_ID=<registered-service-id>
APICENTER_TRIBE_SECRET=<test-secret-issued-by-platform>
```

```env
APICENTER_URL=https://api-center.itsandbox.site
APICENTER_ENVIRONMENT=live
APICENTER_TRIBE_ID=<owner-tribe-id>
APICENTER_SERVICE_ID=<registered-service-id>
APICENTER_TRIBE_SECRET=<live-secret-issued-by-platform>
```

- [x] **Step 5: Update service detail environment rows**

Each row should show backend URL, health, secret status, shared-service route status, quota policy, last smoke run, promotion evidence, and break-glass state.

Because the target is one Management deployment, action controls must vary by target row environment:

```text
test read/write: normal session and normal confirmation
live write: typed phrase + reason + audit event
live destructive/provider action: elevated role or approval request before execution
```

Add tests that live secret rotation, live route changes, live quota disablement, and live environment disablement require the stronger path even when `MANAGEMENT_ENVIRONMENT` is `test` or `local`.

- [x] **Step 6: Verify and commit**

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/lib/schemas.test.ts src/app/api/local/tribe-secrets/route.test.ts src/app/api/local/tribe-secrets/[serviceId]/route.test.ts src/lib/server/require-management-action.test.ts src/lib/server/action-policy.test.ts src/components/sdk-config-panel.test.tsx src/components/service-detail/environment-section.test.tsx
npm run typecheck
npm run build
git add src/lib/schemas.ts src/lib/schemas.test.ts src/app/api/local/tribe-secrets src/lib/server src/components/sdk-config-panel.tsx src/components/sdk-config-panel.test.tsx src/components/service-detail/environment-section.tsx src/components/service-detail/environment-section.test.tsx
git commit -m "feat: manage tribe secrets by environment"
```

## Task 9: Update Docs And Contracts

**Files:**
- Modify: `api-shared-services/README.md`
- Modify: `api-shared-services/docs/consumer-runbook.md`
- Modify: `api-shared-services/docs/service-manifest-automation.md`
- Modify: `api-center/docs/database-control-plane.md`
- Modify: `apicenter-management/docs/operations/apicenter-management-runbook.md`
- Modify: `api-center/docs/openapi/apicenter.openapi.json` or the generated OpenAPI artifact used by the repo
- Create or modify: `api-shared-services/contracts/apicenter-auth-token.schema.json`
- Modify: API Center and SDK contract check scripts, for example `api-center/scripts/check-contracts.*` and `api-shared-services/scripts/check-contract-compatibility.*`

- [x] **Step 1: Update consumer docs**

Document new one-URL mode:

```env
APICENTER_URL=https://api-center.itsandbox.site
APICENTER_ENVIRONMENT=test
APICENTER_TRIBE_ID=<owning-tribe-id>
APICENTER_SERVICE_ID=<registered-service-id>
APICENTER_TRIBE_SECRET=<environment-scoped-secret-issued-by-platform>
```

- [x] **Step 2: Add migration notes**

```text
Old test URL mode:
APICENTER_URL=https://api-center-test.itsandbox.site

New one-URL mode:
APICENTER_URL=https://api-center.itsandbox.site
APICENTER_ENVIRONMENT=test
```

- [x] **Step 3: Add enforceable auth-token contract checks**

Contract checks must parse the generated API Center OpenAPI/auth schema and fail unless `/api/v1/auth/token` satisfies all of these:

```text
required request fields: tribeId, secret, environment
allowed optional request field: sourceServiceId
environment enum: test, live
response fields include: accessToken, refreshToken, expiresIn, tribeId, sourceServiceId, environment, permissions, scopes
no generated SDK/client example omits APICENTER_ENVIRONMENT
```

The SDK compatibility script must compare its `apicenter-auth-token.schema.json` against the generated API Center contract, not only shared-service or manifest contracts.

- [x] **Step 4: Verify and commit docs**

```powershell
cd C:\Codes\apic
rg -n "api-center-test\.itsandbox\.site|APICENTER_ENVIRONMENT|api-center-tribe-secret-<tribe-id>" api-shared-services api-center apicenter-management --glob "*.md"

cd C:\Codes\apic\api-center
npm run openapi:generate
npm run check:contracts
git add docs scripts src/openapi docs/openapi
git commit -m "docs: record one-url environment contract"

cd C:\Codes\apic\api-shared-services
npm run check:contracts
git add README.md docs contracts scripts
git commit -m "docs: describe one-url APICenter setup"

cd C:\Codes\apic\apicenter-management
git add docs/operations/apicenter-management-runbook.md
git commit -m "docs: update environment-scoped handoff"
```

## Task 10: Rollout, Backward Compatibility, And Break Glass

**Files:**
- Modify: `api-center/.env.example`
- Modify: `api-center/config/environments/live/api-center-config.yaml`
- Modify: GKE manifests/config docs when env vars are represented there
- Modify: `apicenter-management/.env.example`
- Modify: `apicenter-management/src/lib/server/deployment-config.ts` and tests
- Modify: `apicenter-management/src/lib/feature-flags.ts` and tests
- Modify: `apicenter-management/docs/operations/apicenter-management-runbook.md`

- [x] **Step 1: Add transition flags**

```env
APICENTER_ENVIRONMENT_CONTRACT_MODE=warn
APICENTER_LEGACY_TRIBE_SECRET_FALLBACK=true
APICENTER_LEGACY_ENVIRONMENT_ALLOWLIST=smoke-tribe,logistics
APICENTER_LEGACY_ENVIRONMENT_MAP=smoke-tribe:test,logistics:test
```

Mode behavior:

```text
warn: accepts legacy token requests only for allowlisted services with explicit entries in `APICENTER_LEGACY_ENVIRONMENT_MAP`, and records audit warnings.
enforce: rejects missing environment and requires environment-scoped secrets.
```

- [x] **Step 2: Define cutover sequence**

```text
1. Deploy API Center in warn mode.
2. Publish SDK major version `2.0.0` with required environment. Keep SDK `1.x` supported only during API Center warn mode for inventoried legacy consumers.
3. Create test/live environment-scoped secrets for active tribes, using `tribeId` / `ownerTribeId` as the Secret Manager identity and recording `sourceServiceId` only as usage context.
4. Update Management handoff blocks.
5. Update Spark Site test backend env and verify auth + test payment smoke.
6. Update Spark Site live backend env and verify auth + read-only discovery.
7. Switch API Center to enforce mode.
8. Remove legacy non-environment secret fallback after all active tribes pass smoke.
```

- [x] **Step 3: Define rollback sequence**

```text
1. Set APICENTER_ENVIRONMENT_CONTRACT_MODE=warn.
2. Set APICENTER_LEGACY_TRIBE_SECRET_FALLBACK=true.
3. Keep environment-scoped secrets in Secret Manager.
4. Keep one-URL SDK clients working.
5. Allow only named legacy clients through `APICENTER_LEGACY_ENVIRONMENT_ALLOWLIST` and explicit `APICENTER_LEGACY_ENVIRONMENT_MAP` entries.
6. Investigate failures by serviceId, environment, and correlationId.
```

- [x] **Step 4: Preserve break-glass controls**

The implementation must allow operators to disable one service environment, revoke only one environment secret, disable one shared-service route, force quota to zero for one service/environment, roll a shared-service route back, and export audit evidence by `serviceId + environment + correlationId`.

- [x] **Step 5: Add one-Management deployment topology tests**

Add tests proving one Management deployment can display/manage both `test` and `live` environment rows while all write routes authorize against the target row environment and all API Center calls use the single `API_CENTER_BASE_URL=https://api-center.itsandbox.site`.

- [x] **Step 6: Verify and commit rollout docs/config**

```powershell
cd C:\Codes\apic\api-center
npm run typecheck
git add .env.example config infra docs
git commit -m "docs: add environment contract rollout controls"

cd C:\Codes\apic\apicenter-management
npm test -- src/lib/server/deployment-config.test.ts src/lib/feature-flags.test.ts src/lib/server/require-management-action.test.ts
npm run typecheck
git add .env.example src/lib/server/deployment-config.ts src/lib/server/deployment-config.test.ts src/lib/feature-flags.ts src/lib/feature-flags.test.ts docs/operations/apicenter-management-runbook.md
git commit -m "docs: add management environment handoff settings"
```

## Task 11: Final Cross-Repo Verification

**Files:**
- No planned source edits unless verification exposes a defect.

- [x] **Step 0: Tracker parity check**

Verify `api-center/docs/visualizations/one-apicenter-environment-aware-routing-tracker.html` mirrors the Markdown plan status, latest decisions, critical risks, and completed slice evidence.

```powershell
cd C:\Codes\apic\api-center
rg -n "Last updated|Task 0|Task 11|No silent defaults|target environment|SDK 2.0.0" docs/visualizations/one-apicenter-environment-aware-routing-tracker.html
```
- [x] **Step 1: API Center focused tests**

```powershell
cd C:\Codes\apic\api-center
npm test -- --runInBand src/shared/dto/token-request.dto.spec.ts src/auth/auth.controller.spec.ts src/auth/auth.service.spec.ts src/registry/tribe-secret-resolver.service.spec.ts src/shared/proxy/environment-leak-guard.spec.ts src/shared/proxy-handler.spec.ts src/shared-services/shared-service-routing.service.spec.ts src/analytics/gateway-traffic.service.spec.ts src/analytics/shared-service-usage.service.spec.ts src/quotas/tribe-quota-enforcer.service.spec.ts
```

- [x] **Step 2: API Center package gates**

```powershell
cd C:\Codes\apic\api-center
npm run typecheck
npm run build
npm run check:contracts
npm run registry:verify
```

Current status: `typecheck`, `build`, `check:contracts`, and `registry:verify` pass. `registry:verify` used live Secret Manager runtime env plus API Center admin snapshot fallback because direct local Redis access to private Memorystore timed out; evidence is `docs/operations/registry-parity-2026-06-28.json` with `ready=true`, API snapshot 22, Postgres 22, 0 missing, 0 mismatched.

- [x] **Step 3: SDK gates**

```powershell
cd C:\Codes\apic\api-shared-services
npm run check:contracts
npm run typecheck
npm test
npm run build
npm run pack:check
```

Current status: `check:contracts`, `typecheck`, `test`, `build`, and `pack:check` pass. The payment subscription smoke CLI now requires `APICENTER_ENVIRONMENT` and accepts the documented `APICENTER_URL` alias before live credentials are used.

- [x] **Step 4: Management gates**

```powershell
cd C:\Codes\apic\apicenter-management
npm test
npm run typecheck
npm run build
npm run smoke:routes
```

- [x] **Step 5: APICenter-side service migration evidence**

APICenter owns registry, catalog, secret metadata, route policy, audit, usage, and Management visibility. For external tribe services such as Spark Site, pakiapps, greenovate, shoteam, trinithrive, and similar services not owned by this team, completion is not blocked on logging into or smoke-testing their private runtime. The platform gate is that every active service is represented in the new one-URL model and every legacy service record has an explicit migration disposition.

Required APICenter-side evidence:

```text
registry/catalog: service has explicit environment rows or a documented test-only/retired disposition
secret metadata: legacy unscoped or test-prefixed Secret Manager records are copied to scoped test/live records when the service remains active
route policy: one API Center URL is the canonical gateway for registered services
Management: service detail renders one service with environment rows
evidence: migration artifact records source legacy records, target scoped records, approvals, and rollback status
cleanup readiness: legacy allowlist/map entries and legacy secret versions are removable after APICenter-side verification
```

Consumer-owned runtime smoke is recommended after handoff, but it is not an APICenter plan completion gate for services outside APICenter ownership:

```text
authenticate(): consumer-owned proof
discovery: consumer-owned proof
payment/shared-service call: consumer-owned proof and provider approval
usage/audit: APICenter should be ready to record it when the consumer runs it
```

Current APICenter-side evidence command:

```powershell
cd C:\Codes\apic\api-center
npm run smoke:spark-site:preflight -- --out docs/operations/spark-site-deployment-preflight-2026-06-28.json
```

Optional consumer-owned smoke command:

```powershell
cd C:\Codes\apic\api-shared-services
npm run smoke:environment-discovery:sdk
```

Current status: APICenter-side Spark Site preflight evidence is `docs/operations/spark-site-deployment-preflight-2026-06-28.json`: `church-donations` is active, owned by `church-donations`, declares `email`, `gauth`, `geo`, `otp`, `payment`, and `sms`, and now has both `test` and `live` environment rows. The live row was added through approved API Center registration request `860b4b82-78a3-44c8-944f-f7256f03a7f1`; the preflight artifact reports `ready=true` and no automated blockers. Secret Manager metadata confirms `api-center-tribe-secret-church-donations-test` and `api-center-tribe-secret-church-donations-live` exist in `apicenter-alpha-20260623`; scoped secret migration evidence is `docs/operations/tribe-secret-scope-migration-2026-06-28.json`. Management live is deployed at `https://apicenter-management-live.vercel.app` with Descope auth, live management environment, one API Center URL, Vercel OIDC Secret Manager auth, and `GET /api/local/readiness` returning `ok: true` on 2026-06-28. Management commit `c1b5617` added `POST /api/local/tribe-secrets/migrate-legacy`, and operator CLI migration copied active legacy/test-prefixed Secret Manager hashes into scoped test/live records without printing hash or plaintext values. The `church-donations` test credential was preserved, not rotated. The old duplicate Vercel Management test project `apicenter-management-test` was removed, and `https://api-center-management-test.itsandbox.site` returns `DEPLOYMENT_NOT_FOUND`, leaving one Management site. SDK read-only smoke was attempted from `C:/Codes/apic/api-shared-services` and recorded in `docs/operations/spark-site-sdk-readonly-smoke-2026-06-28.json`; it remains useful consumer-owned evidence but is not a platform completion blocker because APICenter cannot recover hash-only plaintext secrets or operate external service runtimes. Remaining platform migration gates are now tracked in Task 13: migrate every legacy stored service/secret/control-plane record to the new environment-scoped model, remove legacy code paths, and delete or disable legacy records after the rollback window. Provider-impacting payment smoke remains operator-approved only.

## Task 12: Normalize Naming Boundaries And Remove Live/Prod Ambiguity

**Files:**
- Create: `api-center/src/shared/environment-names.ts`
- Create: `api-center/src/shared/environment-names.spec.ts`
- Modify: `api-center/src/operations/service-lifecycle-evidence.controller.ts`
- Modify: `api-center/src/operations/service-lifecycle-evidence.controller.spec.ts`
- Create: `apicenter-management/src/lib/environment-names.ts`
- Create: `apicenter-management/src/lib/environment-names.test.ts`
- Modify: `apicenter-management/src/lib/schemas.ts`
- Modify: `apicenter-management/src/app/api/local/data-pipeline/health/route.ts`
- Modify: `apicenter-management/src/app/api/local/data-pipeline/health/route.test.ts`
- Modify: `apicenter-management/src/app/api/local/data-pipeline/quality/route.ts`
- Modify: `apicenter-management/src/app/api/local/data-pipeline/quality/route.test.ts`
- Modify: `apicenter-management/src/components/environment-promotion-panel.tsx`
- Modify: `apicenter-management/src/components/environment-promotion-panel.test.tsx`
- Modify: `apicenter-management/src/components/tribe-plan-tier-panel.tsx`
- Modify: `apicenter-management/src/components/tribe-plan-tier-panel.test.tsx`
- Modify: `apicenter-management/src/components/service-detail/service-detail-content.tsx`
- Modify: `apicenter-management/src/components/service-detail/service-detail-content.test.tsx`
- Create: `api-center/scripts/check-environment-naming.js`
- Modify: `api-center/package.json`
- Modify: `api-center/docs/visualizations/one-apicenter-environment-aware-routing-tracker.html`

- [x] **Step 1: Add API Center naming boundary tests**

Create `api-center/src/shared/environment-names.spec.ts`:

```ts
import {
  assertRuntimeEnvironment,
  toPhysicalPipelineEnvironment,
} from "./environment-names";

describe("environment naming boundaries", () => {
  it.each(["test", "live"])("accepts public runtime environment %s", (value) => {
    expect(assertRuntimeEnvironment(value)).toBe(value);
  });

  it.each(["prod", "production", "", undefined])(
    "rejects %s as a public runtime environment",
    (value) => {
      expect(() => assertRuntimeEnvironment(value)).toThrow(
        "runtimeEnvironment must be one of: test, live",
      );
    },
  );

  it("maps live runtime to the physical prod pipeline lane only at the boundary", () => {
    expect(toPhysicalPipelineEnvironment("test")).toBe("test");
    expect(toPhysicalPipelineEnvironment("live")).toBe("prod");
  });
});
```

Run:

```powershell
cd C:\Codes\apic\api-center
npm test -- --runInBand src/shared/environment-names.spec.ts
```

Expected: FAIL because `environment-names.ts` does not exist yet.

- [x] **Step 2: Implement API Center naming helpers**

Create `api-center/src/shared/environment-names.ts`:

```ts
import {
  APICENTER_RUNTIME_ENVIRONMENT_KEYS,
  ApicenterRuntimeEnvironment,
  isApicenterRuntimeEnvironment,
} from "../types";

export type PhysicalPipelineEnvironment = "test" | "prod";

export function assertRuntimeEnvironment(
  value: unknown,
): ApicenterRuntimeEnvironment {
  if (isApicenterRuntimeEnvironment(value)) return value;
  throw new Error(
    `runtimeEnvironment must be one of: ${APICENTER_RUNTIME_ENVIRONMENT_KEYS.join(", ")}`,
  );
}

export function toPhysicalPipelineEnvironment(
  runtimeEnvironment: ApicenterRuntimeEnvironment,
): PhysicalPipelineEnvironment {
  return runtimeEnvironment === "live" ? "prod" : "test";
}
```

Update `api-center/src/operations/service-lifecycle-evidence.controller.ts`:

```ts
import { LIVE_RUNTIME_ENVIRONMENT } from "../shared/environment-names";
```

Replace:

```ts
this.pipelineHealth.listHealth("live")
```

with:

```ts
this.pipelineHealth.listHealth(LIVE_RUNTIME_ENVIRONMENT)
```

`PipelineHealthService` performs the `live -> prod` Athena/workgroup mapping internally. Do not pass a physical `prod` lane into runtime-only service APIs.

- [x] **Step 3: Add Management naming boundary tests**

Create `apicenter-management/src/lib/environment-names.test.ts`:

```ts
import {
  parsePipelineLane,
  parseRuntimeEnvironment,
  toPipelineLane,
} from "./environment-names";

describe("Management environment naming", () => {
  it.each(["test", "live"])("accepts runtime environment %s", (value) => {
    expect(parseRuntimeEnvironment(value)).toBe(value);
  });

  it.each(["prod", "production", undefined])(
    "rejects %s as runtime environment",
    (value) => {
      expect(() => parseRuntimeEnvironment(value)).toThrow(
        "runtimeEnvironment must be one of: test, live",
      );
    },
  );

  it.each(["test", "prod"])("accepts pipeline lane %s", (value) => {
    expect(parsePipelineLane(value)).toBe(value);
  });

  it("maps live runtime to prod pipeline lane at the adapter boundary", () => {
    expect(toPipelineLane("test")).toBe("test");
    expect(toPipelineLane("live")).toBe("prod");
  });
});
```

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/lib/environment-names.test.ts
```

Expected: FAIL because `environment-names.ts` does not exist yet.

- [x] **Step 4: Implement Management naming helpers and keep backward-compatible query aliases**

Create `apicenter-management/src/lib/environment-names.ts`:

```ts
export type RuntimeEnvironment = "test" | "live";
export type PipelineLane = "test" | "prod";
export type ManagementDeploymentEnvironment = "local" | "test" | "live";

export function parseRuntimeEnvironment(value: unknown): RuntimeEnvironment {
  if (value === "test" || value === "live") return value;
  throw new Error("runtimeEnvironment must be one of: test, live");
}

export function parsePipelineLane(value: unknown): PipelineLane {
  if (value === "test" || value === "prod") return value;
  throw new Error("pipelineLane must be one of: test, prod");
}

export function toPipelineLane(
  runtimeEnvironment: RuntimeEnvironment,
): PipelineLane {
  return runtimeEnvironment === "live" ? "prod" : "test";
}

export function readPipelineLaneQuery(searchParams: URLSearchParams): PipelineLane {
  return parsePipelineLane(
    searchParams.get("pipelineLane") ??
      searchParams.get("environment") ??
      "test",
  );
}
```

In `apicenter-management/src/app/api/local/data-pipeline/health/route.ts`, `quality/route.ts`, `cost/route.ts`, `decision-signals/route.ts`, `gateway-decisions/route.ts`, and `shared-service-usage/route.ts`, rename local variables from `environment` to `pipelineLane`, read with `readPipelineLaneQuery(searchParams)`, and return metadata with both fields during migration:

```ts
meta: {
  pipelineLane,
  environment: pipelineLane,
  ...
}
```

This preserves existing callers that read `meta.environment` while making the intended physical lane visible.

- [x] **Step 5: Remove public `prod` wording from live promotion and plan-tier UX**

In `apicenter-management/src/components/environment-promotion-panel.tsx`, replace public `prod` references:

```ts
queryKey: queryKeys.planAssignments(`${ownerTribeId ?? "none"}:live`),
queryFn: () =>
  listTribePlanAssignments({
    ownerTribeId,
    environment: "live",
    status: "active",
  }),
```

Replace the plan-tier gate check:

```ts
assignment.status === "active" && assignment.environment === "live"
```

Replace the action label:

```ts
label: "Assign a plan tier for the live environment.",
```

If the API still stores `prod`, add the mapping inside the API client/provider, not the component:

```ts
const storageEnvironment = toPipelineLane(input.environment);
```

Update `tribe-plan-tier-panel.tsx` and `service-detail/service-detail-content.tsx` so operator-facing controls use `test|live`. Any required `prod` mapping must sit behind a named pipeline/provider adapter.

- [x] **Step 6: Add naming lint**

Create `api-center/scripts/check-environment-naming.js`:

```js
#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const allowlist = [
  /data-pipeline/,
  /pipeline/i,
  /athena/i,
  /confluent/i,
  /secret-manager-inventory/,
  /api-center-prod/,
  /api-shared-services-prod/,
  /supabase-live-backup/,
];

const files = execFileSync("git", [
  "ls-files",
  "*.ts",
  "*.tsx",
  "*.js",
  "*.md",
  "*.json",
  "*.yaml",
  "*.yml",
], { cwd: root, encoding: "utf8" })
  .split(/\r?\n/)
  .filter(Boolean);

const violations = [];
for (const file of files) {
  const absolute = path.join(root, file);
  const text = fs.readFileSync(absolute, "utf8");
  if (!/prod|production/.test(text)) continue;
  if (allowlist.some((pattern) => pattern.test(file))) continue;
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (/APICENTER_ENVIRONMENT\s*=\s*prod/.test(line)) {
      violations.push(`${file}:${index + 1} uses APICENTER_ENVIRONMENT=prod`);
    }
    if (/environment:\s*["']prod["']/.test(line)) {
      violations.push(`${file}:${index + 1} exposes environment: "prod"`);
    }
  });
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}
```

Add to `api-center/package.json`:

```json
"check:environment-naming": "node scripts/check-environment-naming.js"
```

- [x] **Step 7: Verify, update tracker, and commit**

```powershell
cd C:\Codes\apic\api-center
npm test -- --runInBand src/shared/environment-names.spec.ts src/operations/service-lifecycle-evidence.controller.spec.ts
npm run check:environment-naming

cd C:\Codes\apic\apicenter-management
npm test -- src/lib/environment-names.test.ts src/app/api/local/data-pipeline/health/route.test.ts src/app/api/local/data-pipeline/quality/route.test.ts src/components/environment-promotion-panel.test.tsx src/components/tribe-plan-tier-panel.test.tsx src/components/service-detail/service-detail-content.test.tsx
npm run typecheck

cd C:\Codes\apic\api-center
git add src/shared/environment-names.ts src/shared/environment-names.spec.ts src/operations/service-lifecycle-evidence.controller.ts src/operations/service-lifecycle-evidence.controller.spec.ts scripts/check-environment-naming.js package.json docs/superpowers/plans/2026-06-27-one-apicenter-environment-aware-routing.md docs/visualizations/one-apicenter-environment-aware-routing-tracker.html
git commit -m "chore: normalize APICenter environment naming boundaries"

cd C:\Codes\apic\apicenter-management
git add src/lib/environment-names.ts src/lib/environment-names.test.ts src/lib/schemas.ts src/app/api/local/data-pipeline src/components/environment-promotion-panel.tsx src/components/environment-promotion-panel.test.tsx src/components/tribe-plan-tier-panel.tsx src/components/tribe-plan-tier-panel.test.tsx src/components/service-detail/service-detail-content.tsx src/components/service-detail/service-detail-content.test.tsx
git commit -m "chore: separate runtime environment from pipeline lane naming"
```

## Task 13: Migrate Every Legacy Service And Remove Legacy Compatibility Paths

**Scope rule:** this task migrates APICenter-owned control-plane state, not consumer-owned runtimes. For Spark Site, pakiapps, greenovate, shoteam, trinithrive, and other services outside APICenter ownership, do not block completion on logging into their backends or running runtime smoke. The required migration is that every legacy service, secret, registry, catalog, Management, SDK, env, and active-doc path is represented in the one-URL environment-aware model or has a documented retired/test-only disposition.

**Redundancy rule:** cleanup is broader than `live` versus `prod`. Inventory and remove redundant aliases, duplicate naming, legacy compatibility paths, stale URLs, overlapping env names, provider-specific fallback names, and any code/docs examples that make the supported contract ambiguous. Keep only named boundary mappings where they describe a real external system, such as public runtime `live` mapping to physical pipeline lane `prod`.

**Files:**
- Create: `api-center/scripts/inventory-legacy-service-migration.js`
- Create: `api-center/scripts/verify-no-legacy-environment-routing.js`
- Create: `api-center/docs/operations/legacy-service-migration-2026-06-28.json`
- Modify: `api-center/src/registry/tribe-secret-resolver.service.ts`
- Modify: `api-center/src/registry/tribe-secret-resolver.service.spec.ts`
- Modify: `api-center/src/shared/dto/token-request.dto.ts`
- Modify: `api-center/src/shared/dto/token-request.dto.spec.ts`
- Modify: `api-center/.env.example`
- Modify: `api-center/docs/database-control-plane.md`
- Modify: `api-shared-services/scripts/smoke-environment-discovery-sdk.js`
- Modify: `api-shared-services/scripts/smoke-payment-subscription-sdk.js`
- Modify: `api-shared-services/docs/consumer-runbook.md`
- Modify: `api-shared-services/scripts/check-contract-compatibility.js`
- Modify: `apicenter-management/src/lib/server/deployment-config.ts`
- Modify: `apicenter-management/src/lib/server/deployment-config.test.ts`
- Modify: `apicenter-management/src/lib/management-environment.ts`
- Modify: `apicenter-management/.env.example`
- Modify: `apicenter-management/docs/operations/apicenter-management-runbook.md`
- Modify: `api-center/docs/visualizations/one-apicenter-environment-aware-routing-tracker.html`

- [x] **Step 1: Inventory every stored legacy service and secret record**

Create `api-center/scripts/inventory-legacy-service-migration.js` that reads Supabase/Postgres catalog state and Secret Manager metadata without printing plaintext values. This inventory must include every stored legacy control-plane record, not only services already visible in Management:

```text
service records: legacy service IDs, stale base URLs, missing environment rows, duplicate test/live rows, retired/test-only candidates
service environment rows: explicit test/live rows, old prod/production values, empty or inferred environment
secret records: unscoped tribe secrets, test-prefixed tribe secrets, scoped test/live target candidates, rollback/delete status
code-level compatibility paths: APICENTER_LEGACY_* envs, env-backed tribe secret validation, missing-environment warn-mode DTO behavior
docs/examples/config: active one-URL docs, SDK smoke aliases, Management env aliases, provider fallback names, stale test-management URLs
```

```js
#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { execFileSync } = require("node:child_process");

const legacyServicePatterns = [
  /api-center-test\.itsandbox\.site/i,
  /^codex-/i,
  /smoke/i,
  /probe/i,
];

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  const out = process.argv.includes("--out")
    ? process.argv[process.argv.indexOf("--out") + 1]
    : "docs/operations/legacy-service-migration-2026-06-28.json";
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  if (!project) throw new Error("GOOGLE_CLOUD_PROJECT or GCLOUD_PROJECT is required.");

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const services = await client.query(`
      select
        service.id,
        service.service_id,
        service.owner_tribe_id,
        service.service_type,
        service.base_url,
        service.status,
        coalesce(json_agg(
          json_build_object(
            'environment', env.environment,
            'baseUrl', env.base_url,
            'status', env.status
          )
        ) filter (where env.id is not null), '[]'::json) as environments
      from apic_catalog.services service
      left join apic_catalog.service_environments env on env.service_id = service.id
      group by service.id
      order by service.service_id
    `);

    const secretNames = listSecretNames(project);
    const activeServices = services.rows.map((row) => ({
      serviceId: row.service_id,
      ownerTribeId: row.owner_tribe_id,
      serviceType: row.service_type,
      baseUrl: row.base_url,
      status: row.status,
      environments: row.environments,
      legacySignals: legacySignalsForService(row),
      migrationDisposition: dispositionForService(row),
    }));

    const legacySecrets = secretNames
      .filter((name) =>
        /^api-center-test-tribe-secret-/.test(name) ||
        /^api-center-tribe-secret-[a-z0-9-]+$/.test(name),
      )
      .sort()
      .map((name) => ({
        name,
        kind: name.startsWith("api-center-test-tribe-secret-")
          ? "test-prefixed"
          : "unscoped",
        targetCandidates: scopedTargetCandidates(name),
      }));

    const result = {
      generatedAt: new Date().toISOString(),
      ready: activeServices.every((service) => service.legacySignals.length === 0),
      activeServices,
      legacySecrets,
      nextActions: [
        "Add explicit environment rows or retire/test-only disposition for every service with legacySignals.",
        "Copy legacy secret hashes into scoped test/live records only for services that remain active.",
        "Remove APICENTER_LEGACY_* allowlist/map entries after scoped records exist.",
        "Disable legacy Secret Manager versions for a rollback window before deletion.",
      ],
    };
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
    console.log(JSON.stringify({ out, ready: result.ready, legacySecrets: legacySecrets.length }));
  } finally {
    await client.end();
  }
}

function listSecretNames(project) {
  return execFileSync("gcloud", [
    "secrets",
    "list",
    `--project=${project}`,
    "--format=value(name)",
  ], { encoding: "utf8" })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function legacySignalsForService(row) {
  const signals = [];
  if (legacyServicePatterns.some((pattern) => pattern.test(row.service_id))) {
    signals.push("legacy_service_id");
  }
  if (legacyServicePatterns.some((pattern) => pattern.test(row.base_url ?? ""))) {
    signals.push("legacy_base_url");
  }
  const environments = Array.isArray(row.environments) ? row.environments : [];
  if (row.status === "active" && environments.length === 0) {
    signals.push("missing_environment_rows");
  }
  return signals;
}

function dispositionForService(row) {
  const signals = legacySignalsForService(row);
  if (signals.length === 0) return "new_model";
  if (/^codex-|smoke|probe/i.test(row.service_id)) return "retire_or_mark_test_only";
  return "migrate_to_environment_rows";
}

function scopedTargetCandidates(name) {
  if (name.startsWith("api-center-test-tribe-secret-")) {
    return [name.replace("api-center-test-tribe-secret-", "api-center-tribe-secret-") + "-test"];
  }
  return [`${name}-test`, `${name}-live`];
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
```

Run:

```powershell
cd C:\Codes\apic\api-center
$env:DATABASE_URL="<supabase database url>"
$env:GOOGLE_CLOUD_PROJECT="apicenter-alpha-20260623"
node scripts/inventory-legacy-service-migration.js --out docs/operations/legacy-service-migration-2026-06-28.json
```

Expected: the artifact lists every active legacy service signal and every legacy/test-prefixed Secret Manager record. No plaintext secret value appears.

Current status: `node scripts/inventory-legacy-service-migration.js --out docs/operations/legacy-service-migration-2026-06-28.json` completed on 2026-06-28 with `blockers=0` and no secret payload values recorded. After Step 2 applied, the artifact reports 14 active catalog services and all 14 are `new_model`; `legacyServices=0`. It still reports 14 legacy Secret Manager records by metadata only (10 test-prefixed, 4 unscoped), 9 scoped target records, and 50 active code/doc compatibility findings. `ready=false` is expected until Step 3 through Step 5 are complete.

- [x] **Step 2: Migrate active services to explicit environment rows or retire them**

For each row in `legacy-service-migration-2026-06-28.json`:

```text
new_model: keep
migrate_to_environment_rows: register through approved API Center registry workflow with explicit test/live rows
retire_or_mark_test_only: retire if temporary; otherwise mark test-only with no live row and a sunset reason
```

Use the normal approved registration path for active live-impacting records:

```powershell
cd C:\Codes\apic\api-center
# Create/approve service.register_live request, then POST /api/v1/registry/register
# with all current manifest fields and explicit environments.
```

Do not run external runtime smoke for services APICenter does not own. Verify APICenter-side state instead:

```text
acceptable APICenter-side proof: registry parity, service_environments rows, Management service detail rendering, scoped Secret Manager metadata, audit/approval evidence, and migration artifact disposition
not required for non-owned services: authenticating to their backend, calling their private runtime, changing their app secrets, or running provider-impacting payment smoke
```

```powershell
npm run registry:verify
node scripts/inventory-legacy-service-migration.js --out docs/operations/legacy-service-migration-2026-06-28.json
```

Current status: `npm run registry:migrate-legacy-services -- --apply --out docs/operations/legacy-service-record-migration-2026-06-28.json` applied a single Postgres transaction. It added explicit `test` and `live` environment rows for `flow-ci`, `greenovate`, `pakiapps`, `shoteam`, `smurf-village`, and `trinithrive`; retired 8 temporary/placeholder records; and marked `smoke-tribe` as explicit test-only with a sunset. Live API Center was restarted with `kubectl rollout restart deployment/api-center -n api-center`, and `npm run registry:verify -- --out docs/operations/registry-parity-post-service-migration-2026-06-28.json` returned `ready=true`, API snapshot 22, Postgres 22, 0 missing, 0 mismatched.

- [ ] **Step 3: Migrate stored legacy secrets, then disable and delete legacy records after rollback**

For each `legacySecrets[]` record:

```text
1. Confirm target scoped record exists or create it through Management/Secret Manager without printing hash/plaintext.
2. Confirm target JSON metadata contains tribeId, environment, sourceServiceId/provisionedForServiceIds where applicable, status, rotationState, and secretHashSha256.
3. Remove any corresponding service from APICENTER_LEGACY_ENVIRONMENT_ALLOWLIST and APICENTER_LEGACY_ENVIRONMENT_MAP.
4. Disable old legacy secret versions for a rollback window.
5. Delete legacy secret records only after scoped auth/discovery is proven or the service is retired/test-only.
```

Record every action in `docs/operations/legacy-service-migration-2026-06-28.json` under:

```json
{
  "legacySecretCleanup": [
    {
      "legacyName": "api-center-test-tribe-secret-pakiapps",
      "targetNames": ["api-center-tribe-secret-pakiapps-test"],
      "status": "disabled_for_rollback",
      "disabledAt": "2026-06-28T00:00:00.000Z",
      "deleteAfter": "2026-07-05T00:00:00.000Z"
    }
  ]
}
```

Current status: `npm run registry:migrate-legacy-secrets -- --apply --disable-legacy --out docs/operations/legacy-secret-cleanup-2026-06-28.json` created 8 missing environment-scoped Secret Manager records without printing hashes or plaintext. This includes live scoped targets for `flow-ci`, `greenovate`, `pakiapps`, `shoteam`, `smurf-village`, and `trinithrive`, plus scoped test records for `flow-ci` and `smoke-tribe`. It disabled 33 enabled versions across 14 legacy Secret Manager records for rollback. The regenerated inventory reports `legacyServices=0`, `enabledLegacyVersions=0`, 17 scoped Secret Manager records, and 14 legacy records remaining only as disabled rollback records. Delete those legacy records after `2026-07-04T22:30:06.543Z` if no rollback is needed. Step 3 remains open until that deletion is done.

- [ ] **Step 4: Remove code-level legacy secret fallback after stored migration is complete**

Only after Step 1 through Step 3 show no active unmigrated legacy services, update API Center:

```text
Remove APICENTER_LEGACY_TRIBE_SECRET_FALLBACK.
Remove APICENTER_LEGACY_ENVIRONMENT_ALLOWLIST.
Remove APICENTER_LEGACY_ENVIRONMENT_MAP.
Remove env-backed legacy hash validation from TribeSecretResolverService.
Make TokenRequestDto.environment required with no warn-mode exception.
Remove tests that accept missing environment.
Add tests that missing environment is rejected.
```

Expected test change in `api-center/src/shared/dto/token-request.dto.spec.ts`:

```ts
it("rejects missing environment after legacy migration", async () => {
  const errors = await validate(dto({ tribeId: "church-donations", secret: "secret" }));
  expect(errors.some((error) => error.property === "environment")).toBe(true);
});
```

Expected resolver test:

```ts
it("does not validate legacy env-backed tribe secrets after migration", async () => {
  process.env.TRIBE_SECRET_CHURCH_DONATIONS = hashSecret("legacy-secret");
  await expect(
    service.validateLegacySecret("church-donations", "legacy-secret"),
  ).rejects.toThrow("Legacy tribe secret validation has been removed");
});
```

Verify:

```powershell
cd C:\Codes\apic\api-center
npm test -- --runInBand src/shared/dto/token-request.dto.spec.ts src/registry/tribe-secret-resolver.service.spec.ts
npm run typecheck
```

- [ ] **Step 5: Remove redundant active docs/examples and env aliases**

Active docs and examples must not introduce old URLs or redundant env names:

```text
Replace active `https://api-center-test.itsandbox.site` examples with:
APICENTER_URL=https://api-center.itsandbox.site
APICENTER_ENVIRONMENT=test

Keep old URLs only in archive/history files clearly marked as historical.
Mark APICENTER_GATEWAY_URL as deprecated and keep only as CLI compatibility alias.
Consolidate Management internals on MANAGEMENT_ENVIRONMENT and keep MANAGEMENT_ENV/NEXT_PUBLIC_MANAGEMENT_ENV only as boundary aliases until the next major cleanup.
Keep POWERBI_NORTH_STAR_* only in the BI adapter or remove it if no deployment uses it.
```

Also scan for other redundant naming beyond live/prod:

```text
environment versus runtimeEnvironment versus pipelineLane versus providerMode
ownerTribeId versus sourceServiceId
API_CENTER_BASE_URL versus APICENTER_URL/APICENTER_GATEWAY_URL
MANAGEMENT_ENVIRONMENT versus MANAGEMENT_ENV/NEXT_PUBLIC_MANAGEMENT_ENV
provider-neutral BI names versus POWERBI_NORTH_STAR_* fallback names
deployment secret bundle names versus runtime environment names
```

Only remove a duplicate when the repo has a canonical replacement and tests/docs can be updated in the same slice. If a duplicate reflects an unavoidable external system boundary, isolate it behind a named adapter/helper and document why it remains.

Update contract checks:

```powershell
cd C:\Codes\apic\api-shared-services
npm run check:contracts

cd C:\Codes\apic\apicenter-management
npm test -- src/lib/server/deployment-config.test.ts src/lib/management-environment.test.ts src/lib/server/north-star-bi-config.test.ts
```

- [x] **Step 6: Add a no-legacy verifier**

Create `api-center/scripts/verify-no-legacy-environment-routing.js`:

```js
#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const allowArchived = /docs[\\/](superpowers[\\/]plans[\\/]archive|operations[\\/].*inventory|operations[\\/].*migration|operations[\\/].*backup)/;
const forbidden = [
  { pattern: /APICENTER_LEGACY_/g, message: "APICENTER_LEGACY_* must be removed after migration" },
  { pattern: /api-center-test\.itsandbox\.site/g, message: "active docs/code must use one APICenter URL plus APICENTER_ENVIRONMENT" },
  { pattern: /api-center-test-tribe-secret-/g, message: "test-prefixed tribe secret names are legacy" },
  { pattern: /TRIBE_SECRET_[A-Z0-9_]+/g, message: "legacy env-backed tribe secret hashes are removed" },
];

const files = execFileSync("git", [
  "ls-files",
  "*.ts",
  "*.tsx",
  "*.js",
  "*.md",
  "*.json",
  "*.yaml",
  "*.yml",
  ".env.example",
], { cwd: root, encoding: "utf8" })
  .split(/\r?\n/)
  .filter(Boolean);

const violations = [];
for (const file of files) {
  if (allowArchived.test(file)) continue;
  const text = fs.readFileSync(path.join(root, file), "utf8");
  for (const rule of forbidden) {
    const matches = [...text.matchAll(rule.pattern)];
    if (matches.length > 0) {
      violations.push(`${file}: ${rule.message}`);
    }
  }
}

if (violations.length > 0) {
  console.error([...new Set(violations)].join("\n"));
  process.exit(1);
}
```

Add to `api-center/package.json`:

```json
"check:no-legacy-routing": "node scripts/verify-no-legacy-environment-routing.js"
```

Run:

```powershell
cd C:\Codes\apic\api-center
npm run check:no-legacy-routing
```

Expected after cleanup: PASS.

Current status: `npm run check:no-legacy-routing -- --report` runs in report mode and found 50 active violations plus historical matches in allowed plan/operations evidence files. The default `npm run check:no-legacy-routing` remains an enforce-mode gate and is expected to fail until Step 4 and Step 5 remove the remaining code/doc compatibility paths.

- [ ] **Step 7: Verify final migration and commit**

Final platform migration gates:

```powershell
cd C:\Codes\apic\api-center
npm run registry:verify
npm run check:contracts
npm run check:environment-naming
npm run check:no-legacy-routing
npm run typecheck
npm run build

cd C:\Codes\apic\api-shared-services
npm run check:contracts
npm run typecheck
npm test
npm run build
npm run pack:check

cd C:\Codes\apic\apicenter-management
npm test
npm run typecheck
npm run build
npm run smoke:routes
```

Commit:

```powershell
cd C:\Codes\apic\api-center
git add scripts docs src .env.example package.json
git commit -m "chore: remove legacy APICenter routing compatibility"

cd C:\Codes\apic\api-shared-services
git add scripts docs README.md
git commit -m "docs: remove legacy APICenter URL aliases"

cd C:\Codes\apic\apicenter-management
git add src docs .env.example
git commit -m "chore: consolidate management environment naming"
```

## Self-Review

- [x] Spec coverage: one URL, required environment, env-scoped tribe secrets, env-keyed cache, source-service ownership validation, refresh-token environment preservation, token-derived backend routing, payment-only runtime split, deterministic payment webhook isolation, trusted same-runtime shared-service headers, database environment constraints without silent defaults, data-pipeline `live`/`prod` mapping, target-environment Management live-action guardrails, enforceable auth-token contracts, SDK major rollout, rollback, break-glass controls, canonical naming boundaries, legacy service migration, stored legacy cleanup, code-level legacy removal, and broader redundancy cleanup are covered.
- [x] Placeholder scan: no placeholder markers or unnamed implementation steps are left in the plan.
- [x] Type consistency: API Center uses `ServiceEnvironmentKey`; SDK uses `ApicenterEnvironment`; runtime values are consistently `test` and `live`.
- [x] Scope check: this remains one platform contract despite spanning three repos; tasks are sliced so each produces testable software.
- [x] Visual tracker coverage: the plan requires a standalone HTML tracker for decisions, risks, slice status, database readiness, rollout gates, and deployment status, updated in the same slice as Markdown checkboxes.
