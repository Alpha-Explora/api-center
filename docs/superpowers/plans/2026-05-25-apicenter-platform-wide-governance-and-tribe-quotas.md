# APICenter Platform-Wide Governance And Tribe Quotas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade APICenter as a whole platform across API Center, APICenter Management, and Shared Services, including configurable per-tribe API call limits that operators can set and enforce.

**Architecture:** API Center remains the runtime source of truth and enforcement point. APICenter Management becomes the operator surface for configuring policy, reviewing usage, and managing rollout safety. API Shared Services keeps tribe-facing SDK contracts, error handling, manifest validation, and handoff docs aligned with the runtime policy.

**Tech Stack:** NestJS 11, Prisma 7, Supabase/Postgres, Redis-backed throttling, Next.js 16, React 19, Zod, Vitest, Jest, TypeScript, Confluent/Kafka governance, GCP Secret Manager, Vercel.

---

## Scope

This plan is not only for the data pipeline. It covers the full APICenter product:

- **API Center runtime:** auth, registry, proxying, shared-service calls, Kafka publish governance, quota enforcement, usage/audit evidence, health/readiness.
- **APICenter Management:** operator dashboards, quota policy editing, tribe onboarding, service registration, write safety, usage views, config health.
- **API Shared Services and SDK:** shared-service manifests, SDK typed errors, retry guidance, quota headers, tribe handoff docs, compatibility checks.
- **Platform governance:** source-of-truth rules, rollout gates, docs, monitoring, and production safety.
- **Product expansion:** tribe plans/tiers, developer portal mode, approval workflows, policy engine rules, reliability views, API product catalog, incident support, SDK key rotation, and environment promotion.

## Design Decisions

1. **Quota enforcement belongs in API Center.** Management can configure quotas, but API Center is the only runtime gateway that can enforce them reliably.
2. **Global throttling stays as baseline protection.** The existing `TribeThrottlerGuard` and Redis throttler protect the gateway from noisy neighbors. New tribe quotas are business/operator policies layered on top.
3. **Quota policies are per tribe, with optional namespace and target-service scope.** Operators can set `all`, `shared`, `tribe`, or `kafka_publish` quotas, and can narrow a policy to a specific target service when needed.
4. **Start in observe mode, then enforce.** Every new policy supports `observe` and `enforce` modes so operators can review impact before blocking calls.
5. **429 responses must be SDK-friendly.** API Center returns machine-readable quota metadata, Management displays it, and the SDK raises `RateLimitError` with retry and quota context.
6. **No plaintext secrets or provider credentials enter Management.** Quota settings and usage are safe metadata only.
7. **Plan tiers come after quotas.** Quotas create the enforcement primitive; plan tiers package quotas, shared-service access, retention, and support expectations into operator-friendly products.
8. **Developer portal mode is read-only first.** Tribe self-service starts with visibility and docs before write-capable self-service.
9. **Policy engine rules must be explainable.** Every block or warning should include the rule ID, reason, affected resource, and next action.

## Planned File Structure

### API Center

- Create: `api-center/src/quotas/quotas.module.ts`
- Create: `api-center/src/quotas/tribe-quota-policy.types.ts`
- Create: `api-center/src/quotas/tribe-quota-policy.service.ts`
- Create: `api-center/src/quotas/tribe-quota-policy.service.spec.ts`
- Create: `api-center/src/quotas/tribe-quota-enforcer.service.ts`
- Create: `api-center/src/quotas/tribe-quota-enforcer.service.spec.ts`
- Create: `api-center/src/quotas/tribe-quota-admin.controller.ts`
- Create: `api-center/src/quotas/tribe-quota-admin.controller.spec.ts`
- Create: `api-center/src/quotas/tribe-quota-usage.controller.ts`
- Create: `api-center/src/quotas/tribe-quota-usage.controller.spec.ts`
- Modify: `api-center/src/app.module.ts`
- Modify: `api-center/src/shared/proxy-handler.ts`
- Modify: `api-center/src/tribes/tribes.controller.ts`
- Modify: `api-center/src/shared-services/shared-services.controller.ts`
- Modify: `api-center/src/kafka-governance/kafka-governance.controller.ts`
- Modify: `api-center/src/config/config.service.ts`
- Modify: `api-center/src/shared/errors.ts`
- Modify: `api-center/prisma/schema.prisma`
- Create: `api-center/supabase/migrations/20260525000000_tribe_api_quota_policies.sql`
- Modify: `api-center/docs/developer/tribe-onboarding.md`
- Create: `api-center/docs/developer/tribe-api-quotas.md`

### APICenter Management

- Create: `apicenter-management/src/lib/quota-policy.ts`
- Create: `apicenter-management/src/lib/quota-policy.test.ts`
- Modify: `apicenter-management/src/lib/schemas.ts`
- Modify: `apicenter-management/src/lib/api-center-client.ts`
- Create: `apicenter-management/src/app/api/local/quotas/policies/route.ts`
- Create: `apicenter-management/src/app/api/local/quotas/policies/route.test.ts`
- Create: `apicenter-management/src/app/api/local/quotas/usage/route.ts`
- Create: `apicenter-management/src/app/api/local/quotas/usage/route.test.ts`
- Create: `apicenter-management/src/app/quotas/page.tsx`
- Create: `apicenter-management/src/components/tribe-quota-policy-panel.tsx`
- Create: `apicenter-management/src/components/tribe-quota-policy-panel.test.tsx`
- Create: `apicenter-management/src/components/tribe-quota-usage-panel.tsx`
- Create: `apicenter-management/src/components/tribe-quota-usage-panel.test.tsx`
- Modify: `apicenter-management/src/components/app-shell.tsx`
- Modify: `apicenter-management/src/components/tribe-onboarding-flow.tsx`
- Modify: `apicenter-management/src/lib/proposed-actions.ts`
- Modify: `apicenter-management/docs/operations/apicenter-management-runbook.md`

### API Shared Services And SDK

- Modify: `api-shared-services/src/errors.ts`
- Modify: `api-shared-services/src/TribeClient.ts`
- Modify: `api-shared-services/src/types.ts`
- Modify: `api-shared-services/src/internal/http.ts`
- Create: `api-shared-services/src/quota.ts`
- Create: `api-shared-services/tests/quota-error.test.ts`
- Modify: `api-shared-services/contracts/service-manifest.schema.json`
- Modify: `api-shared-services/docs/consumer-runbook.md`
- Modify: `api-shared-services/docs/tribe-sdk-consumption.md`
- Modify: `api-shared-services/docs/tribe-sdk-shared-services-manual.md`
- Modify: `api-shared-services/scripts/check-contract-compatibility.js`

---

## Phase 0: Baseline And Safety Check

**Purpose:** Confirm current repo state, existing quota/throttle behavior, and dirty files before implementation.

- [x] **Step 1: Check each repo worktree**

Run:

```powershell
foreach ($repo in 'api-center','apicenter-management','api-shared-services') {
  Push-Location $repo
  Write-Output "## $repo"
  git status --short
  Pop-Location
}
```

Expected: Existing dirty files are reviewed and not overwritten. Any unrelated user changes are left alone.

- [x] **Step 2: Confirm existing throttling baseline**

Run:

```powershell
rg -n "ThrottlerModule|TribeThrottlerGuard|RedisThrottlerStorage|rateLimit" api-center/src
```

Expected: `app.module.ts`, `tribe-throttler.guard.ts`, `redis-throttler-storage.ts`, and `config.service.ts` show the current global per-tribe throttling foundation.

- [x] **Step 3: Confirm current usage evidence paths**

Run:

```powershell
rg -n "SharedServiceUsageService|GatewayTrafficService|UsageRollup|recordSharedServiceUsage|recordGatewayTraffic" api-center/src api-center/prisma/schema.prisma apicenter-management/src
```

Expected: Existing shared-service usage, gateway traffic, and rollup surfaces are identified before adding quota usage views.

---

## Phase 1: API Center Quota Data Model

**Purpose:** Add durable quota policies and quota decisions without changing runtime behavior yet.

### Task 1: Add Prisma And Supabase Quota Tables

**Files:**

- Modify: `api-center/prisma/schema.prisma`
- Create: `api-center/supabase/migrations/20260525000000_tribe_api_quota_policies.sql`

- [x] **Step 1: Add quota models to Prisma**

Add these models after `UsageRollup`:

```prisma
model TribeApiQuotaPolicy {
  id              String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  ownerTribeId    String   @map("owner_tribe_id")
  scope           String   @default("all")
  targetServiceId String?  @map("target_service_id")
  windowSeconds   Int      @map("window_seconds")
  maxRequests     Int      @map("max_requests")
  burstRequests   Int?     @map("burst_requests")
  mode            String   @default("observe")
  status          String   @default("active")
  reason          String
  createdBy       String?  @map("created_by")
  updatedBy       String?  @map("updated_by")
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@index([ownerTribeId, status], name: "tribe_quota_policies_owner_status_idx")
  @@index([scope, targetServiceId], name: "tribe_quota_policies_scope_target_idx")
  @@map("tribe_api_quota_policies")
  @@schema("api_center_ops")
}

model TribeApiQuotaDecision {
  id              String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  ownerTribeId    String   @map("owner_tribe_id")
  policyId        String?  @map("policy_id") @db.Uuid
  scope           String
  targetServiceId String?  @map("target_service_id")
  routeFamily     String   @map("route_family")
  windowStart     DateTime @map("window_start") @db.Timestamptz(6)
  windowEnd       DateTime @map("window_end") @db.Timestamptz(6)
  requestCount    Int      @map("request_count")
  maxRequests     Int      @map("max_requests")
  mode            String
  outcome         String
  correlationId   String?  @map("correlation_id")
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  @@index([ownerTribeId, createdAt], name: "tribe_quota_decisions_owner_created_idx")
  @@index([outcome, createdAt], name: "tribe_quota_decisions_outcome_created_idx")
  @@index([correlationId], name: "tribe_quota_decisions_correlation_idx")
  @@map("tribe_api_quota_decisions")
  @@schema("api_center_ops")
}
```

- [x] **Step 2: Add Supabase migration**

Create `api-center/supabase/migrations/20260525000000_tribe_api_quota_policies.sql`:

```sql
CREATE TABLE IF NOT EXISTS api_center_ops.tribe_api_quota_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_tribe_id TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'all',
  target_service_id TEXT,
  window_seconds INTEGER NOT NULL CHECK (window_seconds > 0),
  max_requests INTEGER NOT NULL CHECK (max_requests > 0),
  burst_requests INTEGER CHECK (burst_requests IS NULL OR burst_requests >= max_requests),
  mode TEXT NOT NULL DEFAULT 'observe' CHECK (mode IN ('observe', 'enforce')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  reason TEXT NOT NULL,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (scope IN ('all', 'shared', 'tribe', 'kafka_publish'))
);

CREATE INDEX IF NOT EXISTS tribe_quota_policies_owner_status_idx
  ON api_center_ops.tribe_api_quota_policies (owner_tribe_id, status);

CREATE INDEX IF NOT EXISTS tribe_quota_policies_scope_target_idx
  ON api_center_ops.tribe_api_quota_policies (scope, target_service_id);

CREATE TABLE IF NOT EXISTS api_center_ops.tribe_api_quota_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_tribe_id TEXT NOT NULL,
  policy_id UUID,
  scope TEXT NOT NULL,
  target_service_id TEXT,
  route_family TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL,
  max_requests INTEGER NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('observe', 'enforce')),
  outcome TEXT NOT NULL CHECK (outcome IN ('allowed', 'observed_exceeded', 'blocked')),
  correlation_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tribe_quota_decisions_owner_created_idx
  ON api_center_ops.tribe_api_quota_decisions (owner_tribe_id, created_at DESC);

CREATE INDEX IF NOT EXISTS tribe_quota_decisions_outcome_created_idx
  ON api_center_ops.tribe_api_quota_decisions (outcome, created_at DESC);

CREATE INDEX IF NOT EXISTS tribe_quota_decisions_correlation_idx
  ON api_center_ops.tribe_api_quota_decisions (correlation_id);
```

- [x] **Step 3: Validate schema**

Run:

```powershell
Push-Location api-center
npm run db:validate
Pop-Location
```

Expected: Prisma validates without schema errors.

---

## Phase 2: API Center Quota Policy Service

**Purpose:** Create the internal API that reads, writes, validates, and lists quota policies.

### Task 2: Implement Policy Types And Service

**Files:**

- Create: `api-center/src/quotas/tribe-quota-policy.types.ts`
- Create: `api-center/src/quotas/tribe-quota-policy.service.ts`
- Create: `api-center/src/quotas/tribe-quota-policy.service.spec.ts`

- [x] **Step 1: Write failing policy service tests**

Create `api-center/src/quotas/tribe-quota-policy.service.spec.ts` with tests for:

```ts
it("chooses the most specific active policy for a tribe target", async () => {
  const service = new TribeQuotaPolicyService(fakePrisma);
  fakePrisma.tribeApiQuotaPolicy.findMany.mockResolvedValue([
    {
      ownerTribeId: "campus-one",
      scope: "all",
      maxRequests: 1000,
      windowSeconds: 60,
      mode: "observe",
      status: "active",
    },
    {
      ownerTribeId: "campus-one",
      scope: "shared",
      targetServiceId: "payment-service",
      maxRequests: 120,
      windowSeconds: 60,
      mode: "enforce",
      status: "active",
    },
  ]);

  await expect(
    service.resolvePolicy({
      ownerTribeId: "campus-one",
      scope: "shared",
      targetServiceId: "payment-service",
    }),
  ).resolves.toMatchObject({
    ownerTribeId: "campus-one",
    scope: "shared",
    targetServiceId: "payment-service",
    maxRequests: 120,
    mode: "enforce",
  });
});
```

- [x] **Step 2: Implement policy types**

Create `api-center/src/quotas/tribe-quota-policy.types.ts`:

```ts
export type TribeQuotaScope = "all" | "shared" | "tribe" | "kafka_publish";
export type TribeQuotaMode = "observe" | "enforce";
export type TribeQuotaStatus = "active" | "disabled";

export interface TribeQuotaPolicy {
  id?: string;
  ownerTribeId: string;
  scope: TribeQuotaScope;
  targetServiceId?: string | null;
  windowSeconds: number;
  maxRequests: number;
  burstRequests?: number | null;
  mode: TribeQuotaMode;
  status: TribeQuotaStatus;
  reason: string;
}

export interface ResolveTribeQuotaPolicyInput {
  ownerTribeId: string;
  scope: TribeQuotaScope;
  targetServiceId?: string;
}
```

- [x] **Step 3: Implement policy service**

Create `api-center/src/quotas/tribe-quota-policy.service.ts` with:

```ts
@Injectable()
export class TribeQuotaPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async resolvePolicy(
    input: ResolveTribeQuotaPolicyInput,
  ): Promise<TribeQuotaPolicy | null> {
    const policies = await this.prisma.tribeApiQuotaPolicy.findMany({
      where: {
        ownerTribeId: input.ownerTribeId,
        status: "active",
        OR: [
          {
            scope: input.scope,
            targetServiceId: input.targetServiceId ?? null,
          },
          { scope: input.scope, targetServiceId: null },
          { scope: "all", targetServiceId: null },
        ],
      },
      orderBy: [
        { targetServiceId: "desc" },
        { scope: "desc" },
        { updatedAt: "desc" },
      ],
    });

    return policies[0] ?? null;
  }
}
```

- [x] **Step 4: Run focused tests**

Run:

```powershell
Push-Location api-center
npm run test -- src/quotas/tribe-quota-policy.service.spec.ts --runInBand
Pop-Location
```

Expected: Policy resolution tests pass.

---

## Phase 3: API Center Quota Enforcement

**Purpose:** Enforce or observe per-tribe quotas using Redis-compatible counters and durable decision evidence.

### Task 3: Add Quota Enforcer

**Files:**

- Create: `api-center/src/quotas/tribe-quota-enforcer.service.ts`
- Create: `api-center/src/quotas/tribe-quota-enforcer.service.spec.ts`
- Modify: `api-center/src/shared/errors.ts`

- [x] **Step 1: Write failing enforcer tests**

Create tests for three cases:

```ts
it("allows calls under an enforce policy", async () => {});
it("records observed_exceeded without blocking when policy mode is observe", async () => {});
it("throws QuotaExceededError when an enforce policy is exceeded", async () => {});
```

Expected exceeded error shape:

```ts
{
  status: 429,
  code: "TRIBE_API_QUOTA_EXCEEDED",
  ownerTribeId: "campus-one",
  retryAfterSeconds: 60,
  quota: { maxRequests: 100, windowSeconds: 60, scope: "shared" }
}
```

- [x] **Step 2: Add API Center error type**

In `api-center/src/shared/errors.ts`, add:

```ts
export class QuotaExceededError extends HttpError {
  constructor(
    message: string,
    public readonly detail: Record<string, unknown>,
  ) {
    super(message, 429, "TRIBE_API_QUOTA_EXCEEDED");
  }
}
```

If `HttpError` has a different local constructor shape, match the existing error classes in that file and keep the public code `TRIBE_API_QUOTA_EXCEEDED`.

- [x] **Step 3: Implement enforcer**

Create `api-center/src/quotas/tribe-quota-enforcer.service.ts`:

```ts
@Injectable()
export class TribeQuotaEnforcerService {
  constructor(
    private readonly policies: TribeQuotaPolicyService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async check(input: {
    ownerTribeId: string;
    scope: TribeQuotaScope;
    targetServiceId?: string;
    routeFamily: string;
    correlationId?: string;
  }): Promise<void> {
    const policy = await this.policies.resolvePolicy(input);
    if (!policy) return;

    const now = new Date();
    const windowStartMs =
      Math.floor(now.getTime() / (policy.windowSeconds * 1000)) *
      policy.windowSeconds *
      1000;
    const windowStart = new Date(windowStartMs);
    const windowEnd = new Date(windowStartMs + policy.windowSeconds * 1000);
    const requestCount = await this.incrementCounter(
      policy,
      input,
      windowStart,
    );
    const exceeded =
      requestCount > (policy.burstRequests ?? policy.maxRequests);
    const outcome = exceeded
      ? policy.mode === "enforce"
        ? "blocked"
        : "observed_exceeded"
      : "allowed";

    await this.recordDecision(
      policy,
      input,
      windowStart,
      windowEnd,
      requestCount,
      outcome,
    );

    if (outcome === "blocked") {
      throw new QuotaExceededError("Tribe API quota exceeded", {
        ownerTribeId: input.ownerTribeId,
        scope: policy.scope,
        targetServiceId: policy.targetServiceId,
        maxRequests: policy.maxRequests,
        windowSeconds: policy.windowSeconds,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((windowEnd.getTime() - now.getTime()) / 1000),
        ),
      });
    }
  }
}
```

The implementation should use Redis when `REDIS_RATE_LIMIT_URL` is available and a process-local map only for local tests, matching the existing throttler fallback pattern.

- [x] **Step 4: Run enforcer tests**

Run:

```powershell
Push-Location api-center
npm run test -- src/quotas/tribe-quota-enforcer.service.spec.ts --runInBand
Pop-Location
```

Expected: All enforcer tests pass.

---

## Phase 4: Enforce Quotas In Gateway Paths

**Purpose:** Apply quota checks to the traffic that matters: tribe-to-tribe proxying, shared-service proxying, and governed Kafka publishing.

### Task 4: Wire Quotas Into Proxy And Kafka Runtime

**Files:**

- Modify: `api-center/src/quotas/quotas.module.ts`
- Modify: `api-center/src/app.module.ts`
- Modify: `api-center/src/shared/proxy-handler.ts`
- Modify: `api-center/src/tribes/tribes.controller.ts`
- Modify: `api-center/src/shared-services/shared-services.controller.ts`
- Modify: `api-center/src/kafka-governance/kafka-governance.controller.ts`
- Create: `api-center/src/quotas/quotas.module.ts`

- [x] **Step 1: Create `QuotasModule`**

Create:

```ts
@Global()
@Module({
  imports: [DatabaseModule, ConfigModule],
  controllers: [TribeQuotaAdminController, TribeQuotaUsageController],
  providers: [TribeQuotaPolicyService, TribeQuotaEnforcerService],
  exports: [TribeQuotaPolicyService, TribeQuotaEnforcerService],
})
export class QuotasModule {}
```

- [x] **Step 2: Import quotas in `AppModule`**

Add `QuotasModule` to `api-center/src/app.module.ts` imports after `AnalyticsModule`.

- [x] **Step 3: Add optional quota dependency to `ProxyHandler`**

Extend `ProxyHandlerDeps`:

```ts
quotaEnforcer?: TribeQuotaEnforcerService;
```

Before circuit-breaker acquisition in `proxyRequest`, add:

```ts
await this.deps.quotaEnforcer?.check({
  ownerTribeId: tribeId,
  scope: this.opts.namespace,
  targetServiceId,
  routeFamily: `${this.opts.namespace}:${targetServiceId}`,
  correlationId,
});
```

- [x] **Step 4: Inject enforcer into tribe and shared-service controllers**

Add `TribeQuotaEnforcerService` to both controller constructors and pass it into `new ProxyHandler({ ... quotaEnforcer })`.

- [x] **Step 5: Check quota before Kafka publish**

In `KafkaGovernanceController.publishMessage`, before `publishMessage(...)`, add:

```ts
await this.quotaEnforcer.check({
  ownerTribeId: tribeId,
  scope: "kafka_publish",
  targetServiceId: "kafka",
  routeFamily: "kafka:publish",
  correlationId: req.correlationId,
});
```

- [x] **Step 6: Run runtime tests**

Run:

```powershell
Push-Location api-center
npm run test -- src/shared/proxy-handler.spec.ts src/kafka-governance/kafka-governance.controller.spec.ts src/quotas/tribe-quota-enforcer.service.spec.ts --runInBand
npm run typecheck
Pop-Location
```

Expected: Proxy, Kafka, quota tests, and typecheck pass.

---

## Phase 5: API Center Admin And Usage Routes

**Purpose:** Give Management a safe API for listing, creating, updating, disabling, and reviewing quota policies.

### Task 5: Add Admin And Usage Controllers

**Files:**

- Create: `api-center/src/quotas/tribe-quota-admin.controller.ts`
- Create: `api-center/src/quotas/tribe-quota-admin.controller.spec.ts`
- Create: `api-center/src/quotas/tribe-quota-usage.controller.ts`
- Create: `api-center/src/quotas/tribe-quota-usage.controller.spec.ts`

- [x] **Step 1: Write failing admin route tests**

Cover:

```ts
it("requires platform admin scope to create a quota policy", async () => {});
it("rejects invalid quota windows and max requests", async () => {});
it("disables a policy instead of deleting it", async () => {});
```

- [x] **Step 2: Add routes**

Expose:

```text
GET    /api/v1/quotas/policies?ownerTribeId=campus-one
POST   /api/v1/quotas/policies
PATCH  /api/v1/quotas/policies/:policyId
DELETE /api/v1/quotas/policies/:policyId
GET    /api/v1/quotas/usage?ownerTribeId=campus-one&window=24h
```

Delete must set `status=disabled`; it must not physically delete rows.

- [x] **Step 3: Include safe response metadata**

Policy responses must include:

```ts
{
  id: string;
  ownerTribeId: string;
  scope: "all" | "shared" | "tribe" | "kafka_publish";
  targetServiceId?: string;
  windowSeconds: number;
  maxRequests: number;
  burstRequests?: number;
  mode: "observe" | "enforce";
  status: "active" | "disabled";
  reason: string;
  updatedAt: string;
}
```

- [x] **Step 4: Run controller tests**

Run:

```powershell
Push-Location api-center
npm run test -- src/quotas/tribe-quota-admin.controller.spec.ts src/quotas/tribe-quota-usage.controller.spec.ts --runInBand
Pop-Location
```

Expected: Admin and usage routes are guarded and return safe metadata only.

---

## Phase 6: APICenter Management Quota UI

**Purpose:** Let operators set tribe API call limits, review projected impact, switch observe/enforce mode, and see quota usage.

### Task 6: Add Management Schemas And Proxy Routes

**Files:**

- Modify: `apicenter-management/src/lib/schemas.ts`
- Modify: `apicenter-management/src/lib/api-center-client.ts`
- Create: `apicenter-management/src/lib/quota-policy.ts`
- Create: `apicenter-management/src/lib/quota-policy.test.ts`
- Create: `apicenter-management/src/app/api/local/quotas/policies/route.ts`
- Create: `apicenter-management/src/app/api/local/quotas/policies/route.test.ts`
- Create: `apicenter-management/src/app/api/local/quotas/usage/route.ts`
- Create: `apicenter-management/src/app/api/local/quotas/usage/route.test.ts`

- [x] **Step 1: Add Zod schemas**

Add schemas for `quotaPolicySchema`, `quotaPolicyListResponseSchema`, `quotaUsageDecisionSchema`, and `quotaUsageResponseSchema` in `schemas.ts`.

- [x] **Step 2: Add client helpers**

Add to `api-center-client.ts`:

```ts
export async function listQuotaPolicies(ownerTribeId?: string) {}
export async function saveQuotaPolicy(input: QuotaPolicyInput) {}
export async function disableQuotaPolicy(policyId: string) {}
export async function getQuotaUsage(input: {
  ownerTribeId?: string;
  window?: "1h" | "24h" | "7d";
}) {}
```

- [x] **Step 3: Add local proxy routes**

Create local routes under `/api/local/quotas/*` using `apiCenterAdminRequest`. These routes must use the same server-only admin secret pattern as existing management API routes.

- [x] **Step 4: Run route/schema tests**

Run:

```powershell
Push-Location apicenter-management
npm test -- src/lib/quota-policy.test.ts src/app/api/local/quotas/policies/route.test.ts src/app/api/local/quotas/usage/route.test.ts
Pop-Location
```

Expected: Schemas parse API responses and local routes proxy safely.

### Task 7: Add Quota Operator Page

**Files:**

- Create: `apicenter-management/src/app/quotas/page.tsx`
- Create: `apicenter-management/src/components/tribe-quota-policy-panel.tsx`
- Create: `apicenter-management/src/components/tribe-quota-policy-panel.test.tsx`
- Create: `apicenter-management/src/components/tribe-quota-usage-panel.tsx`
- Create: `apicenter-management/src/components/tribe-quota-usage-panel.test.tsx`
- Modify: `apicenter-management/src/components/app-shell.tsx`
- Modify: `apicenter-management/src/components/tribe-onboarding-flow.tsx`

- [x] **Step 1: Add nav item**

Add `Quotas` under the `Govern` or `Operate` group in `app-shell.tsx`, using a lucide icon such as `GaugeIcon`.

- [x] **Step 2: Add policy panel**

The form must support:

```text
ownerTribeId
scope: all/shared/tribe/kafka_publish
targetServiceId optional
windowSeconds
maxRequests
burstRequests optional
mode: observe/enforce
reason required
```

Default mode must be `observe`.

- [x] **Step 3: Add usage panel**

Show:

```text
tribe
scope
target service
current window
request count
max requests
mode
outcome
last exceeded time
```

- [x] **Step 4: Add onboarding visibility**

In `tribe-onboarding-flow.tsx`, replace static quota text with real quota status when policies exist. If no policy exists, show `Default platform throttle applies`.

- [x] **Step 5: Run component tests**

Run:

```powershell
Push-Location apicenter-management
npm test -- src/components/tribe-quota-policy-panel.test.tsx src/components/tribe-quota-usage-panel.test.tsx
npm run typecheck
Pop-Location
```

Expected: Management can render and validate quota policy inputs.

---

## Phase 7: Shared Services SDK Quota Contract

**Purpose:** Make quota enforcement understandable for tribe developers and safe for automated clients.

### Task 8: Extend SDK Rate Limit Handling

**Files:**

- Modify: `api-shared-services/src/errors.ts`
- Modify: `api-shared-services/src/TribeClient.ts`
- Modify: `api-shared-services/src/types.ts`
- Modify: `api-shared-services/src/internal/http.ts`
- Create: `api-shared-services/src/quota.ts`
- Create: `api-shared-services/tests/quota-error.test.ts`

- [x] **Step 1: Write failing SDK tests**

Test that a `429` with `code=TRIBE_API_QUOTA_EXCEEDED` throws `RateLimitError` with:

```ts
{
  retryAfterMs: 60000,
  quota: {
    ownerTribeId: "campus-one",
    scope: "shared",
    targetServiceId: "payment-service",
    maxRequests: 100,
    windowSeconds: 60
  }
}
```

- [x] **Step 2: Extend `RateLimitError`**

Keep backward compatibility with current constructor and add optional quota detail:

```ts
export interface RateLimitDetail {
  ownerTribeId?: string;
  scope?: string;
  targetServiceId?: string;
  maxRequests?: number;
  windowSeconds?: number;
}
```

- [x] **Step 3: Parse retry headers and API body**

In the shared HTTP layer, parse `Retry-After`, `X-RateLimit-Reset`, and API Center error body quota details when present.

- [x] **Step 4: Run SDK tests**

Run:

```powershell
Push-Location api-shared-services
npm test -- tests/quota-error.test.ts
npm run typecheck
npm run build
Pop-Location
```

Expected: SDK maps quota responses into actionable typed errors.

---

## Phase 8: Shared-Service Manifest And Docs Alignment

**Purpose:** Keep service owners and tribe developers aligned with quota policy.

### Task 9: Add Optional Manifest Quota Hints

**Files:**

- Modify: `api-shared-services/contracts/service-manifest.schema.json`
- Modify: `api-shared-services/scripts/check-contract-compatibility.js`
- Modify: `api-shared-services/docs/consumer-runbook.md`
- Modify: `api-shared-services/docs/tribe-sdk-consumption.md`
- Modify: `api-shared-services/docs/tribe-sdk-shared-services-manual.md`
- Modify: `api-center/docs/developer/tribe-onboarding.md`
- Create: `api-center/docs/developer/tribe-api-quotas.md`

- [x] **Step 1: Add manifest hint fields**

Add optional `quotaHints` to shared-service manifests:

```json
{
  "quotaHints": {
    "recommendedWindowSeconds": 60,
    "recommendedMaxRequests": 100,
    "providerCostSensitive": true,
    "notes": "Payment calls should be lower than read-only lookup calls."
  }
}
```

These are hints only. Runtime enforcement still comes from API Center quota policies.

- [x] **Step 2: Update docs**

Create `api-center/docs/developer/tribe-api-quotas.md` with:

```markdown
# Tribe API Quotas

API Center supports configurable per-tribe API call limits. Operators can set a quota for all calls, one namespace, or one target service. Policies start in observe mode and can be switched to enforce mode after usage is reviewed.

When a tribe exceeds an enforced quota, API Center returns HTTP 429 with `code=TRIBE_API_QUOTA_EXCEEDED`. The SDK raises `RateLimitError` and includes retry/quota metadata when the gateway provides it.
```

- [x] **Step 3: Run docs and contract checks**

Run:

```powershell
Push-Location api-shared-services
npm run check:contracts
npm run test -- tests/manifest.test.ts
Pop-Location
```

Expected: Contract checks pass with optional quota hints.

---

## Phase 9: Platform-Wide Management Improvements

**Purpose:** Make APICenter feel like one product instead of disconnected runtime, management, and SDK repos.

### Task 10: Add Whole-Platform Operator Readiness

**Files:**

- Modify: `apicenter-management/src/lib/proposed-actions.ts`
- Modify: `apicenter-management/src/components/app-shell.tsx`
- Modify: `apicenter-management/docs/operations/apicenter-management-runbook.md`
- Modify: `api-center/docs/superpowers/plans/README.md`
- Modify: `apicenter-management/docs/superpowers/plans/README.md`

- [x] **Step 1: Add proposed quota actions**

Add proposed actions when:

```text
No active quota policy exists for a production tribe.
Observe-mode policy was exceeded in the last 24 hours.
Enforce-mode policy blocks more than 5% of calls in the last hour.
Provider-cost-sensitive shared service has no target-specific quota.
```

- [x] **Step 2: Link quota health to existing usage matrix**

The usage matrix should link to `/quotas?ownerTribeId=<tribe>` for a tribe row.

- [x] **Step 3: Update runbook**

Add an operator checklist:

```text
1. Create policy in observe mode.
2. Review 24 hours of usage.
3. Adjust maxRequests or burstRequests.
4. Switch to enforce with a reason.
5. Watch blocked decisions and SDK 429 handling.
6. Disable policy if it blocks a critical rollout unexpectedly.
```

- [x] **Step 4: Update plan indexes**

List this plan as active in both plan indexes until the runtime, management, and SDK slices are complete.

---

## Phase 10: Rollout And Verification

**Purpose:** Verify each repo independently, then verify the platform path end to end.

### Task 11: Run Local Gates

**Files:**

- No source changes.

- [x] **Step 1: API Center verification**

Run:

```powershell
Push-Location api-center
npm run db:validate
npm run test -- src/quotas/tribe-quota-policy.service.spec.ts src/quotas/tribe-quota-enforcer.service.spec.ts src/quotas/tribe-quota-admin.controller.spec.ts src/quotas/tribe-quota-usage.controller.spec.ts src/shared/proxy-handler.spec.ts src/kafka-governance/kafka-governance.controller.spec.ts --runInBand
npm run typecheck
npm run build
Pop-Location
```

Expected: API Center schema, quota tests, proxy tests, Kafka tests, typecheck, and build pass.

- [x] **Step 2: Management verification**

Run:

```powershell
Push-Location apicenter-management
npm test -- src/lib/quota-policy.test.ts src/app/api/local/quotas/policies/route.test.ts src/app/api/local/quotas/usage/route.test.ts src/components/tribe-quota-policy-panel.test.tsx src/components/tribe-quota-usage-panel.test.tsx
npm run typecheck
npm run build
Pop-Location
```

Expected: Management quota routes, components, typecheck, and build pass.

- [x] **Step 3: Shared services verification**

Run:

```powershell
Push-Location api-shared-services
npm run check:contracts
npm test -- tests/quota-error.test.ts tests/manifest.test.ts
npm run typecheck
npm run build
Pop-Location
```

Expected: SDK quota error handling, manifest checks, typecheck, and build pass.

### Task 12: End-To-End Quota Smoke

**Files:**

- Create: `api-center/scripts/smoke-tribe-quota.js`
- Modify: `api-center/package.json`

- [x] **Step 1: Add smoke script**

Create a script that:

```text
1. Creates or updates a test quota policy for ownerTribeId=quota-smoke.
2. Sets scope=shared, targetServiceId=payment-service, windowSeconds=60, maxRequests=2, mode=enforce.
3. Calls the same shared-service route three times through API Center.
4. Expects the first two calls to pass or reach the upstream.
5. Expects the third call to return HTTP 429 with code=TRIBE_API_QUOTA_EXCEEDED.
6. Disables the test policy.
```

- [x] **Step 2: Add package script**

Add to `api-center/package.json`:

```json
"smoke:tribe-quotas": "node scripts/smoke-tribe-quota.js"
```

- [x] **Step 3: Run smoke only after local API Center is configured**

Run:

```powershell
Push-Location api-center
npm run smoke:tribe-quotas
Pop-Location
```

Expected: The third call is blocked with HTTP 429 and the policy is disabled at the end.

Status 2026-05-25: smoke command was attempted with the available
`apicenter-management/.env.local` API Center URL and admin secret loaded, but
the run stopped before creating a quota policy because neither
`APICENTER_QUOTA_SMOKE_TOKEN` nor `APICENTER_QUOTA_SMOKE_SECRET` is configured
in the current environment.

Follow-up 2026-05-25: a fresh `quota-smoke` plaintext secret was generated
locally, its SHA-256 hash was added to GCP Secret Manager as
`api-center-test-tribe-secret-quota-smoke` through `gcloud`, and the
`quota-smoke` registry entry was created in the test API Center with
`consumes: ["payment"]`. The smoke then reached the deployed test gateway but
failed at `POST /api/v1/quotas/policies` with HTTP 404 (`Cannot POST
/api/v1/quotas/policies`), which means the current test deployment is still on
an image that does not include the quota policy endpoints. Keep this checkbox
open until the updated API Center image and quota migrations are deployed to
the smoke target.

Completion 2026-05-25: applied the quota, plan, and approval migrations to the
`api-center-test` database using the Secret Manager-backed migration helper;
deployed test image
`asia-southeast1-docker.pkg.dev/api-center-496422/api-center/api-center:platform-governance-quotas-9052cf5-2026052503`;
updated the smoke script to create and approve a scoped `quota.enforce`
approval before creating the enforced policy; reran `npm run
smoke:tribe-quotas` against `https://api-center-test.itsandbox.site` with
`APICENTER_QUOTA_SMOKE_TARGET_SERVICE_ID=payment`. Result: attempts 1 and 2
returned HTTP 200, attempt 3 returned HTTP 429
`TRIBE_API_QUOTA_EXCEEDED`, and the test policy was disabled.

---

## Phase 11: Tribe Plan Tiers And Entitlements

**Purpose:** Package quotas and platform access into clear tribe plans instead of one-off settings.

### Task 13: Add Plan Tier Model

**Files:**

- Create: `api-center/src/entitlements/entitlements.module.ts`
- Create: `api-center/src/entitlements/tribe-plan.types.ts`
- Create: `api-center/src/entitlements/tribe-plan.service.ts`
- Create: `api-center/src/entitlements/tribe-plan.service.spec.ts`
- Create: `api-center/src/entitlements/tribe-plan-admin.controller.ts`
- Create: `api-center/src/entitlements/tribe-plan-admin.controller.spec.ts`
- Modify: `api-center/prisma/schema.prisma`
- Create: `api-center/supabase/migrations/20260525001000_tribe_plan_entitlements.sql`
- Modify: `api-center/src/app.module.ts`
- Modify: `api-center/docs/developer/tribe-api-quotas.md`

- [x] **Step 1: Define tier names and defaults**

Use these first-pass plans:

```text
starter: 1,000 gateway calls/day, 100 Kafka publishes/day, standard retention, test-only provider-impacting smoke.
standard: 25,000 gateway calls/day, 5,000 Kafka publishes/day, standard retention, live shared-service access after approval.
pro: 250,000 gateway calls/day, 50,000 Kafka publishes/day, extended retention, priority support, live shared-service access.
enterprise: custom quotas, custom retention, dedicated onboarding, stricter approval policy.
```

- [x] **Step 2: Add durable tables**

Add tables for `tribe_plan_definitions` and `tribe_plan_assignments`. Assignments must reference `owner_tribe_id`, `plan_key`, `environment`, `status`, `effective_at`, and `reason`.

- [x] **Step 3: Make plan assignment generate quota policy proposals**

When a plan is assigned, API Center should return proposed quota policies. The first implementation should not auto-enforce; it should create proposed actions for Management.

- [x] **Step 4: Run entitlement tests**

Run:

```powershell
Push-Location api-center
npm run test -- src/entitlements/tribe-plan.service.spec.ts src/entitlements/tribe-plan-admin.controller.spec.ts --runInBand
npm run typecheck
Pop-Location
```

Expected: Plan assignments resolve tier defaults and produce quota policy proposals.

### Task 14: Add Management Plan Tier UI

**Files:**

- Create: `apicenter-management/src/app/plans/page.tsx`
- Create: `apicenter-management/src/components/tribe-plan-tier-panel.tsx`
- Create: `apicenter-management/src/components/tribe-plan-tier-panel.test.tsx`
- Modify: `apicenter-management/src/lib/schemas.ts`
- Modify: `apicenter-management/src/lib/api-center-client.ts`
- Modify: `apicenter-management/src/components/app-shell.tsx`
- Modify: `apicenter-management/src/components/tribe-quota-policy-panel.tsx`

- [x] **Step 1: Add plan schemas and API client helpers**

Add schemas for plan definitions, assignments, and generated quota proposals.

- [x] **Step 2: Add `Plans` page**

The page must show each plan tier, default quota package, shared-service access expectations, and assigned tribes.

- [x] **Step 3: Link plan tiers to quota policies**

From a plan assignment, operators should be able to open the quota page with proposed values prefilled in observe mode.

- [x] **Step 4: Run Management tests**

Run:

```powershell
Push-Location apicenter-management
npm test -- src/components/tribe-plan-tier-panel.test.tsx
npm run typecheck
Pop-Location
```

Expected: Plan tier UI renders defaults and generated quota proposals.

---

## Phase 12: Developer Portal Mode

**Purpose:** Give tribes a safe, read-only self-service portal for onboarding, quota visibility, SDK guidance, and runtime status.

### Task 15: Add Tribe-Facing Read APIs

**Files:**

- Create: `api-center/src/developer-portal/developer-portal.module.ts`
- Create: `api-center/src/developer-portal/developer-portal.controller.ts`
- Create: `api-center/src/developer-portal/developer-portal.controller.spec.ts`
- Modify: `api-center/src/app.module.ts`
- Modify: `api-center/src/registry/registry.service.ts`
- Modify: `api-center/src/quotas/tribe-quota-policy.service.ts`

- [x] **Step 1: Add read-only portal endpoint**

Expose:

```text
GET /api/v1/developer-portal/me
GET /api/v1/developer-portal/services
GET /api/v1/developer-portal/quotas
GET /api/v1/developer-portal/topics
GET /api/v1/developer-portal/onboarding
```

All routes must resolve the caller from JWT `tribeId` and must not accept arbitrary `ownerTribeId` query overrides.

- [x] **Step 2: Return tribe-safe data only**

Responses can include service IDs, registered routes, scopes, quota status, usage summaries, event topic names, onboarding checklist state, SDK examples, and secret version metadata. Responses must not include platform admin secrets, provider credentials, or plaintext tribe secrets.

- [x] **Step 3: Run portal API tests**

Run:

```powershell
Push-Location api-center
npm run test -- src/developer-portal/developer-portal.controller.spec.ts --runInBand
Pop-Location
```

Expected: A tribe can read only its own portal data.

### Task 16: Add Management Developer Portal Preview

**Files:**

- Create: `apicenter-management/src/app/developer-portal/page.tsx`
- Create: `apicenter-management/src/components/developer-portal-preview.tsx`
- Create: `apicenter-management/src/components/developer-portal-preview.test.tsx`
- Modify: `apicenter-management/src/components/app-shell.tsx`
- Modify: `apicenter-management/src/components/tribe-onboarding-packet-panel.tsx`
- Modify: `api-shared-services/docs/consumer-runbook.md`

- [x] **Step 1: Add portal preview page**

Management should show what a tribe will see without giving operators plaintext secrets.

- [x] **Step 2: Add sendable onboarding packet improvements**

The portal packet should include SDK install, API Center base URL, allowed services, scopes, quota policy, event topic, and support contact.

- [x] **Step 3: Run preview tests**

Run:

```powershell
Push-Location apicenter-management
npm test -- src/components/developer-portal-preview.test.tsx
npm run typecheck
Pop-Location
```

Expected: The preview renders tribe-safe portal data and docs links.

---

## Phase 13: Approval Workflow And Policy Engine

**Purpose:** Move risky live changes from direct action buttons to request, preview, approval, execution, and audit.

### Task 17: Add Approval Requests

**Files:**

- Create: `api-center/src/approvals/approvals.module.ts`
- Create: `api-center/src/approvals/approval-request.types.ts`
- Create: `api-center/src/approvals/approval-request.service.ts`
- Create: `api-center/src/approvals/approval-request.service.spec.ts`
- Create: `api-center/src/approvals/approval-request.controller.ts`
- Create: `api-center/src/approvals/approval-request.controller.spec.ts`
- Modify: `api-center/prisma/schema.prisma`
- Create: `api-center/supabase/migrations/20260525002000_approval_requests.sql`
- Modify: `api-center/src/app.module.ts`

- [x] **Step 1: Add approval request model**

Support action types:

```text
quota.enforce
secret.rotate
topic.provision
s3_sink.include_topic
service.register_live
service.retire
plan.assign_live
```

- [x] **Step 2: Require preview payloads**

Every approval request must store `before`, `after`, `riskLevel`, `reason`, `requestedBy`, and `targetEnvironment`.

- [x] **Step 3: Enforce approval before live risky actions**

Live quota enforcement, live service registration, and live service retirement must require an approved request ID.

- [x] **Step 4: Run approval tests**

Run:

```powershell
Push-Location api-center
npm run test -- src/approvals/approval-request.service.spec.ts src/approvals/approval-request.controller.spec.ts --runInBand
Pop-Location
```

Expected: Risky live actions cannot execute without approval.

### Task 18: Add Explainable Policy Rules

**Files:**

- Create: `api-center/src/policy/policy-engine.module.ts`
- Create: `api-center/src/policy/policy-rule.types.ts`
- Create: `api-center/src/policy/policy-engine.service.ts`
- Create: `api-center/src/policy/policy-engine.service.spec.ts`
- Modify: `api-center/src/shared/proxy-handler.ts`
- Modify: `api-center/src/kafka-governance/kafka-governance.controller.ts`

- [x] **Step 1: Define initial rules**

Add rules:

```text
policy.shared_service_requires_active_plan
policy.live_calls_require_active_quota
policy.experimental_service_blocked_in_live
policy.deprecated_service_warn_after_sunset
policy.provider_cost_sensitive_requires_target_quota
```

- [x] **Step 2: Return rule explanations**

Every policy warning/block must include:

```ts
{
  ruleId: string;
  decision: "allow" | "warn" | "block";
  reason: string;
  nextAction: string;
}
```

- [x] **Step 3: Run policy tests**

Run:

```powershell
Push-Location api-center
npm run test -- src/policy/policy-engine.service.spec.ts --runInBand
Pop-Location
```

Expected: Initial rules produce deterministic allow, warn, or block decisions.

---

## Phase 14: Reliability, Product Catalog, And Incident Support

**Purpose:** Make Management answer operational questions quickly: what exists, who owns it, who is affected, what changed, and what to do next.

### Task 19: Add API Product Catalog

**Files:**

- Create: `apicenter-management/src/app/api-catalog/page.tsx`
- Create: `apicenter-management/src/components/api-product-catalog.tsx`
- Create: `apicenter-management/src/components/api-product-catalog.test.tsx`
- Modify: `apicenter-management/src/lib/api-center-client.ts`
- Modify: `api-shared-services/contracts/service-manifest.schema.json`
- Modify: `api-center/src/shared/dto/service-manifest.dto.ts`

- [x] **Step 1: Extend service metadata**

Add optional catalog fields:

```text
apiProductName
apiProductDescription
slaTier
supportChannel
documentationUrl
providerCostSensitive
```

- [x] **Step 2: Render catalog**

Catalog rows must show owner, service type, lifecycle status, scopes, plan/entitlement requirement, quota hint, SLA tier, and docs link.

- [x] **Step 3: Run catalog tests**

Run:

```powershell
Push-Location apicenter-management
npm test -- src/components/api-product-catalog.test.tsx
Pop-Location
```

Expected: Operators can scan shared services and tribe APIs as platform products.

### Task 20: Add Per-Tribe Reliability And Incident View

**Files:**

- Create: `apicenter-management/src/app/reliability/page.tsx`
- Create: `apicenter-management/src/components/tribe-reliability-panel.tsx`
- Create: `apicenter-management/src/components/tribe-reliability-panel.test.tsx`
- Create: `apicenter-management/src/components/incident-support-panel.tsx`
- Create: `apicenter-management/src/components/incident-support-panel.test.tsx`
- Modify: `apicenter-management/src/lib/proposed-actions.ts`
- Modify: `api-center/src/analytics/analytics.controller.ts`

- [x] **Step 1: Add reliability metrics**

Show per tribe:

```text
uptime proxy success rate
p95 latency
failed shared-service calls
quota observed/exceeded/blocked counts
Kafka publish failures
recent deploy/config changes
affected services
```

- [x] **Step 2: Add incident mode**

For a selected service or tribe, show recent failures, related audit events, recent policy changes, active quota policies, provider status, and recommended runbook links.

- [x] **Step 3: Run reliability tests**

Run:

```powershell
Push-Location apicenter-management
npm test -- src/components/tribe-reliability-panel.test.tsx src/components/incident-support-panel.test.tsx
npm run typecheck
Pop-Location
```

Expected: Reliability and incident panels render actionable, tribe-scoped evidence.

---

## Phase 15: SDK Key Rotation And Environment Promotion

**Purpose:** Make security and production rollout repeatable instead of manual.

### Task 21: Add SDK Key Rotation Workflow

**Files:**

- Create: `api-center/src/secrets/tribe-secret-rotation.service.ts`
- Create: `api-center/src/secrets/tribe-secret-rotation.service.spec.ts`
- Modify: `api-center/src/auth/auth.service.ts`
- Modify: `apicenter-management/src/components/tribe-secret-card.tsx`
- Modify: `apicenter-management/docs/operations/apicenter-management-runbook.md`
- Modify: `api-shared-services/docs/consumer-runbook.md`

- [x] **Step 1: Add dual-valid rotation states**

Support:

```text
active_current
active_dual_valid
old_pending_revoke
old_revoked
```

- [x] **Step 2: Add Management workflow**

Workflow:

```text
Generate new secret.
Show secure handoff instructions.
Verify tribe SDK uses new secret.
Revoke old secret after confirmation window.
Record audit evidence.
```

- [x] **Step 3: Run rotation tests**

Run:

```powershell
Push-Location api-center
npm run test -- src/secrets/tribe-secret-rotation.service.spec.ts --runInBand
Pop-Location
```

Expected: Secret rotation supports dual-valid handoff and safe old-secret revocation.

### Task 22: Add Environment Promotion Gates

**Files:**

- Create: `api-center/src/promotions/environment-promotion.service.ts`
- Create: `api-center/src/promotions/environment-promotion.service.spec.ts`
- Create: `apicenter-management/src/app/promotions/page.tsx`
- Create: `apicenter-management/src/components/environment-promotion-panel.tsx`
- Create: `apicenter-management/src/components/environment-promotion-panel.test.tsx`
- Modify: `apicenter-management/src/components/app-shell.tsx`

- [x] **Step 1: Define promotion checklist**

A tribe/service can move from test to live only when:

```text
health check passes
smoke test passes
owner/contact are present
quota policy exists in observe mode or enforce mode
plan tier is assigned
event topic exists when the service publishes events
S3 sink inclusion exists when pipeline export is required
SDK handoff packet exists
approval request is approved for live registration
```

- [x] **Step 2: Add Management promotion panel**

Show pass/fail gates, missing evidence, and proposed actions.

- [x] **Step 3: Run promotion tests**

Run:

```powershell
Push-Location apicenter-management
npm test -- src/components/environment-promotion-panel.test.tsx
npm run typecheck
Pop-Location
```

Expected: Promotion panel blocks live rollout until required evidence exists.

---

## Acceptance Criteria

- API Center stores active and disabled quota policies durably.
- Operators can set per-tribe API call limits from Management.
- Policies support `observe` and `enforce` mode.
- Policies can apply to all calls, shared-service calls, tribe-service calls, Kafka publish calls, or a specific target service.
- API Center blocks enforced quota breaches with HTTP 429 and `TRIBE_API_QUOTA_EXCEEDED`.
- SDK maps quota breaches to `RateLimitError` with retry/quota metadata.
- Management shows quota usage and quota breach history.
- Quota decisions are auditable and tied to `ownerTribeId`, `routeFamily`, and `correlationId`.
- Existing global Redis throttling remains in place as baseline protection.
- Shared-service manifests can include quota hints, but hints do not override runtime policy.
- Runbooks explain observe-to-enforce rollout.
- Operators can assign tribe plan tiers and generate quota proposals from those tiers.
- Tribes have a read-only developer portal view for their services, quotas, topics, SDK docs, and onboarding state.
- Risky live actions can require approval before execution.
- Policy blocks and warnings are explainable with rule IDs and next actions.
- Management includes API product catalog, per-tribe reliability, incident support, SDK key rotation, and environment promotion surfaces.

## Out Of Scope

- Billing invoices or automated charging.
- Per-end-user quotas inside a tribe application.
- Direct Confluent credential sharing with tribes.
- Raw S3 access for quota analytics.
- Automatic production enforcement without operator review.
- Full public marketplace packaging.
- Automated monetary billing collection.
- Tribe self-service writes before the read-only developer portal is proven.

## Rollback Plan

1. Disable a problematic policy by setting `status=disabled`.
2. If the management UI is wrong, use API Center admin routes directly.
3. If the enforcer causes broad issues, set all active policies to `observe`.
4. If Redis quota counters are inconsistent, clear only keys with the quota prefix; do not clear existing throttler keys.
5. Keep global throttling enabled throughout rollback.

## Self-Review

- Spec coverage: Covers API Center runtime, APICenter Management, API Shared Services/SDK, docs, governance, verification, and the requested configurable tribe API call limit.
- Placeholder scan: No intentional placeholder tasks remain; each phase has exact files, expected behavior, and verification commands.
- Type consistency: Uses `ownerTribeId`, `scope`, `targetServiceId`, `windowSeconds`, `maxRequests`, `mode`, `status`, `planKey`, `ruleId`, and `approvalRequestId` consistently across API Center, Management, and SDK.
