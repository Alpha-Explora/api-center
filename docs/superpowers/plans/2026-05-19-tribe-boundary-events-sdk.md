# Tribe Boundary Events and SDK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make APICenter visibility, event topics, S3 export, and SDK publishing operate at the tribe boundary while keeping microservices registered and routable as separate services.

**Architecture:** Add an explicit `ownerTribeId` to service manifests and registry entries. Keep one tribe credential and one tribe event topic per tribe, while each microservice keeps its own `serviceId`, `baseUrl`, `exposes`, health, and optional dependency metadata. Preserve backward compatibility by treating `ownerTribeId ?? serviceId` as the effective tribe id until all existing services are migrated.

**Tech Stack:** NestJS API Center, Prisma/Postgres/Supabase migrations, Next.js management console, Confluent Cloud Kafka and S3 Sink, `@implementsprint/sdk` TypeScript package, Jest/Vitest.

---

## Current Evidence

- API Center auth currently receives `{ tribeId, secret }`, looks up `registry.get(tribeId)`, validates the secret by that id, and issues a JWT whose `tribeId` is the caller identity.
- API Center proxy/discovery currently checks `RegistryService.canConsume(sourceServiceId, targetServiceId)`, so the caller id is effectively both the tribe id and service id today.
- Kafka governance already uses the authenticated `tribeId` as the topic boundary and only allows topics under `tribe.<tribeId>.`.
- The management console topic helper currently derives tribe topics from `serviceId` via `tribe.<serviceId>.events`.
- The SDK already has `TribeClient.buildTenantTopic(tribeId, suffix)` and `kafkaPublish(payload)`, but examples use service-looking ids such as `orders-service`.

## Final Model

```text
Tribe principal:
  tribeId = logistics
  secret = api-center-tribe-secret-logistics
  event topic = prod.tribe.logistics.events
  access policy = consumes/scopes for the tribe

Microservices:
  serviceId = logistics-orders
  ownerTribeId = logistics
  baseUrl = https://logistics-orders.internal
  exposes = ["/orders", "/health"]

  serviceId = logistics-inventory
  ownerTribeId = logistics
  baseUrl = https://logistics-inventory.internal
  exposes = ["/inventory", "/health"]

Events:
  topic = prod.tribe.logistics.events
  governance.sourceTribeId = logistics
  governance.sourceServiceId = logistics-orders
```

## Compatibility Rules

- `effectiveOwnerTribeId = service.ownerTribeId ?? service.serviceId`.
- Existing service ids continue to authenticate, publish, and provision topics until their manifests are updated.
- The SDK keeps `tribeId` and `secret` as required constructor options.
- New SDK helpers add `sourceServiceId`; raw `kafkaPublish()` remains supported.
- Existing `tribe.<serviceId>.events` topics are not deleted automatically. Operators migrate them to `tribe.<tribeId>.events`, include the new topic in S3 Sink, then remove old topics only after no producers are using them.

## Phase 0: Baseline And Decision Lock

**Files:**
- Read: `api-center/src/auth/auth.controller.ts`
- Read: `api-center/src/registry/registry.service.ts`
- Read: `api-center/src/shared/proxy-handler.ts`
- Read: `api-center/src/kafka-governance/kafka-governance.service.ts`
- Read: `apicenter-management/src/lib/event-topics.ts`
- Read: `api-shared-services/src/TribeClient.ts`

- [ ] **Step 1: Capture the current baseline**

Run:

```powershell
cd C:\Codes\apic\api-center
npm test -- --runInBand src/auth/auth.controller.spec.ts src/registry/registry.service.spec.ts src/shared/proxy-handler.spec.ts src/kafka-governance/kafka-governance.service.spec.ts
npm run typecheck

cd C:\Codes\apic\apicenter-management
npm test -- src/lib/event-topics.test.ts src/components/confluent-provisioning-card.test.tsx src/components/tribe-onboarding-flow.test.tsx
npx tsc --noEmit

cd C:\Codes\apic\api-shared-services
npm test -- tests/TribeClient.test.ts
npm run build
```

Expected:

```text
The existing tests either pass or expose pre-existing failures that are recorded before implementation starts.
```

- [ ] **Step 2: Confirm rollout decision**

Use these decisions throughout the implementation:

```text
1. One tribe credential per tribe.
2. One tribe event topic per tribe.
3. Many microservice registry entries may share one ownerTribeId.
4. Access control is evaluated against the tribe principal plus owned-service visibility.
5. Service-level identity is retained as sourceServiceId for routing, health, observability, and event attribution.
```

- [ ] **Step 3: Commit baseline plan**

Run:

```powershell
git add api-center/docs/superpowers/plans/2026-05-19-tribe-boundary-events-sdk.md
git commit -m "docs: plan tribe boundary event model"
```

## Phase 1: Registry Contract And Persistence

**Files:**
- Modify: `api-center/src/types/index.ts`
- Modify: `api-center/src/shared/dto/service-manifest.dto.ts`
- Modify: `api-center/src/shared/dto/service-manifest.dto.spec.ts`
- Modify: `api-center/prisma/schema.prisma`
- Create: `api-center/prisma/migrations/20260519000000_add_owner_tribe_id/migration.sql`
- Create: `api-center/supabase/migrations/20260519000000_add_owner_tribe_id.sql`
- Modify: `api-center/src/registry/postgres-registry-store.service.ts`
- Modify: `api-center/src/registry/postgres-registry-store.service.spec.ts`
- Modify: `apicenter-management/src/lib/schemas.ts`
- Modify: `apicenter-management/src/components/tribe-form.tsx`
- Modify: `api-shared-services/src/types.ts`

- [ ] **Step 1: Write API Center DTO tests**

Add expectations to `api-center/src/shared/dto/service-manifest.dto.spec.ts`:

```ts
it("accepts ownerTribeId for microservices owned by a tribe", async () => {
  const dto = plainToInstance(ServiceManifestDto, {
    serviceId: "logistics-orders",
    ownerTribeId: "logistics",
    name: "Logistics Orders",
    baseUrl: "http://logistics-orders:3000",
    requiredScopes: ["orders:read"],
    exposes: ["/orders", "/health"],
    consumes: ["payment"],
    serviceType: "tribe",
  });

  const errors = await validate(dto);

  expect(errors).toEqual([]);
});

it("rejects invalid ownerTribeId values", async () => {
  const dto = plainToInstance(ServiceManifestDto, {
    serviceId: "logistics-orders",
    ownerTribeId: "Logistics Orders!",
    name: "Logistics Orders",
    baseUrl: "http://logistics-orders:3000",
    requiredScopes: ["orders:read"],
    exposes: ["/orders"],
    consumes: [],
    serviceType: "tribe",
  });

  const errors = await validate(dto);

  expect(errors.some((error) => error.property === "ownerTribeId")).toBe(true);
});
```

Run:

```powershell
cd C:\Codes\apic\api-center
npm test -- --runInBand src/shared/dto/service-manifest.dto.spec.ts
```

Expected:

```text
FAIL because ServiceManifestDto does not define ownerTribeId yet.
```

- [ ] **Step 2: Add `ownerTribeId` to API Center types and DTO**

In `api-center/src/types/index.ts`, add:

```ts
  /** Tribe that owns this service. Defaults to serviceId for legacy tribe entries. */
  ownerTribeId?: string;
```

In `api-center/src/shared/dto/service-manifest.dto.ts`, add:

```ts
  @ApiPropertyOptional({
    example: "logistics",
    description:
      "Tribe that owns this service. Defaults to serviceId for legacy tribe entries.",
  })
  @IsString()
  @Matches(/^[a-z0-9-]+$/, {
    message: "ownerTribeId must be lowercase alphanumeric with hyphens only",
  })
  @IsOptional()
  ownerTribeId?: string;
```

Run:

```powershell
cd C:\Codes\apic\api-center
npm test -- --runInBand src/shared/dto/service-manifest.dto.spec.ts
```

Expected:

```text
PASS
```

- [ ] **Step 3: Add database column and indexes**

In `api-center/prisma/schema.prisma`, add to `model Service`:

```prisma
  ownerTribeId         String?   @map("owner_tribe_id")
```

Add indexes:

```prisma
  @@index([ownerTribeId], name: "services_owner_tribe_idx")
  @@index([organizationId, ownerTribeId, serviceType, status], name: "services_org_owner_type_status_idx")
```

Create `api-center/prisma/migrations/20260519000000_add_owner_tribe_id/migration.sql`:

```sql
ALTER TABLE api_center.services
  ADD COLUMN owner_tribe_id text;

UPDATE api_center.services
SET owner_tribe_id = service_id
WHERE service_type = 'tribe'
  AND owner_tribe_id IS NULL;

CREATE INDEX services_owner_tribe_idx
  ON api_center.services(owner_tribe_id);

CREATE INDEX services_org_owner_type_status_idx
  ON api_center.services(organization_id, owner_tribe_id, service_type, status);
```

Create `api-center/supabase/migrations/20260519000000_add_owner_tribe_id.sql` with the same SQL.

Run:

```powershell
cd C:\Codes\apic\api-center
npx prisma validate
```

Expected:

```text
Prisma schema validates successfully.
```

- [ ] **Step 4: Persist and load `ownerTribeId` from Postgres**

In `api-center/src/registry/postgres-registry-store.service.ts`:

```ts
function effectiveOwnerTribeId(entry: ServiceRegistryEntry): string | undefined {
  if (entry.serviceType === "shared") return entry.ownerTribeId;
  return entry.ownerTribeId ?? entry.serviceId;
}
```

Add to `mapRegistryEntryToServiceCreate()` and `mapRegistryEntryToServiceUpdate()`:

```ts
    ownerTribeId: effectiveOwnerTribeId(entry),
```

Add to `mapRowToRegistryEntry()`:

```ts
    ownerTribeId: row.ownerTribeId ?? undefined,
```

Run:

```powershell
cd C:\Codes\apic\api-center
npm test -- --runInBand src/registry/postgres-registry-store.service.spec.ts
```

Expected:

```text
PASS after tests are updated to expect ownerTribeId round-tripping.
```

- [ ] **Step 5: Add management and SDK contract fields**

In `apicenter-management/src/lib/schemas.ts`, add to `serviceManifestSchema`:

```ts
  ownerTribeId: z
    .string()
    .regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers, and hyphens only")
    .optional(),
```

In `api-shared-services/src/types.ts`, add to `ServiceManifest`:

```ts
  ownerTribeId?: string;
```

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/lib/schemas.test.ts src/components/tribe-form.test.tsx
npx tsc --noEmit

cd C:\Codes\apic\api-shared-services
npm test -- tests/TribeClient.test.ts
npm run build
```

Expected:

```text
All contract/type tests pass.
```

- [ ] **Step 6: Commit Phase 1**

Run:

```powershell
git add api-center apicenter-management api-shared-services
git commit -m "feat: add owner tribe to service registry contracts"
```

## Phase 2: Tribe-Aware Access And Discovery

**Files:**
- Modify: `api-center/src/registry/registry.service.ts`
- Modify: `api-center/src/registry/registry.service.spec.ts`
- Modify: `api-center/src/auth/auth.controller.ts`
- Modify: `api-center/src/auth/auth.controller.spec.ts`
- Modify: `api-center/src/shared/proxy-handler.ts`
- Modify: `api-center/src/shared/proxy-handler.spec.ts`
- Modify: `api-center/src/tribes/tribes.controller.spec.ts`

- [ ] **Step 1: Add registry tests for effective tribe ownership**

Add tests to `api-center/src/registry/registry.service.spec.ts`:

```ts
it("treats ownerTribeId as the tribe boundary for owned services", async () => {
  await service.register({
    serviceId: "logistics",
    ownerTribeId: "logistics",
    name: "Logistics Tribe",
    baseUrl: "http://logistics-control:3000",
    requiredScopes: ["logistics:read"],
    exposes: ["/health"],
    consumes: ["payment"],
    serviceType: "tribe",
  });
  await service.register({
    serviceId: "logistics-orders",
    ownerTribeId: "logistics",
    name: "Logistics Orders",
    baseUrl: "http://logistics-orders:3000",
    requiredScopes: ["orders:read"],
    exposes: ["/orders"],
    consumes: [],
    serviceType: "tribe",
  });

  expect(service.getEffectiveOwnerTribeId("logistics-orders")).toBe("logistics");
  expect(service.canAccess("logistics", "logistics-orders")).toBe(true);
  expect(service.canConsume("logistics", "payment")).toBe(true);
});
```

Run:

```powershell
cd C:\Codes\apic\api-center
npm test -- --runInBand src/registry/registry.service.spec.ts
```

Expected:

```text
FAIL because getEffectiveOwnerTribeId and canAccess do not exist yet.
```

- [ ] **Step 2: Implement effective tribe helpers**

In `api-center/src/registry/registry.service.ts`, add:

```ts
  getEffectiveOwnerTribeId(serviceId: string): string | undefined {
    const service = this.services[serviceId];
    if (!service) return undefined;
    if ((service.serviceType ?? "tribe") === "shared") return service.ownerTribeId;
    return service.ownerTribeId ?? service.serviceId;
  }

  getOwnedServices(tribeId: string): ServiceRegistryEntry[] {
    return Object.values(this.services).filter((service) => {
      if ((service.serviceType ?? "tribe") !== "tribe") return false;
      return (service.ownerTribeId ?? service.serviceId) === tribeId;
    });
  }

  getEffectiveConsumesForTribe(tribeId: string): string[] {
    const direct = this.services[tribeId]?.consumes ?? [];
    const owned = this.getOwnedServices(tribeId).flatMap(
      (service) => service.consumes ?? [],
    );
    return [...new Set([...direct, ...owned])];
  }

  canAccess(sourceTribeId: string, targetServiceId: string): boolean {
    const target = this.services[targetServiceId];
    if (!target) return false;
    if ((target.serviceType ?? "tribe") === "tribe") {
      const targetOwner = target.ownerTribeId ?? target.serviceId;
      if (targetOwner === sourceTribeId) return true;
    }
    return this.canConsume(sourceTribeId, targetServiceId);
  }
```

Update `canConsume()`:

```ts
  canConsume(sourceServiceId: string, targetServiceId: string): boolean {
    const source = this.services[sourceServiceId];
    if (source?.consumes.includes(targetServiceId)) return true;
    return this.getEffectiveConsumesForTribe(sourceServiceId).includes(targetServiceId);
  }
```

Run:

```powershell
cd C:\Codes\apic\api-center
npm test -- --runInBand src/registry/registry.service.spec.ts
```

Expected:

```text
PASS
```

- [ ] **Step 3: Update proxy discovery and proxy authorization**

In `api-center/src/shared/proxy-handler.ts`, change discovery access:

```ts
        canAccess: tribeId
          ? this.deps.registry.canAccess(tribeId, svc.serviceId)
          : false,
```

Change proxy authorization:

```ts
    if (!this.deps.registry.canAccess(tribeId, targetServiceId)) {
      throw new ForbiddenError(
        `Tribe '${tribeId}' is not authorised to access '${targetServiceId}'`,
      );
    }
```

Run:

```powershell
cd C:\Codes\apic\api-center
npm test -- --runInBand src/shared/proxy-handler.spec.ts src/tribes/tribes.controller.spec.ts
```

Expected:

```text
PASS with tests updated to cover owned microservices and consumed external services.
```

- [ ] **Step 4: Issue token scopes from owned and consumed services**

In `api-center/src/auth/auth.controller.ts`, replace the direct loop over `service.consumes` with:

```ts
    const ownedServiceScopes = this.registry
      .getOwnedServices(tribeId)
      .flatMap((ownedService) => ownedService.requiredScopes ?? []);
    const effectiveConsumes = this.registry.getEffectiveConsumesForTribe(tribeId);
```

Then loop over `effectiveConsumes` for target scopes. Build scopes from:

```ts
    const scopes = [
      ...new Set([
        ...ownScopes,
        ...ownedServiceScopes,
        ...consumableScopes,
        ...externalApiScopes,
      ]),
    ];
```

Run:

```powershell
cd C:\Codes\apic\api-center
npm test -- --runInBand src/auth/auth.controller.spec.ts
```

Expected:

```text
PASS with a test proving tribe token for logistics includes logistics-orders required scopes and consumed payment scopes.
```

- [ ] **Step 5: Commit Phase 2**

Run:

```powershell
git add api-center
git commit -m "feat: enforce tribe-owned service access"
```

## Phase 3: Tribe-Owned Kafka Event Contract

**Files:**
- Modify: `api-center/src/kafka-governance/dto/kafka-publish-message.dto.ts`
- Modify: `api-center/src/kafka-governance/kafka-governance.service.ts`
- Modify: `api-center/src/kafka-governance/kafka-governance.service.spec.ts`
- Modify: `api-center/src/kafka-governance/kafka-governance.controller.spec.ts`
- Modify: `api-center/src/kafka/schemas/tribe.schemas.ts`

- [ ] **Step 1: Add failing tests for `sourceServiceId`**

In `api-center/src/kafka-governance/kafka-governance.service.spec.ts`, add:

```ts
it("publishes tribe events with source service attribution", async () => {
  await service.publishMessage(
    "logistics",
    {
      topic: "tribe.logistics.events",
      key: "ord_123",
      eventType: "order.created",
      payload: { orderId: "ord_123" },
      sourceServiceId: "logistics-orders",
      metadata: { schema: "orders.v1" },
    },
    "corr-1",
  );

  expect(mockKafka.publish).toHaveBeenCalledWith(
    "tribe.logistics.events",
    expect.objectContaining({
      eventType: "order.created",
      payload: { orderId: "ord_123" },
      metadata: { schema: "orders.v1" },
      governance: expect.objectContaining({
        sourceTribeId: "logistics",
        sourceServiceId: "logistics-orders",
        correlationId: "corr-1",
      }),
    }),
    "ord_123",
  );
});
```

Run:

```powershell
cd C:\Codes\apic\api-center
npm test -- --runInBand src/kafka-governance/kafka-governance.service.spec.ts
```

Expected:

```text
FAIL because KafkaPublishMessageDto and service logic do not accept sourceServiceId yet.
```

- [ ] **Step 2: Add `sourceServiceId` to publish DTO**

In `api-center/src/kafka-governance/dto/kafka-publish-message.dto.ts`, add:

```ts
  @ApiPropertyOptional({
    example: "logistics-orders",
    description: "Microservice that produced the event inside the authenticated tribe boundary",
    maxLength: 64,
  })
  @IsOptional()
  @IsString()
  @MaxLength(64, { message: "sourceServiceId is too long" })
  @Matches(/^[a-z0-9-]+$/, {
    message: "sourceServiceId must be lowercase alphanumeric with hyphens only",
  })
  sourceServiceId?: string;
```

Update `GovernedKafkaPayloadSchema` in `api-center/src/kafka-governance/kafka-governance.service.ts`:

```ts
const GovernedKafkaPayloadSchema = z.object({
  eventType: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  sourceServiceId: z.string().regex(/^[a-z0-9-]+$/).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});
```

Include it in parse input:

```ts
      sourceServiceId: dto.sourceServiceId,
```

Write it into governance:

```ts
          sourceServiceId: parseResult.data.sourceServiceId,
```

Run:

```powershell
cd C:\Codes\apic\api-center
npm test -- --runInBand src/kafka-governance/kafka-governance.service.spec.ts src/kafka-governance/kafka-governance.controller.spec.ts
```

Expected:

```text
PASS
```

- [ ] **Step 3: Keep topic boundary tribe-only**

Keep `assertTopicIsTenantScoped()` based on authenticated `tribeId`. Add a regression test:

```ts
it("rejects source service attempts to publish outside the tribe topic", async () => {
  await expect(
    service.publishMessage("logistics", {
      topic: "tribe.logistics-orders.events",
      eventType: "order.created",
      payload: { orderId: "ord_123" },
      sourceServiceId: "logistics-orders",
    }),
  ).rejects.toBeInstanceOf(ForbiddenError);
});
```

Run:

```powershell
cd C:\Codes\apic\api-center
npm test -- --runInBand src/kafka-governance/kafka-governance.service.spec.ts
```

Expected:

```text
PASS
```

- [ ] **Step 4: Commit Phase 3**

Run:

```powershell
git add api-center
git commit -m "feat: attribute tribe events to source services"
```

## Phase 4: Management Console Tribe Topic Provisioning

**Files:**
- Modify: `apicenter-management/src/lib/event-topics.ts`
- Modify: `apicenter-management/src/lib/event-topics.test.ts`
- Modify: `apicenter-management/src/lib/schemas.ts`
- Modify: `apicenter-management/src/lib/server/confluent-cloud.ts`
- Modify: `apicenter-management/src/app/api/local/confluent/topics/provision/route.ts`
- Modify: `apicenter-management/src/app/api/local/confluent/status/[serviceId]/route.ts`
- Modify: `apicenter-management/src/components/confluent-provisioning-card.tsx`
- Modify: `apicenter-management/src/components/confluent-provisioning-card.test.tsx`
- Modify: `apicenter-management/src/components/tribe-onboarding-flow.tsx`
- Modify: `apicenter-management/src/components/service-detail-client.tsx`
- Modify: `apicenter-management/src/components/service-table.tsx`
- Modify: `apicenter-management/src/components/tribe-list-client.tsx`

- [ ] **Step 1: Write topic helper tests**

Replace/add tests in `apicenter-management/src/lib/event-topics.test.ts`:

```ts
it("uses ownerTribeId for tribe-owned service event topics", () => {
  const topics = getServiceEventTopics({
    serviceId: "logistics-orders",
    ownerTribeId: "logistics",
    serviceType: "tribe",
  });

  expect(topics.primary).toBe("tribe.logistics.events");
  expect(topics.tribeEvents).toBe("tribe.logistics.events");
});

it("falls back to serviceId for legacy tribe entries", () => {
  const topics = getServiceEventTopics({
    serviceId: "flow-ci",
    serviceType: "tribe",
  });

  expect(topics.primary).toBe("tribe.flow-ci.events");
});

it("keeps shared-service export topics per shared service", () => {
  process.env.NEXT_PUBLIC_KAFKA_TOPIC_PREFIX = "test";

  const topics = getServiceEventTopics({
    serviceId: "payment",
    serviceType: "shared",
  });

  expect(topics.primary).toBe("test.api-center.shared.payment.events");
  expect(topics.tribeEvents).toBe("test.tribe.payment.events");
});
```

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/lib/event-topics.test.ts
```

Expected:

```text
FAIL because getServiceEventTopics still accepts positional serviceId/serviceType.
```

- [ ] **Step 2: Update topic helper API**

In `apicenter-management/src/lib/event-topics.ts`, replace the function signature with:

```ts
export type ServiceTopicType = "tribe" | "shared";

export type ServiceTopicInput = {
  serviceId: string;
  ownerTribeId?: string;
  serviceType?: ServiceTopicType;
};

export function getServiceEventTopics(input: ServiceTopicInput) {
  const serviceType = input.serviceType ?? "tribe";
  const tribeTopicOwnerId = input.ownerTribeId ?? input.serviceId;
  const tribeEvents = getTribeEventTopic(tribeTopicOwnerId);
  const sharedExport = getSharedServiceExportTopic(input.serviceId);

  return {
    primary: serviceType === "shared" ? sharedExport : tribeEvents,
    primaryLabel:
      serviceType === "shared"
        ? "Shared-service export"
        : "Tribe events",
    tribeEvents,
    sharedExport,
    topicOwnerId: serviceType === "shared" ? input.serviceId : tribeTopicOwnerId,
    request: withTopicPrefix("api-center.tribe.request"),
    response: withTopicPrefix("api-center.tribe.response"),
    audit: withTopicPrefix("api-center.audit.log"),
  };
}

export function getTribeEventTopic(tribeId: string) {
  return withTopicPrefix(`tribe.${tribeId}.events`);
}
```

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/lib/event-topics.test.ts
```

Expected:

```text
PASS
```

- [ ] **Step 3: Update Confluent request schemas**

In `apicenter-management/src/lib/schemas.ts`, add to `confluentTopicProvisionRequestSchema`:

```ts
  ownerTribeId: z
    .string()
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/)
    .optional(),
```

Add to `confluentTopicProvisionResponseSchema.data`:

```ts
    ownerTribeId: z.string().optional(),
```

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/lib/schemas.test.ts
```

Expected:

```text
PASS after schema tests include ownerTribeId.
```

- [ ] **Step 4: Provision and inspect topics by owner tribe**

In `apicenter-management/src/lib/server/confluent-cloud.ts`, derive the topic with owner tribe fallback:

```ts
function resolveTribeTopicOwner(input: {
  serviceId: string;
  ownerTribeId?: string;
}) {
  return input.ownerTribeId ?? input.serviceId;
}
```

Use it in `provisionTopic()`:

```ts
  const ownerTribeId = resolveTribeTopicOwner(input);
  const topicName = input.topicName ?? `tribe.${ownerTribeId}.events`;
```

Return it:

```ts
      ownerTribeId,
```

Update `getPipelineStatus()` to accept an explicit `topicName` from the UI and keep the old fallback:

```ts
  const resolvedTopicName =
    topicName ?? `tribe.${serviceId}.events`;
```

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/components/confluent-provisioning-card.test.tsx
npx tsc --noEmit
```

Expected:

```text
PASS after component callers pass topicName explicitly.
```

- [ ] **Step 5: Pass owner tribe through UI components**

Update `ConfluentProvisioningCard` props:

```ts
export function ConfluentProvisioningCard({
  serviceId,
  ownerTribeId,
  serviceType = "tribe",
}: {
  serviceId: string;
  ownerTribeId?: string;
  serviceType?: ServiceTopicType;
}) {
```

Update topic derivation:

```ts
  const topics = useMemo(
    () => getServiceEventTopics({ serviceId, ownerTribeId, serviceType }),
    [serviceId, ownerTribeId, serviceType],
  );
```

Update provisioning mutation:

```ts
      provisionConfluentTopic({
        serviceId,
        ownerTribeId,
        topicName,
        partitions: 1,
        confirmation: {
          typedPhrase,
          reason: operatorReason,
        },
      }),
```

Update all callers so service detail pages pass `service.ownerTribeId`.

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/components/confluent-provisioning-card.test.tsx src/components/service-detail-client.test.tsx src/components/tribe-onboarding-flow.test.tsx
npx tsc --noEmit
```

Expected:

```text
PASS and UI tests assert microservice logistics-orders shows tribe.logistics.events.
```

- [ ] **Step 6: Update deprovisioning behavior**

In `apicenter-management/src/components/tribe-deprovisioning-card.tsx`, show a warning when a microservice has `ownerTribeId !== serviceId`:

```text
This service is owned by tribe <ownerTribeId>. Deleting this service should not remove the tribe topic or tribe secret unless you are deprovisioning the tribe principal.
```

Only enable topic/secret cleanup when:

```ts
const isTribePrincipal = !ownerTribeId || ownerTribeId === serviceId;
```

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/components/tribe-deprovisioning-card.test.tsx
```

Expected:

```text
PASS with tests proving microservice deprovisioning does not remove tribe-level resources.
```

- [ ] **Step 7: Commit Phase 4**

Run:

```powershell
git add apicenter-management
git commit -m "feat: provision event topics by owner tribe"
```

## Phase 5: SDK Changes And Release

**Files:**
- Modify: `api-shared-services/src/types.ts`
- Modify: `api-shared-services/src/TribeClient.ts`
- Modify: `api-shared-services/tests/TribeClient.test.ts`
- Modify: `api-shared-services/contracts/shared-service-contract.json`
- Modify: `api-shared-services/docs/tribe-sdk-consumption.md`
- Modify: `api-shared-services/docs/consumer-runbook.md`
- Modify: `api-shared-services/package.json`
- Modify: `api-shared-services/package-lock.json`

- [ ] **Step 1: Add SDK tests for tribe topic helper and source service publishing**

In `api-shared-services/tests/TribeClient.test.ts`, add:

```ts
it("builds tribe event topics from tribe id, not service id", () => {
  expect(TribeClient.buildTribeEventTopic("Logistics")).toBe(
    "tribe.logistics.events",
  );
});

it("publishes tribe events with source service attribution", async () => {
  const { client, request } = createAuthenticatedClient({
    tribeId: "logistics",
    sourceServiceId: "logistics-orders",
  });

  await client.publishTribeEvent({
    eventType: "order.created",
    key: "ord_123",
    payload: { orderId: "ord_123" },
  });

  expect(request).toHaveBeenCalledWith(
    expect.objectContaining({
      url: "/api/v1/kafka/publish",
      method: "POST",
      data: {
        topic: "tribe.logistics.events",
        key: "ord_123",
        eventType: "order.created",
        payload: { orderId: "ord_123" },
        sourceServiceId: "logistics-orders",
      },
    }),
  );
});
```

If `createAuthenticatedClient()` currently takes no options, change it to:

```ts
function createAuthenticatedClient(
  options: Partial<TribeClientOptions> = {},
) {
  const client = new TribeClient({
    gatewayUrl: "http://gateway.local",
    tribeId: options.tribeId ?? "orders-service",
    secret: options.secret ?? "secret",
    sourceServiceId: options.sourceServiceId,
    maxRetries: 0,
  });
```

Run:

```powershell
cd C:\Codes\apic\api-shared-services
npm test -- tests/TribeClient.test.ts
```

Expected:

```text
FAIL because buildTribeEventTopic, sourceServiceId option, and publishTribeEvent do not exist yet.
```

- [ ] **Step 2: Add SDK event types**

In `api-shared-services/src/types.ts`, update `KafkaGovernedPublishRequest`:

```ts
export interface KafkaGovernedPublishRequest {
  topic: string;
  key?: string;
  eventType: string;
  payload: Record<string, unknown>;
  sourceServiceId?: string;
  metadata?: Record<string, string>;
}
```

Add:

```ts
export interface TribeEventPublishRequest {
  key?: string;
  eventType: string;
  payload: Record<string, unknown>;
  sourceServiceId?: string;
  metadata?: Record<string, string>;
}
```

- [ ] **Step 3: Add SDK constructor option and helper methods**

In `api-shared-services/src/TribeClient.ts`, import `TribeEventPublishRequest`.

Update `TribeClientOptions`:

```ts
  sourceServiceId?: string;
```

Add private field:

```ts
  private readonly sourceServiceId?: string;
```

Set it in the constructor:

```ts
    this.sourceServiceId = options.sourceServiceId;
```

Add helper:

```ts
  static buildTribeEventTopic(tribeId: string): string {
    return TribeClient.buildTenantTopic(tribeId, "events");
  }
```

Add publish wrapper:

```ts
  async publishTribeEvent(
    payload: TribeEventPublishRequest,
    options?: AxiosRequestConfig,
  ): Promise<KafkaGovernedPublishResponse> {
    return this.kafkaPublish(
      {
        topic: TribeClient.buildTribeEventTopic(this.tribeId),
        key: payload.key,
        eventType: payload.eventType,
        payload: payload.payload,
        sourceServiceId: payload.sourceServiceId ?? this.sourceServiceId,
        metadata: payload.metadata,
      },
      options,
    );
  }
```

Run:

```powershell
cd C:\Codes\apic\api-shared-services
npm test -- tests/TribeClient.test.ts
npm run build
```

Expected:

```text
PASS
```

- [ ] **Step 4: Update SDK docs**

In `api-shared-services/docs/tribe-sdk-consumption.md` and `api-shared-services/docs/consumer-runbook.md`, replace examples that build `tribe.<serviceId>.events` with:

```ts
const client = new TribeClient({
  gatewayUrl: process.env.APICENTER_URL!,
  tribeId: process.env.APICENTER_TRIBE_ID!,
  secret: process.env.APICENTER_TRIBE_SECRET!,
  sourceServiceId: "logistics-orders",
});

await client.publishTribeEvent({
  key: "ord_123",
  eventType: "order.created",
  payload: { orderId: "ord_123" },
});
```

Document:

```text
APICENTER_TRIBE_ID is the tribe principal, not the microservice id.
sourceServiceId identifies which backend inside the tribe produced the event.
```

- [ ] **Step 5: Bump SDK version**

Bump `api-shared-services/package.json` to the next minor version, for example:

```json
{
  "version": "1.2.0"
}
```

Run:

```powershell
cd C:\Codes\apic\api-shared-services
npm install --package-lock-only
npm test -- tests/TribeClient.test.ts
npm run build
```

Expected:

```text
package-lock.json is updated and tests/build pass.
```

- [ ] **Step 6: Commit Phase 5**

Run:

```powershell
git add api-shared-services
git commit -m "feat: add tribe event SDK helpers"
```

## Phase 6: Topic Migration, S3 Sink, Analytics, And Docs

**Files:**
- Modify: `api-center/docs/apicenter-platform-setup.md`
- Modify: `api-center/docs/confluent-cloud-s3-sink-setup.md`
- Modify: `api-center/docs/contracts/shared-service-export-events.md`
- Modify: `api-center/docs/superpowers/plans/2026-05-19-tribe-data-pipeline-ownership.md`
- Modify: `apicenter-management/docs/operations/apicenter-management-runbook.md`
- Create: `apicenter-management/src/lib/topic-migration.ts`
- Create: `apicenter-management/src/lib/topic-migration.test.ts`
- Create: `apicenter-management/src/app/api/local/confluent/topic-migrations/route.ts`
- Modify: `apicenter-management/src/lib/schemas.ts`
- Modify: `apicenter-management/src/lib/api-center-client.ts`
- Modify: `apicenter-management/src/components/confluent-provisioning-card.tsx`
- Modify: `api-shared-services/docs/sdk-shared-services-apicenter-guide.md`
- Modify: `api-shared-services/docs/consumer-runbook.md`

- [x] **Step 1: Add a legacy topic migration planner**

Create `apicenter-management/src/lib/topic-migration.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { planTopicMigration } from "./topic-migration";

describe("planTopicMigration", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_KAFKA_TOPIC_PREFIX;
  });

  it("plans service topic migration into the owner tribe topic", () => {
    expect(
      planTopicMigration({
        serviceId: "logistics-orders",
        ownerTribeId: "logistics",
        serviceType: "tribe",
      }),
    ).toEqual({
      serviceId: "logistics-orders",
      ownerTribeId: "logistics",
      legacyTopic: "tribe.logistics-orders.events",
      targetTopic: "tribe.logistics.events",
      migrationNeeded: true,
      reason:
        "Service topic tribe.logistics-orders.events should move to tribe topic tribe.logistics.events.",
    });
  });

  it("does not migrate legacy entries that are already tribe principals", () => {
    expect(
      planTopicMigration({
        serviceId: "logistics",
        ownerTribeId: "logistics",
        serviceType: "tribe",
      }).migrationNeeded,
    ).toBe(false);
  });

  it("uses environment prefixes consistently", () => {
    process.env.NEXT_PUBLIC_KAFKA_TOPIC_PREFIX = "prod";

    const plan = planTopicMigration({
      serviceId: "logistics-orders",
      ownerTribeId: "logistics",
      serviceType: "tribe",
    });

    expect(plan.legacyTopic).toBe("prod.tribe.logistics-orders.events");
    expect(plan.targetTopic).toBe("prod.tribe.logistics.events");
  });
});
```

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/lib/topic-migration.test.ts
```

Expected:

```text
FAIL because topic-migration.ts does not exist yet.
```

- [x] **Step 2: Implement the migration planner**

Create `apicenter-management/src/lib/topic-migration.ts`:

```ts
import {
  getTribeEventTopic,
  type ServiceTopicType,
} from "@/lib/event-topics";

export type TopicMigrationInput = {
  serviceId: string;
  ownerTribeId?: string;
  serviceType?: ServiceTopicType;
};

export type TopicMigrationPlan = {
  serviceId: string;
  ownerTribeId: string;
  legacyTopic: string;
  targetTopic: string;
  migrationNeeded: boolean;
  reason: string;
};

export function planTopicMigration(
  input: TopicMigrationInput,
): TopicMigrationPlan {
  const serviceType = input.serviceType ?? "tribe";
  const ownerTribeId = input.ownerTribeId ?? input.serviceId;
  const legacyTopic = getTribeEventTopic(input.serviceId);
  const targetTopic = getTribeEventTopic(ownerTribeId);
  const migrationNeeded =
    serviceType === "tribe" && legacyTopic !== targetTopic;

  return {
    serviceId: input.serviceId,
    ownerTribeId,
    legacyTopic,
    targetTopic,
    migrationNeeded,
    reason: migrationNeeded
      ? `Service topic ${legacyTopic} should move to tribe topic ${targetTopic}.`
      : `Service ${input.serviceId} already uses tribe topic ${targetTopic}.`,
  };
}
```

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/lib/topic-migration.test.ts
```

Expected:

```text
PASS
```

- [x] **Step 3: Add an operator route that upgrades old topics to new topics**

Add to `apicenter-management/src/lib/schemas.ts`:

```ts
export const topicMigrationRequestSchema = z.object({
  serviceId: z
    .string()
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/),
  ownerTribeId: z
    .string()
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/)
    .optional(),
  serviceType: serviceTypeSchema.default("tribe"),
  confirmation: z
    .object({
      typedPhrase: z.string().optional(),
      reason: z.string().optional(),
    })
    .optional(),
});

export const topicMigrationResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    serviceId: z.string(),
    ownerTribeId: z.string(),
    legacyTopic: z.string(),
    targetTopic: z.string(),
    migrationNeeded: z.boolean(),
    topicProvisioned: z.boolean(),
    sinkIncluded: z.boolean(),
    oldTopicPreserved: z.literal(true),
  }),
});

export type TopicMigrationRequest = z.infer<typeof topicMigrationRequestSchema>;
export type TopicMigrationResponse = z.infer<typeof topicMigrationResponseSchema>;
```

Create `apicenter-management/src/app/api/local/confluent/topic-migrations/route.ts`:

```ts
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  topicMigrationRequestSchema,
} from "@/lib/schemas";
import { planTopicMigration } from "@/lib/topic-migration";
import {
  ConfluentCloudError,
  includeConfluentTopicInS3Sink,
  provisionConfluentTopic,
} from "@/lib/server/confluent-cloud";
import { getManagementAuthConfig } from "@/lib/server/management-auth";
import { requireManagementAction } from "@/lib/server/require-management-action";
import { requireManagementSession } from "@/lib/server/require-management-session";

export async function POST(request: Request) {
  if (process.env.NEXT_PUBLIC_LOCAL_MANAGEMENT_MODE === "false") {
    return NextResponse.json(
      { success: false, error: "Local management routes are disabled." },
      { status: 403 },
    );
  }

  try {
    const input = topicMigrationRequestSchema.parse(await request.json());
    const environment = getManagementAuthConfig().environment;
    const session = await requireManagementSession({
      authorizationHeader: request.headers.get("authorization"),
    });

    await requireManagementAction({
      session,
      environment,
      actionRisk: "provider-write",
      actionId: "confluent.topic.migrate",
      typedPhrase: input.confirmation?.typedPhrase,
      reason: input.confirmation?.reason,
    });

    const plan = planTopicMigration(input);
    const topic = await provisionConfluentTopic({
      serviceId: input.serviceId,
      ownerTribeId: plan.ownerTribeId,
      topicName: plan.targetTopic,
      partitions: 1,
    });
    const sink = await includeConfluentTopicInS3Sink(plan.targetTopic);

    return NextResponse.json({
      success: true,
      data: {
        serviceId: plan.serviceId,
        ownerTribeId: plan.ownerTribeId,
        legacyTopic: plan.legacyTopic,
        targetTopic: plan.targetTopic,
        migrationNeeded: plan.migrationNeeded,
        topicProvisioned: topic.created || topic.existed,
        sinkIncluded: sink.updated || sink.alreadyIncluded,
        oldTopicPreserved: true,
      },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { success: false, error: error.issues[0]?.message ?? "Invalid request." },
        { status: 400 },
      );
    }

    if (error instanceof ConfluentCloudError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: error.status && error.status < 500 ? error.status : 500 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Topic migration failed.",
      },
      { status: 500 },
    );
  }
}
```

Important behavior:

```text
Kafka topics are not renamed in place. The migration creates/verifies the new tribe topic, includes it in the S3 Sink, and preserves the old service topic until producers stop using it.
```

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/lib/topic-migration.test.ts src/lib/schemas.test.ts
npx tsc --noEmit
```

Expected:

```text
PASS
```

- [x] **Step 4: Expose migration in the Confluent card**

In `apicenter-management/src/lib/api-center-client.ts`, add:

```ts
export async function migrateLegacyTopic(
  input: TopicMigrationRequest,
): Promise<TopicMigrationResponse["data"]> {
  const payload = topicMigrationRequestSchema.parse(input);
  const response = await fetch("/api/local/confluent/topic-migrations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await parseJson(response);
  if (!response.ok) throw new Error(readErrorMessage(data));
  return topicMigrationResponseSchema.parse(data).data;
}
```

In `apicenter-management/src/components/confluent-provisioning-card.tsx`, compute:

```ts
  const migrationPlan = useMemo(
    () => planTopicMigration({ serviceId, ownerTribeId, serviceType }),
    [serviceId, ownerTribeId, serviceType],
  );
```

Show this alert when `migrationPlan.migrationNeeded` is true:

```text
Legacy topic detected: <legacyTopic>. Upgrade creates <targetTopic>, adds it to S3 Sink, and keeps the old topic until producers are moved.
```

Add an operator action button:

```text
Upgrade legacy topic
```

The button calls:

```text
POST /api/local/confluent/topic-migrations
{
  "serviceId": "logistics-orders",
  "ownerTribeId": "logistics",
  "serviceType": "tribe",
  "confirmation": {
    "typedPhrase": typedPhrase,
    "reason": operatorReason
  }
}
```

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/components/confluent-provisioning-card.test.tsx
npx tsc --noEmit
```

Expected:

```text
PASS with a test proving the card shows the legacy migration action for logistics-orders owned by logistics.
```

- [x] **Step 5: Replace ambiguous topic naming in docs**

Use these replacements where the docs describe tribe-owned business events:

```text
tribe.<service-id>.events -> tribe.<tribeId>.events
test.tribe.<service-id>.events -> test.tribe.<tribeId>.events
prod.tribe.<service-id>.events -> prod.tribe.<tribeId>.events
```

Keep shared-service export topics as:

```text
api-center.shared.<serviceId>.events
test.api-center.shared.<serviceId>.events
prod.api-center.shared.<serviceId>.events
```

Run:

```powershell
cd C:\Codes\apic
rg -n "tribe\\.<service|tribe\\.<serviceId|tribe\\.<service-id" api-center apicenter-management api-shared-services
```

Expected:

```text
Only compatibility notes or historical plan entries still mention serviceId-based tribe topics.
```

- [x] **Step 6: Add migration runbook**

Add a section to `api-center/docs/confluent-cloud-s3-sink-setup.md`:

```markdown
## Migrating From Service Topics To Tribe Topics

For each tribe:

1. Identify the tribe principal id, for example `logistics`.
2. Identify existing service topics, for example `prod.tribe.logistics-orders.events`.
3. Use the management console **Upgrade legacy topic** action, or manually create or verify `prod.tribe.logistics.events`.
4. Confirm `prod.tribe.logistics.events` is included in the managed S3 Sink connector.
5. Update SDK producers to use `tribeId=logistics` and `sourceServiceId=<microservice-id>`.
6. Verify new objects appear under the S3 prefix for `prod.tribe.logistics.events`.
7. Keep old service topics for the agreed retention window.
8. Remove old service topics from the S3 Sink after no producers publish to them.
```

- [x] **Step 7: Update analytics ownership language**

In docs that describe the lake path, use:

```text
topic folder: topics/prod.tribe.<tribeId>.events/
event field: governance.sourceServiceId
partition key: tribeId or event key, depending on ordering needs
BI filter: tribeId first, sourceServiceId second
```

Run:

```powershell
cd C:\Codes\apic
rg -n "sourceServiceId|ownerTribeId|tribe\\.<tribeId>\\.events" api-center\\docs apicenter-management\\docs api-shared-services\\docs
```

Expected:

```text
Docs consistently show the tribe as the visibility boundary and sourceServiceId as attribution.
```

- [ ] **Step 8: Commit Phase 6**

Run:

```powershell
git add api-center/docs apicenter-management api-shared-services/docs
git commit -m "feat: migrate legacy service topics to tribe topics"
```

## Phase 7: Integration Verification And Deployment

**Files:**
- Verify: `api-center`
- Verify: `apicenter-management`
- Verify: `api-shared-services`

- [x] **Step 1: Run full local gates**

Run:

```powershell
cd C:\Codes\apic\api-center
npm run lint
npm run typecheck
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run build

cd C:\Codes\apic\apicenter-management
npm run lint
npx tsc --noEmit
npm test
npm run build

cd C:\Codes\apic\api-shared-services
npm run ci
npm run build
```

Expected:

```text
All local lint, typecheck, unit, e2e, and build gates pass.
```

- [x] **Step 2: Run an end-to-end test SDK smoke**

Repeatable helper:

```powershell
cd C:\Codes\apic\api-center
$env:TRIBE_BOUNDARY_SECRET = "<plaintext-secret>"
$env:PLATFORM_ADMIN_SECRET = "<platform-admin-secret>"
$env:TRIBE_SECRET_LOGISTICS = "<sha256-of-plaintext-secret>"
npm run smoke:tribe-boundary:check-config
npm run smoke:tribe-boundary
```

Register these manifests:

```json
{
  "serviceId": "logistics",
  "ownerTribeId": "logistics",
  "name": "Logistics Tribe",
  "baseUrl": "http://logistics-control:3000",
  "requiredScopes": ["logistics:read"],
  "exposes": ["/health"],
  "consumes": ["payment", "kafka"],
  "serviceType": "tribe"
}
```

```json
{
  "serviceId": "logistics-orders",
  "ownerTribeId": "logistics",
  "name": "Logistics Orders",
  "baseUrl": "http://logistics-orders:3000",
  "requiredScopes": ["orders:read"],
  "exposes": ["/orders", "/health"],
  "consumes": [],
  "serviceType": "tribe"
}
```

Then verify:

```powershell
curl -X POST http://localhost:3000/api/v1/auth/token `
  -H "Content-Type: application/json" `
  -d '{"tribeId":"logistics","secret":"<plaintext-secret>"}'
```

Expected:

```text
Token response has tribeId=logistics and scopes include logistics/owned-service scopes plus consumed target scopes.
```

Publish:

```ts
const client = new TribeClient({
  gatewayUrl: "http://localhost:3000",
  tribeId: "logistics",
  secret: process.env.LOGISTICS_TRIBE_SECRET!,
  sourceServiceId: "logistics-orders",
});

await client.publishTribeEvent({
  key: "ord_123",
  eventType: "order.created",
  payload: { orderId: "ord_123" },
});
```

Expected:

```text
Kafka publish accepts topic tribe.logistics.events and rejects tribe.logistics-orders.events for the same token.
```

Current observation, 2026-05-20:

```text
Local API Center smoke is environment-blocked:
- Docker Desktop is unavailable in this workspace.
- http://localhost:3000/api/v1/health/live was not reachable for API Center.
- The repeatable helper exists as npm run smoke:tribe-boundary and npm run smoke:tribe-boundary:check-config.

Replacement verification used for this slice:
- Full API Center unit/e2e/build gates passed in Step 1.
- Test API Center health/readiness passed in Step 3.
- Test management provisioning and Confluent/S3 sink verification passed in Step 4.
- SDK 1.2.1 source smoke passed against API Center test on 2026-05-20.
```

- [x] **Step 3: Deploy API Center and management console to test**

Run the existing deployment process for the test environment. Do not touch prod
for this verification slice. After deploy:

```powershell
curl https://api-center-test.itsandbox.site/api/v1/health/live
curl https://api-center-test.itsandbox.site/api/v1/health/ready
```

Expected:

```text
Both health endpoints return success.
```

Current test observation, 2026-05-20:

```text
https://api-center-test.itsandbox.site/api/v1/health/live  -> HTTP 200
https://api-center-test.itsandbox.site/api/v1/health/ready -> HTTP 200
readiness details: kafka up, redis up, registry up, circuitBreakers up
```

- [x] **Step 4: Provision a tribe topic through management**

Open:

```text
http://localhost:3000/tribes/logistics-orders
```

Expected:

```text
For local management pointed at test, the Confluent card shows test.tribe.logistics.events, not test.tribe.logistics-orders.events.
```

Run:

```text
Preview topic operation -> Provision topic -> Preview S3 sink update -> Add to S3 Sink
```

Expected:

```text
The management console creates or verifies the tribe topic and confirms the S3 Sink includes the tribe topic.
```

Current test observation, 2026-05-20:

```text
Local management readiness:
- API_CENTER_BASE_URL=https://api-center-test.itsandbox.site
- NEXT_PUBLIC_KAFKA_TOPIC_PREFIX=test
- CONFLUENT_S3_CONNECTOR_NAME=api-center-test-s3-sink

Management route verification:
- Preview topic operation targeted test.tribe.logistics.events.
- Provision topic created test.tribe.logistics.events in lkc-850n9q.
- Preview S3 sink update targeted api-center-test-s3-sink.
- Add to S3 Sink updated api-center-test-s3-sink with test.tribe.logistics.events.
- Legacy migration route mapped test.tribe.logistics-orders.events -> test.tribe.logistics.events and preserved the old topic.
- Final pipeline status for logistics-orders ownerTribeId=logistics:
  topicExists=true, s3SinkIncludesTopic=true.
```

- [x] **Step 5: Prepare SDK release handoff**

Use the existing guarded SDK release workflow after CI passes. The operator
will publish the next SDK version manually as `1.2.1`; do not trigger or
republish `1.2.0` from this implementation session.

```text
operator target version: 1.2.1
release workflow: api-shared-services/.github/workflows/create-sdk-release.yml
```

Expected:

```text
GitHub Packages publishes @implementsprint/sdk@1.2.1 and consumer install docs point to the new helper.
```

Current release preflight observation, 2026-05-20:

```text
api-shared-services package version: @implementsprint/sdk@1.2.0
local tag: v1.2.0 -> cf727fb60d0fb8ccb629316a13aa464ca2df54eb
remote tag: v1.2.0 -> cf727fb60d0fb8ccb629316a13aa464ca2df54eb
npm run verify:release -- v1.2.0 -> passed
npm run ci -> passed
  - SDK publish guard passed
  - Contract compatibility check passed
  - TypeScript check passed
  - 7 Vitest files, 88 tests passed
  - build passed
  - npm pack --dry-run produced implementsprint-sdk-1.2.0.tgz

Blocked verification:
- npm view @implementsprint/sdk@1.2.0 against GitHub Packages returned 401 because no package-read token is configured in this shell.
- gh auth status reports the local GitHub CLI token is invalid.
- GitHub connector Actions lookup returned 404 for ImplementSprint/api-shared, so the release workflow run cannot be verified from this session.
- Do not rerun create-sdk-release.yml for 1.2.0 because the remote v1.2.0 tag already exists and the guarded workflow rejects reused tags.
- User will publish SDK 1.2.1 manually; implementation session treats SDK publish as an external owner action.
```

SDK 1.2.1 post-publish source verification, 2026-05-20:

```text
api-shared-services package version: @implementsprint/sdk@1.2.1
remote tag: v1.2.1 -> 13720053b8686efd8a4f7e1ce2ea6934a2c10f14
remote main: 13720053b8686efd8a4f7e1ce2ea6934a2c10f14
npm run ci -> passed
  - SDK publish guard passed
  - Contract compatibility check passed
  - TypeScript check passed
  - 7 Vitest files, 88 tests passed
  - build passed
  - npm pack --dry-run produced implementsprint-sdk-1.2.1.tgz

Test SDK smoke:
- Temporary tribe: codex-sdk-20260520041053
- Temporary source service: codex-sdk-20260520041053-api
- Physical test topic: test.tribe.codex-sdk-20260520041053.events
- Management route registered the owner tribe and owned source service.
- Secret Manager hash was provisioned for codex-sdk-20260520041053.
- Confluent created test.tribe.codex-sdk-20260520041053.events in lkc-850n9q.
- api-center-test-s3-sink was updated to include test.tribe.codex-sdk-20260520041053.events.
- TribeClient authenticated against https://api-center-test.itsandbox.site.
- kafkaGetGovernanceCatalog returned tenantTopicPrefix tribe.codex-sdk-20260520041053.
- publishTribeEvent() accepted tribe.codex-sdk-20260520041053.events with eventType codex.sdk121.smoke.
- Direct kafkaPublish() to tribe.codex-sdk-20260520041053-api.events was rejected with 403 outside tenant boundary.

Remaining package install verification:
- npm view @implementsprint/sdk@1.2.1 against GitHub Packages returned 401 because this shell has no package-read token configured.

GitHub Packages install visibility, 2026-05-20:
- Operator configured GITHUB_TOKEN with read:packages locally.
- npm view @implementsprint/sdk@1.2.1 version --registry=https://npm.pkg.github.com returned 1.2.1.
- Durable npm config uses @implementsprint registry mapping and ${GITHUB_TOKEN}; no raw token is committed.
```

- [x] **Step 6: Commit final verification notes**

Add a short verification note to the active rollout or PR description:

```text
Verified tribe boundary model:
- One secret per tribe: api-center-tribe-secret-logistics
- One topic per tribe: prod.tribe.logistics.events
- Multiple services owned by tribe: logistics-orders, logistics-inventory
- SDK publish wrapper attributes sourceServiceId
- Management console provisions ownerTribeId topic
- S3 Sink includes tribe topic
```

Final implementation verification notes, 2026-05-20:

```text
Verified tribe boundary model:
- One credential per tribe remains the runtime/auth model.
- One topic per tribe is enforced for governed Kafka publish and management provisioning.
- Multiple microservices can share ownerTribeId while retaining distinct serviceId routing and health.
- Events carry sourceServiceId for microservice attribution inside the tribe boundary.
- API Center test health/readiness returned HTTP 200.
- Management test provisioning created or verified test.tribe.logistics.events.
- The test S3 Sink api-center-test-s3-sink includes test.tribe.logistics.events.
- Legacy service topic migration maps test.tribe.logistics-orders.events to test.tribe.logistics.events and preserves the old topic.
- SDK 1.2.1 source is synced locally and passed npm run ci.
- SDK 1.2.1 source smoke passed against API Center test with a temporary tribe and sourceServiceId.
- GitHub Packages installability still requires consumer package-read auth to verify from this shell.
```

## Rollback Plan

- Keep backward compatibility fallback: `ownerTribeId ?? serviceId`.
- If management topic provisioning fails, operators can pass an explicit `topicName` equal to the current legacy topic.
- If SDK release causes consumer issues, consumers can keep using raw `kafkaPublish()` with explicit topic names while the platform keeps accepting legacy tribe ids.
- Do not delete old `tribe.<serviceId>.events` topics until producers and S3 sink delivery are verified on `tribe.<tribeId>.events`.
- If database migration needs rollback, remove only `owner_tribe_id` dependent indexes first, then the column:

```sql
DROP INDEX IF EXISTS api_center.services_org_owner_type_status_idx;
DROP INDEX IF EXISTS api_center.services_owner_tribe_idx;
ALTER TABLE api_center.services DROP COLUMN IF EXISTS owner_tribe_id;
```

## Completion Criteria

- API Center registry supports `ownerTribeId` and keeps legacy service-only entries working.
- A tribe token can access owned microservices and explicitly consumed external/shared services.
- Kafka governance accepts only the authenticated tribe topic.
- Events include `governance.sourceTribeId` and optional `governance.sourceServiceId`.
- Management console provisions and checks `tribe.<ownerTribeId>.events`.
- S3 Sink migration docs use `tribe.<tribeId>.events`.
- SDK exposes `publishTribeEvent()` and `buildTribeEventTopic()`.
- `api-center`, `apicenter-management`, and `api-shared-services` local gates pass.
