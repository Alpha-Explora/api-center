# APICenter Code Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce avoidable APICenter runtime work, database fan-out, client bundle weight, and sequential network latency across the four repos in `C:\Codes\apic`.

**Architecture:** Keep the first optimization pass focused on proven hotspots from the code review: batch repeated database lookups, add in-memory registry indexes, cache SDK discovery briefly, bound external API concurrency, and split large management client surfaces by active route section. Each change must be behavior-preserving and covered by tests before broader refactors.

**Tech Stack:** NestJS, Prisma, Redis-backed registry cache, Next.js 16, React Query, TypeScript SDK, Vitest/Jest, Supabase, GitHub REST API.

---

## File Structure

Backend runtime optimizations:

- Modify: `api-center/src/operations/consumer-scorecard.controller.ts`
- Test: `api-center/src/operations/consumer-scorecard.controller.spec.ts`
- Modify: `api-center/src/registry/registry.service.ts`
- Test: `api-center/src/registry/registry.service.spec.ts`
- Test: `api-center/src/shared/proxy-handler.spec.ts`

SDK discovery optimization:

- Modify: `api-shared-services/src/TribeClient.ts`
- Test: `api-shared-services/src/TribeClient.test.ts`

Control Tower ingestion optimization:

- Modify: `control-tower/src/app/api/ingestion/github/workflow-runs/sync/route.ts`
- Test: `control-tower/src/app/api/ingestion/github/workflow-runs/sync/route.test.ts`
- Modify: `control-tower/src/lib/alerts/dispatch.ts`
- Test: `control-tower/src/lib/alerts/dispatch.test.ts`

Management UI/server optimization:

- Create: `apicenter-management/src/components/service-detail/service-detail-sections.tsx`
- Modify: `apicenter-management/src/components/service-detail-client.tsx`
- Test: `apicenter-management/src/components/service-detail-client.test.tsx`
- Create: `apicenter-management/src/app/api/local/developer-portal/[tribeId]/route.ts`
- Modify: `apicenter-management/src/components/developer-portal-preview.tsx`
- Test: `apicenter-management/src/components/developer-portal-preview.test.tsx`

Docs:

- Modify: `api-center/docs/superpowers/plans/README.md`

---

## Scope And Ordering

This plan intentionally does not combine performance work with UI redesign, data-model changes, or deployment changes. Execute in this order:

1. Backend query fan-out and registry indexing.
2. SDK discovery cache.
3. Control Tower bounded concurrency.
4. Management client bundle and tribe-scoped portal endpoint.
5. Verification across all affected repos.

Do not stage unrelated dirty files in `apicenter-management`; that repo may contain command-center redesign work outside this plan.

---

### Task 1: Batch Consumer Scorecard Quota Reads

**Files:**
- Modify: `api-center/src/operations/consumer-scorecard.controller.ts`
- Test: `api-center/src/operations/consumer-scorecard.controller.spec.ts`

- [ ] **Step 1: Write the failing scorecard batching test**

Create `api-center/src/operations/consumer-scorecard.controller.spec.ts` if it does not exist. Add this test shape:

```ts
import { ConsumerScorecardController } from "./consumer-scorecard.controller";

describe("ConsumerScorecardController", () => {
  it("loads quota decisions once for distinct owner tribes", async () => {
    const registry = {
      getAll: jest.fn().mockReturnValue({
        orders: {
          serviceId: "orders",
          ownerTribeId: "commerce",
          status: "active",
        },
        checkout: {
          serviceId: "checkout",
          ownerTribeId: "commerce",
          status: "active",
        },
        logistics: {
          serviceId: "logistics",
          status: "active",
        },
      }),
    };
    const scorecards = {
      score: jest.fn((input) => ({
        ownerTribeId: input.ownerTribeId,
        quotaUsagePercent: input.quotaUsagePercent,
      })),
    };
    const quotaFindMany = jest.fn().mockResolvedValue([
      { ownerTribeId: "commerce", requestCount: 90, maxRequests: 100 },
      { ownerTribeId: "logistics", requestCount: 10, maxRequests: 100 },
    ]);
    const prisma = {
      tribeApiQuotaDecision: {
        findMany: quotaFindMany,
      },
    };
    const gatewayTraffic = {
      getSummary: jest.fn().mockResolvedValue({
        totalProxyRequests: 0,
        status4xx: 0,
        status5xx: 0,
      }),
    };

    const controller = new ConsumerScorecardController(
      registry as never,
      scorecards as never,
      prisma as never,
      gatewayTraffic as never,
    );

    const response = await controller.list();

    expect(quotaFindMany).toHaveBeenCalledTimes(1);
    expect(quotaFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ownerTribeId: {
            in: ["commerce", "logistics"],
          },
        },
      }),
    );
    expect(response.data).toEqual([
      expect.objectContaining({ ownerTribeId: "commerce", quotaUsagePercent: 90 }),
      expect.objectContaining({ ownerTribeId: "commerce", quotaUsagePercent: 90 }),
      expect.objectContaining({ ownerTribeId: "logistics", quotaUsagePercent: 10 }),
    ]);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
cd C:\Codes\apic\api-center
npm test -- src/operations/consumer-scorecard.controller.spec.ts
```

Expected: FAIL because the controller currently calls `findMany()` once per service owner through `getQuotaUsagePercent()`.

- [ ] **Step 3: Implement batch quota loading**

In `api-center/src/operations/consumer-scorecard.controller.ts`, extend the row shape and replace the per-owner helper with a map-based helper:

```ts
interface QuotaDecisionRow {
  ownerTribeId: string;
  requestCount: number;
  maxRequests: number;
}

private async getQuotaUsageByOwner(
  ownerTribeIds: string[],
): Promise<Map<string, ConsumerScorecardMetric>> {
  const result = new Map<string, ConsumerScorecardMetric>();
  const uniqueOwnerIds = [...new Set(ownerTribeIds)].sort();

  for (const ownerTribeId of uniqueOwnerIds) {
    result.set(ownerTribeId, "unknown");
  }

  if (!this.quotaDecisions || uniqueOwnerIds.length === 0) {
    return result;
  }

  const rows = await this.quotaDecisions.findMany({
    where: {
      ownerTribeId: {
        in: uniqueOwnerIds,
      },
    },
    orderBy: { createdAt: "desc" },
    take: uniqueOwnerIds.length * 200,
  });

  const rowsByOwner = new Map<string, QuotaDecisionRow[]>();
  for (const row of rows) {
    rowsByOwner.set(row.ownerTribeId, [
      ...(rowsByOwner.get(row.ownerTribeId) ?? []),
      row,
    ]);
  }

  for (const [ownerTribeId, ownerRows] of rowsByOwner.entries()) {
    result.set(
      ownerTribeId,
      Math.max(
        ...ownerRows.map((row) =>
          row.maxRequests > 0
            ? Math.round((row.requestCount / row.maxRequests) * 100)
            : 0,
        ),
      ),
    );
  }

  return result;
}
```

Then update `list()`:

```ts
const services = Object.values(this.registry.getAll());
const ownerTribeIds = services.map(
  (service) => service.ownerTribeId ?? service.serviceId,
);
const quotaUsageByOwner = await this.getQuotaUsageByOwner(ownerTribeIds);
const data = services.map((service) => {
  const ownerTribeId = service.ownerTribeId ?? service.serviceId;
  return this.scorecards.score({
    ownerTribeId,
    sdkVersion: readSdkVersion(service),
    latestSdkVersion,
    quotaUsagePercent: quotaUsageByOwner.get(ownerTribeId) ?? "unknown",
    errorRatePercent: gatewayErrorRate,
  });
});
```

- [ ] **Step 4: Run focused tests**

Run:

```powershell
cd C:\Codes\apic\api-center
npm test -- src/operations/consumer-scorecard.controller.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```powershell
cd C:\Codes\apic\api-center
git add src/operations/consumer-scorecard.controller.ts src/operations/consumer-scorecard.controller.spec.ts
git commit -m "perf: batch scorecard quota reads"
```

---

### Task 2: Add Registry Owner And Consumer Indexes

**Files:**
- Modify: `api-center/src/registry/registry.service.ts`
- Test: `api-center/src/registry/registry.service.spec.ts`
- Test: `api-center/src/shared/proxy-handler.spec.ts`

- [ ] **Step 1: Write failing registry index behavior tests**

In `api-center/src/registry/registry.service.spec.ts`, add tests for owned-service lookup and consumers after register/update:

```ts
it("keeps owner and consumer indexes current after registration updates", async () => {
  await service.register({
    serviceId: "orders",
    name: "Orders",
    baseUrl: "https://orders.example.test",
    requiredScopes: ["orders:read"],
    exposes: ["/orders"],
    consumes: ["payment"],
    ownerTribeId: "commerce",
    serviceType: "tribe",
  });
  await service.register({
    serviceId: "checkout",
    name: "Checkout",
    baseUrl: "https://checkout.example.test",
    requiredScopes: ["checkout:read"],
    exposes: ["/checkout"],
    consumes: ["payment"],
    ownerTribeId: "commerce",
    serviceType: "tribe",
  });
  await service.register({
    serviceId: "orders",
    name: "Orders",
    baseUrl: "https://orders.example.test",
    requiredScopes: ["orders:read"],
    exposes: ["/orders"],
    consumes: ["email"],
    ownerTribeId: "fulfillment",
    serviceType: "tribe",
  });

  expect(service.getOwnedServices("commerce").map((entry) => entry.serviceId)).toEqual([
    "checkout",
  ]);
  expect(service.getOwnedServices("fulfillment").map((entry) => entry.serviceId)).toEqual([
    "orders",
  ]);
  expect(service.getConsumers("payment")).toEqual(["checkout"]);
  expect(service.getConsumers("email")).toEqual(["orders"]);
});
```

- [ ] **Step 2: Run the registry test and verify it fails or proves current O(n) behavior**

Run:

```powershell
cd C:\Codes\apic\api-center
npm test -- src/registry/registry.service.spec.ts
```

Expected: PASS on behavior or FAIL if an update edge case is exposed. Either result is acceptable before implementation because this task is optimizing behavior-preserving paths; the next test run must stay green.

- [ ] **Step 3: Add indexes and rebuild helpers**

In `api-center/src/registry/registry.service.ts`, add private maps:

```ts
private readonly servicesByOwnerTribeId = new Map<string, Set<string>>();
private readonly consumersByTargetServiceId = new Map<string, Set<string>>();
```

Add helpers near the private registry helpers:

```ts
private reindexService(entry: ServiceRegistryEntry, previous?: ServiceRegistryEntry): void {
  if (previous) {
    this.removeServiceFromIndexes(previous);
  }

  if ((entry.serviceType ?? "tribe") === "tribe") {
    const ownerTribeId = entry.ownerTribeId ?? entry.serviceId;
    this.addIndexedValue(this.servicesByOwnerTribeId, ownerTribeId, entry.serviceId);
  }

  for (const targetServiceId of entry.consumes ?? []) {
    this.addIndexedValue(
      this.consumersByTargetServiceId,
      targetServiceId,
      entry.serviceId,
    );
  }
}

private removeServiceFromIndexes(entry: ServiceRegistryEntry): void {
  const ownerTribeId = entry.ownerTribeId ?? entry.serviceId;
  this.removeIndexedValue(this.servicesByOwnerTribeId, ownerTribeId, entry.serviceId);

  for (const targetServiceId of entry.consumes ?? []) {
    this.removeIndexedValue(
      this.consumersByTargetServiceId,
      targetServiceId,
      entry.serviceId,
    );
  }
}

private addIndexedValue(
  index: Map<string, Set<string>>,
  key: string,
  value: string,
): void {
  const values = index.get(key) ?? new Set<string>();
  values.add(value);
  index.set(key, values);
}

private removeIndexedValue(
  index: Map<string, Set<string>>,
  key: string,
  value: string,
): void {
  const values = index.get(key);
  if (!values) return;
  values.delete(value);
  if (values.size === 0) {
    index.delete(key);
  }
}

private rebuildRegistryIndexes(): void {
  this.servicesByOwnerTribeId.clear();
  this.consumersByTargetServiceId.clear();

  for (const entry of Object.values(this.services)) {
    this.reindexService(entry);
  }
}
```

Call `this.reindexService(entry, existing);` after a successful registration assignment, call `this.removeServiceFromIndexes(entry);` when a service is fully deregistered, and call `this.rebuildRegistryIndexes();` after Redis/Postgres bootstrap loads replace `this.services`.

Update lookups:

```ts
getConsumers(serviceId: string): string[] {
  return [...(this.consumersByTargetServiceId.get(serviceId) ?? [])].sort();
}

getOwnedServices(tribeId: string): ServiceRegistryEntry[] {
  return [...(this.servicesByOwnerTribeId.get(tribeId) ?? [])]
    .map((serviceId) => this.services[serviceId])
    .filter((service): service is ServiceRegistryEntry => Boolean(service));
}
```

- [ ] **Step 4: Run registry and proxy tests**

Run:

```powershell
cd C:\Codes\apic\api-center
npm test -- src/registry/registry.service.spec.ts src/shared/proxy-handler.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```powershell
cd C:\Codes\apic\api-center
git add src/registry/registry.service.ts src/registry/registry.service.spec.ts src/shared/proxy-handler.spec.ts
git commit -m "perf: index registry ownership lookups"
```

---

### Task 3: Cache SDK Service Discovery Briefly

**Files:**
- Modify: `api-shared-services/src/TribeClient.ts`
- Test: `api-shared-services/src/TribeClient.test.ts`

- [ ] **Step 1: Write the failing SDK cache test**

In `api-shared-services/src/TribeClient.test.ts`, add:

```ts
it("reuses service discovery within the configured cache ttl", async () => {
  const request = vi.fn()
    .mockResolvedValueOnce([
      {
        serviceId: "orders",
        name: "Orders",
        status: "active",
        requiredScopes: ["orders:read"],
        exposes: ["/orders"],
      },
    ])
    .mockResolvedValueOnce([]);
  const client = new TribeClient({
    baseUrl: "https://api-center.example.test",
    tribeId: "commerce",
    serviceId: "orders",
    serviceSecret: "secret",
    discoveryCacheTtlMs: 60_000,
  });
  vi.spyOn(client as never, "ensureAuth").mockResolvedValue(undefined);
  vi.spyOn(client as never, "request").mockImplementation(request);

  await client.getService("orders");
  await client.getService("orders");

  expect(request).toHaveBeenCalledTimes(2);
});
```

The two calls are expected because `listAllServices()` loads tribe and shared namespaces once. The second `getService()` must not trigger two more requests.

- [ ] **Step 2: Run the SDK test and verify it fails**

Run:

```powershell
cd C:\Codes\apic\api-shared-services
npm test -- src/TribeClient.test.ts
```

Expected: FAIL because `getService()` calls `listAllServices()` every time.

- [ ] **Step 3: Add cache options and invalidation**

In `api-shared-services/src/TribeClient.ts`, add an option:

```ts
discoveryCacheTtlMs?: number;
```

Add private fields:

```ts
private readonly discoveryCacheTtlMs: number;
private serviceDiscoveryCache:
  | { expiresAt: number; services: ServiceDiscoveryEntry[] }
  | undefined;
```

Initialize:

```ts
this.discoveryCacheTtlMs = options.discoveryCacheTtlMs ?? 15_000;
```

Update `listAllServices()`:

```ts
async listAllServices(options: { refresh?: boolean } = {}): Promise<ServiceDiscoveryEntry[]> {
  await this.ensureAuth();

  const now = Date.now();
  if (
    !options.refresh &&
    this.serviceDiscoveryCache &&
    this.serviceDiscoveryCache.expiresAt > now
  ) {
    return this.serviceDiscoveryCache.services;
  }

  const [tribeServices, sharedServices] = await Promise.all([
    this.listNamespaceServices("/api/v1/tribes"),
    this.listNamespaceServices("/api/v1/shared"),
  ]);

  const servicesById = new Map<string, ServiceDiscoveryEntry>();
  for (const service of [...tribeServices, ...sharedServices]) {
    servicesById.set(service.serviceId, service);
  }

  const services = [...servicesById.values()];
  this.serviceDiscoveryCache = {
    expiresAt: now + this.discoveryCacheTtlMs,
    services,
  };
  return services;
}

clearServiceDiscoveryCache(): void {
  this.serviceDiscoveryCache = undefined;
}
```

- [ ] **Step 4: Run SDK tests**

Run:

```powershell
cd C:\Codes\apic\api-shared-services
npm test -- src/TribeClient.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```powershell
cd C:\Codes\apic\api-shared-services
git add src/TribeClient.ts src/TribeClient.test.ts
git commit -m "perf: cache service discovery in sdk"
```

---

### Task 4: Bound Control Tower GitHub Sync Concurrency

**Files:**
- Modify: `control-tower/src/app/api/ingestion/github/workflow-runs/sync/route.ts`
- Test: `control-tower/src/app/api/ingestion/github/workflow-runs/sync/route.test.ts`

- [ ] **Step 1: Write a unit test for bounded concurrency**

Export a small helper from the route file:

```ts
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () =>
      runWorker(),
    ),
  );
  return results;
}
```

Add a test in `route.test.ts`:

```ts
it("limits concurrent workers", async () => {
  let active = 0;
  let maxActive = 0;

  const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return value * 2;
  });

  expect(results).toEqual([2, 4, 6, 8, 10]);
  expect(maxActive).toBeLessThanOrEqual(2);
});
```

- [ ] **Step 2: Run the route test and verify it fails before exporting helper**

Run:

```powershell
cd C:\Codes\apic\control-tower
npm test -- src/app/api/ingestion/github/workflow-runs/sync/route.test.ts
```

Expected: FAIL until `mapWithConcurrency` is exported.

- [ ] **Step 3: Apply bounded concurrency to repositories and runs**

In `route.ts`, replace the nested sequential loops with helpers:

```ts
const repoResults = await mapWithConcurrency(repos, 3, async (repository) => {
  try {
    const runs = await fetchWorkflowRuns(repository, githubToken, perRepoLimit);
    return await mapWithConcurrency(runs, 4, async (run) => {
      try {
        const record = await upsertWorkflowRunFromSync(supabase, repository, run);
        const jobs = await fetchWorkflowJobs(repository, record.run_id, githubToken);
        const jobsIngested = await upsertWorkflowJobsFromSync(supabase, {
          repository,
          runId: record.run_id,
          runAttempt: record.run_attempt,
          tribe: record.tribe,
          branch: record.branch,
          environment: record.environment,
          jobs,
        });

        return {
          type: "ingested" as const,
          record: { ...record, jobs_ingested: jobsIngested },
          jobsIngested,
        };
      } catch (error) {
        return {
          type: "run-error" as const,
          repository,
          runId: run.id ?? null,
          error: error instanceof Error ? error.message : "Unknown run ingestion error",
        };
      }
    });
  } catch (error) {
    return [
      {
        type: "repo-error" as const,
        repository,
        error: error instanceof Error ? error.message : "Unknown repository sync error",
      },
    ];
  }
});
```

Then flatten results and populate `repoErrors`, `runErrors`, `ingested`, and `jobIngestedCount` from the result objects in one loop. Preserve existing response shape and status code.

- [ ] **Step 4: Run Control Tower tests**

Run:

```powershell
cd C:\Codes\apic\control-tower
npm test -- src/app/api/ingestion/github/workflow-runs/sync/route.test.ts
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```powershell
cd C:\Codes\apic\control-tower
git add src/app/api/ingestion/github/workflow-runs/sync/route.ts src/app/api/ingestion/github/workflow-runs/sync/route.test.ts
git commit -m "perf: bound github sync concurrency"
```

---

### Task 5: Collapse In-App Alert Dispatch Fan-Out

**Files:**
- Modify: `control-tower/src/lib/alerts/dispatch.ts`
- Test: `control-tower/src/lib/alerts/dispatch.test.ts`

- [ ] **Step 1: Write the duplicate notification test**

In `control-tower/src/lib/alerts/dispatch.test.ts`, add a test that creates two alerts for the same tribe and asserts membership is read once:

```ts
it("loads notification recipients once per tribe during dispatch", async () => {
  const from = vi.fn((table: string) => {
    if (table === "alert_channels") {
      return {
        select: () => ({
          eq: async () => ({ data: [] }),
        }),
      };
    }

    if (table === "user_tribe_membership") {
      return {
        select: () => ({
          eq: () => ({
            or: async () => ({ data: [{ user_id: "user-1" }] }),
          }),
        }),
      };
    }

    return {
      insert: vi.fn().mockResolvedValue({ error: null }),
    };
  });

  vi.mocked(createSupabaseAdminClient).mockReturnValue({ from } as never);

  await dispatchAlerts([
    makeAlert({ id: "rule-a", tribe: "commerce" }),
    makeAlert({ id: "rule-b", tribe: "commerce" }),
  ]);

  expect(from.mock.calls.filter(([table]) => table === "user_tribe_membership")).toHaveLength(1);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
cd C:\Codes\apic\control-tower
npm test -- src/lib/alerts/dispatch.test.ts
```

Expected: FAIL because `dispatchInAppNotifications()` currently creates a client and queries recipients per alert.

- [ ] **Step 3: Add recipient cache within one dispatch call**

In `dispatchAlerts()`, create one Supabase client and a recipient cache:

```ts
const recipientsByTribe = new Map<string, Promise<string[]>>();
const loadRecipients = (tribe: string | null) => {
  const key = tribe ?? "__platform_admins__";
  if (!recipientsByTribe.has(key)) {
    recipientsByTribe.set(key, loadNotificationRecipients(supabase, tribe));
  }
  return recipientsByTribe.get(key)!;
};
```

Replace in-app dispatch calls with:

```ts
await dispatchInAppNotifications(supabase, alert, await loadRecipients(alert.tribe));
```

Add helpers:

```ts
async function loadNotificationRecipients(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  tribe: string | null,
): Promise<string[]> {
  let membersQuery = supabase
    .from("user_tribe_membership")
    .select("user_id")
    .eq("is_active", true);

  if (tribe) {
    membersQuery = membersQuery.or(`tribe.eq.${tribe},role.eq.platform_admin`);
  } else {
    membersQuery = membersQuery.eq("role", "platform_admin");
  }

  const { data: members } = await membersQuery;
  return [...new Set((members ?? []).map((member) => member.user_id as string))];
}
```

Change `dispatchInAppNotifications()` to accept `supabase` and `userIds` instead of creating a new client and querying.

- [ ] **Step 4: Run alert dispatch tests**

Run:

```powershell
cd C:\Codes\apic\control-tower
npm test -- src/lib/alerts/dispatch.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

```powershell
cd C:\Codes\apic\control-tower
git add src/lib/alerts/dispatch.ts src/lib/alerts/dispatch.test.ts
git commit -m "perf: reuse alert notification recipients"
```

---

### Task 6: Split Management Service Detail Sections

**Files:**
- Create: `apicenter-management/src/components/service-detail/service-detail-sections.tsx`
- Modify: `apicenter-management/src/components/service-detail-client.tsx`
- Test: `apicenter-management/src/components/service-detail-client.test.tsx`

- [ ] **Step 1: Add a regression test for section rendering**

In `service-detail-client.test.tsx`, add:

```tsx
it("renders only the selected service detail section", async () => {
  render(
    <ServiceDetailClient
      serviceId="orders"
      initialService={makeService({ serviceId: "orders" })}
      initialSection="dependencies"
    />,
  );

  expect(await screen.findByText("Dependency map")).toBeTruthy();
  expect(screen.queryByText("Contract tester")).toBeNull();
  expect(screen.queryByText("Promotion evidence")).toBeNull();
});
```

- [ ] **Step 2: Run the test**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/components/service-detail-client.test.tsx
```

Expected: PASS before refactor. This protects behavior while reducing bundle coupling.

- [ ] **Step 3: Create section components and lazy boundaries**

Create `service-detail-sections.tsx` with focused exports:

```tsx
"use client";

import dynamic from "next/dynamic";

export const HealthSection = dynamic(() =>
  import("./service-detail-section-health").then((module) => module.HealthSection),
);
export const DependenciesSection = dynamic(() =>
  import("./service-detail-section-dependencies").then(
    (module) => module.DependenciesSection,
  ),
);
export const QuotasSection = dynamic(() =>
  import("./service-detail-section-quotas").then((module) => module.QuotasSection),
);
export const PipelineSection = dynamic(() =>
  import("./service-detail-section-pipeline").then(
    (module) => module.PipelineSection,
  ),
);
export const GovernanceSection = dynamic(() =>
  import("./service-detail-section-governance").then(
    (module) => module.GovernanceSection,
  ),
);
export const EvidenceSection = dynamic(() =>
  import("./service-detail-section-evidence").then(
    (module) => module.EvidenceSection,
  ),
);
export const ActionsSection = dynamic(() =>
  import("./service-detail-section-actions").then(
    (module) => module.ActionsSection,
  ),
);
```

Move each section’s JSX and section-only imports from `service-detail-client.tsx` into its matching file. Keep summary section inline because it is the default first paint.

- [ ] **Step 4: Replace inline conditional blocks**

In `service-detail-client.tsx`, replace large blocks like:

```tsx
{activeSection === "health" ? (
  <div className="flex flex-col gap-4">
    ...
  </div>
) : null}
```

with:

```tsx
{activeSection === "health" ? (
  <HealthSection
    service={service}
    healthResult={healthResult}
    healthPending={healthMutation.isPending}
    onCheckHealth={() => healthMutation.mutate()}
  />
) : null}
```

Repeat for dependencies, quotas, pipeline, governance, evidence, and actions. Keep props explicit; do not pass the entire query client or router when a callback is enough.

- [ ] **Step 5: Run management tests and build**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/components/service-detail-client.test.tsx
npm run typecheck
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

```powershell
cd C:\Codes\apic\apicenter-management
git add src/components/service-detail-client.tsx src/components/service-detail/service-detail-sections.tsx src/components/service-detail/service-detail-section-*.tsx src/components/service-detail-client.test.tsx
git commit -m "perf: split service detail sections"
```

---

### Task 7: Add Tribe-Scoped Developer Portal Data

**Files:**
- Create: `apicenter-management/src/app/api/local/developer-portal/[tribeId]/route.ts`
- Modify: `apicenter-management/src/components/developer-portal-preview.tsx`
- Test: `apicenter-management/src/components/developer-portal-preview.test.tsx`

- [ ] **Step 1: Write component test for tribe-scoped fetch**

In `developer-portal-preview.test.tsx`, assert the preview no longer calls the full registry endpoint:

```tsx
it("loads developer portal data from the tribe-scoped endpoint", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        success: true,
        data: {
          tribeId: "commerce",
          services: [],
          quotaPolicies: [],
        },
      }),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);

  render(<DeveloperPortalPreview initialTribeId="commerce" />);

  await screen.findByText("commerce");

  expect(fetchMock).toHaveBeenCalledWith(
    "/api/local/developer-portal/commerce",
    expect.any(Object),
  );
  expect(fetchMock).not.toHaveBeenCalledWith(
    "/api/local/registry/services",
    expect.any(Object),
  );
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/components/developer-portal-preview.test.tsx
```

Expected: FAIL because the component currently calls `listServices()`.

- [ ] **Step 3: Add local route**

Create `route.ts`:

```ts
import { NextResponse } from "next/server";
import { listServices, listQuotaPolicies } from "@/lib/api-center-client";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tribeId: string }> },
) {
  const { tribeId } = await params;
  const decodedTribeId = decodeURIComponent(tribeId);
  const [services, quotaPolicies] = await Promise.all([
    listServices(),
    listQuotaPolicies(decodedTribeId),
  ]);

  const ownedServices = services.filter((service) => {
    if ((service.serviceType ?? "tribe") !== "tribe") return false;
    return (service.ownerTribeId ?? service.serviceId) === decodedTribeId;
  });
  const allowedIds = new Set(
    ownedServices.flatMap((service) => service.consumes ?? []),
  );
  const allowedServices = services.filter((service) =>
    allowedIds.has(service.serviceId),
  );

  return NextResponse.json({
    success: true,
    data: {
      tribeId: decodedTribeId,
      services: [...ownedServices, ...allowedServices],
      quotaPolicies,
    },
  });
}
```

This first server route still uses the existing backend registry list internally, but it removes the full registry payload from the browser and creates a stable seam for a backend tribe-scoped endpoint later.

- [ ] **Step 4: Update component fetch**

In `developer-portal-preview.tsx`, replace the `listServices()` and `listQuotaPolicies()` queries with one query:

```ts
const portalQuery = useQuery({
  queryKey: ["developer-portal-preview", "tribe", previewTribeId],
  queryFn: async () => {
    const response = await fetch(
      `/api/local/developer-portal/${encodeURIComponent(previewTribeId)}`,
      { cache: "no-store" },
    );
    if (!response.ok) {
      throw new Error("Developer portal data request failed.");
    }
    const payload = (await response.json()) as {
      success: boolean;
      data: {
        tribeId: string;
        services: ServiceRegistryEntry[];
        quotaPolicies: QuotaPolicy[];
      };
    };
    return payload.data;
  },
  enabled,
  retry: false,
});
```

Build preview data from `portalQuery.data?.services ?? []` and `portalQuery.data?.quotaPolicies ?? []`.

- [ ] **Step 5: Run management tests and build**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/components/developer-portal-preview.test.tsx
npm run typecheck
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit Task 7**

```powershell
cd C:\Codes\apic\apicenter-management
git add src/app/api/local/developer-portal/[tribeId]/route.ts src/components/developer-portal-preview.tsx src/components/developer-portal-preview.test.tsx
git commit -m "perf: scope developer portal registry data"
```

---

### Task 8: Full Verification And Publish

**Files:**
- No source edits expected unless verification exposes a defect.

- [ ] **Step 1: Run API Center checks**

Run:

```powershell
cd C:\Codes\apic\api-center
npm test -- src/operations/consumer-scorecard.controller.spec.ts src/registry/registry.service.spec.ts src/shared/proxy-handler.spec.ts
npm run build
```

Expected: PASS.

- [ ] **Step 2: Run SDK checks**

Run:

```powershell
cd C:\Codes\apic\api-shared-services
npm test -- src/TribeClient.test.ts
npm run typecheck
npm run build
```

Expected: PASS.

- [ ] **Step 3: Run Control Tower checks**

Run:

```powershell
cd C:\Codes\apic\control-tower
npm test -- src/app/api/ingestion/github/workflow-runs/sync/route.test.ts src/lib/alerts/dispatch.test.ts
npm run build
```

Expected: PASS.

- [ ] **Step 4: Run Management checks**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/components/service-detail-client.test.tsx src/components/developer-portal-preview.test.tsx
npm run typecheck
npm run build
```

Expected: PASS.

- [ ] **Step 5: Browser smoke**

Run the management app:

```powershell
cd C:\Codes\apic\apicenter-management
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Open:

```text
http://localhost:3000/tribes
http://localhost:3000/tribes/<known-service-id>?section=summary
http://localhost:3000/tribes/<known-service-id>?section=dependencies
http://localhost:3000/developer-portal?tribeId=<known-tribe-id>
```

Expected:

- Tribe list loads.
- Service summary loads without console errors.
- Dependencies section loads after navigation.
- Developer portal preview shows the same owned/allowed service data as before the route change.

- [ ] **Step 6: Push each repo branch**

Use one optimization branch per repo:

```powershell
cd C:\Codes\apic\api-center
git -c http.proxy= -c https.proxy= push -u origin codex/apicenter-code-optimization

cd C:\Codes\apic\api-shared-services
git -c http.proxy= -c https.proxy= push -u origin codex/apicenter-code-optimization

cd C:\Codes\apic\control-tower
git -c http.proxy= -c https.proxy= push -u origin codex/apicenter-code-optimization

cd C:\Codes\apic\apicenter-management
git -c http.proxy= -c https.proxy= push -u origin codex/apicenter-code-optimization
```

Expected: All branches pushed. If Git reports a stale `.git/index.lock`, verify no Git process is running and remove only the exact stale lock file.

---

## Caveats And Non-Goals

- Do not rewrite the entire registry store in this pass.
- Do not change the public API contract for tribe/shared discovery responses.
- Do not make GitHub sync unbounded; concurrency must stay capped to avoid rate-limit spikes.
- Do not move management UI copy or information architecture while splitting bundles.
- Do not push unrelated `apicenter-management` command-center redesign files as part of this plan.

## Self-Review

- Spec coverage: Covers all optimization findings from the cross-repo review: scorecard N+1 queries, registry scans, SDK repeated discovery calls, Control Tower sequential GitHub sync, alert recipient fan-out, service detail bundle size, and developer portal full-registry browser payload.
- Placeholder scan: No deferred implementation markers are present; every task has concrete file paths, code shapes, commands, and expected results.
- Type consistency: Uses existing names from the repos: `ConsumerScorecardMetric`, `ServiceRegistryEntry`, `TribeClient`, `ServiceDiscoveryEntry`, `dispatchAlerts`, `DeveloperPortalPreview`, and current query/test command conventions.
