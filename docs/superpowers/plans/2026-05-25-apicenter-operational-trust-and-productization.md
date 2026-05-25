# APICenter Operational Trust And Productization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add the next APICenter improvement wave: operational trust, promotion evidence, emergency controls, API productization, dependency visibility, chargeback forecasting, and compliance-ready exports.

**Architecture:** API Center remains the runtime source of truth for governance, dependency, quota, emergency, and evidence data. APICenter Management becomes the operator and tribe-facing surface for trust views, exportable evidence, marketplace discovery, and controlled self-service. API Shared Services keeps tribe SDK and manifest contracts aligned with product catalog, quota, deprecation, and SDK adoption signals.

**Tech Stack:** NestJS 11, Prisma 7, Redis, Supabase/Postgres, Next.js 16, React 19, Zod, Vitest, Jest, TypeScript, Kafka/Confluent governance, S3/Athena pipeline evidence, GCP Secret Manager, GKE, Vercel.

---

## Scope

This plan builds on the completed governance/quota and hardening plans. It does not reimplement quotas, plans, approvals, or readiness. It adds product and operations capabilities that make APICenter easier to trust, sell, operate, and audit.

## Priority Order

1. **Governance drift detector:** show where Management intent and API Center runtime state disagree.
2. **Runtime dependency map:** show which tribes, shared services, Kafka topics, data products, and external providers depend on each other.
3. **Promotion evidence bundle:** export the evidence needed to move a tribe/service between environments.
4. **Emergency controls:** allow controlled pause, isolation, quota lockdown, and rollback-to-observe actions.
5. **API product marketplace:** turn registered APIs/shared services into discoverable products with onboarding status.
6. **Quota forecasting and chargeback:** predict quota pressure and cost pressure before incidents happen.
7. **Deprecation workflow:** manage API version retirement with impacted consumers and deadlines.
8. **Compliance and consumer scorecards:** export audit-ready packets and show tribe health/adoption signals.

## Planned File Structure

### API Center

- Create: `api-center/src/operations/operations.module.ts`
- Create: `api-center/src/operations/governance-drift.service.ts`
- Create: `api-center/src/operations/governance-drift.service.spec.ts`
- Create: `api-center/src/operations/governance-drift.controller.ts`
- Create: `api-center/src/operations/governance-drift.controller.spec.ts`
- Create: `api-center/src/operations/runtime-dependency-map.service.ts`
- Create: `api-center/src/operations/runtime-dependency-map.service.spec.ts`
- Create: `api-center/src/operations/runtime-dependency-map.controller.ts`
- Create: `api-center/src/operations/runtime-dependency-map.controller.spec.ts`
- Create: `api-center/src/operations/promotion-evidence-bundle.service.ts`
- Create: `api-center/src/operations/promotion-evidence-bundle.service.spec.ts`
- Create: `api-center/src/operations/promotion-evidence-bundle.controller.ts`
- Create: `api-center/src/operations/promotion-evidence-bundle.controller.spec.ts`
- Create: `api-center/src/operations/emergency-control.service.ts`
- Create: `api-center/src/operations/emergency-control.service.spec.ts`
- Create: `api-center/src/operations/emergency-control.controller.ts`
- Create: `api-center/src/operations/emergency-control.controller.spec.ts`
- Create: `api-center/src/operations/consumer-scorecard.service.ts`
- Create: `api-center/src/operations/consumer-scorecard.service.spec.ts`
- Create: `api-center/src/catalog/api-product.service.ts`
- Create: `api-center/src/catalog/api-product.service.spec.ts`
- Create: `api-center/src/catalog/api-product.controller.ts`
- Create: `api-center/src/catalog/api-product.controller.spec.ts`
- Create: `api-center/src/forecasting/quota-forecast.service.ts`
- Create: `api-center/src/forecasting/quota-forecast.service.spec.ts`
- Create: `api-center/src/deprecations/api-deprecation.service.ts`
- Create: `api-center/src/deprecations/api-deprecation.service.spec.ts`
- Create: `api-center/src/compliance/compliance-export.service.ts`
- Create: `api-center/src/compliance/compliance-export.service.spec.ts`
- Modify: `api-center/src/app.module.ts`
- Modify: `api-center/src/shared/proxy-handler.ts`
- Modify: `api-center/src/shared-services/shared-services.controller.ts`
- Modify: `api-center/src/tribes/tribes.controller.ts`
- Modify: `api-center/src/analytics/audit-events.service.ts`
- Modify: `api-center/src/quotas/tribe-quota-usage.controller.ts`
- Modify: `api-center/src/developer-portal/developer-portal.controller.ts`

### APICenter Management

- Create: `apicenter-management/src/app/operational-trust/page.tsx`
- Create: `apicenter-management/src/app/marketplace/page.tsx`
- Create: `apicenter-management/src/app/compliance/page.tsx`
- Create: `apicenter-management/src/app/api/local/operations/drift/route.ts`
- Create: `apicenter-management/src/app/api/local/operations/dependencies/route.ts`
- Create: `apicenter-management/src/app/api/local/operations/evidence/[serviceId]/route.ts`
- Create: `apicenter-management/src/app/api/local/operations/emergency/route.ts`
- Create: `apicenter-management/src/app/api/local/catalog/products/route.ts`
- Create: `apicenter-management/src/app/api/local/compliance/export/route.ts`
- Create: `apicenter-management/src/components/operational-trust-client.tsx`
- Create: `apicenter-management/src/components/governance-drift-panel.tsx`
- Create: `apicenter-management/src/components/runtime-dependency-map-panel.tsx`
- Create: `apicenter-management/src/components/promotion-evidence-panel.tsx`
- Create: `apicenter-management/src/components/emergency-control-panel.tsx`
- Create: `apicenter-management/src/components/api-marketplace-client.tsx`
- Create: `apicenter-management/src/components/quota-forecast-panel.tsx`
- Create: `apicenter-management/src/components/deprecation-workflow-panel.tsx`
- Create: `apicenter-management/src/components/compliance-export-panel.tsx`
- Create: `apicenter-management/src/components/consumer-scorecard-panel.tsx`
- Modify: `apicenter-management/src/components/app-shell.tsx`
- Modify: `apicenter-management/src/lib/api-center-client.ts`
- Modify: `apicenter-management/src/lib/schemas.ts`

### API Shared Services

- Modify: `api-shared-services/contracts/service-manifest.schema.json`
- Modify: `api-shared-services/templates/service-manifest.json`
- Modify: `api-shared-services/tests/manifest.test.ts`
- Modify: `api-shared-services/src/TribeClient.ts`
- Modify: `api-shared-services/src/types.ts`
- Modify: `api-shared-services/docs/consumer-runbook.md`

---

## Task 1: Governance Drift Detector

**Files:**
- Create: `api-center/src/operations/governance-drift.service.ts`
- Create: `api-center/src/operations/governance-drift.service.spec.ts`
- Create: `api-center/src/operations/governance-drift.controller.ts`
- Create: `api-center/src/operations/governance-drift.controller.spec.ts`
- Create: `api-center/src/operations/operations.module.ts`
- Modify: `api-center/src/app.module.ts`
- Create: `apicenter-management/src/app/api/local/operations/drift/route.ts`
- Create: `apicenter-management/src/components/governance-drift-panel.tsx`
- Create: `apicenter-management/src/components/governance-drift-panel.test.tsx`
- Modify: `apicenter-management/src/lib/api-center-client.ts`
- Modify: `apicenter-management/src/lib/schemas.ts`

- [x] **Step 1: Write the API Center drift service test**

Create `api-center/src/operations/governance-drift.service.spec.ts`:

```ts
import { GovernanceDriftService } from "./governance-drift.service";

describe("GovernanceDriftService", () => {
  it("flags management intent that is not active in runtime", () => {
    const service = new GovernanceDriftService();

    const result = service.compare({
      management: {
        quotaPolicies: [{ id: "quota-1", ownerTribeId: "campus-one", mode: "enforce" }],
        planAssignments: [{ id: "plan-1", ownerTribeId: "campus-one", planKey: "standard" }],
      },
      runtime: {
        quotaPolicies: [],
        planAssignments: [{ id: "plan-1", ownerTribeId: "campus-one", planKey: "standard" }],
      },
    });

    expect(result.status).toBe("drifted");
    expect(result.items).toEqual([
      {
        severity: "critical",
        resourceType: "quotaPolicy",
        resourceId: "quota-1",
        ownerTribeId: "campus-one",
        message: "Quota policy is configured in Management but not active in API Center runtime.",
      },
    ]);
  });
});
```

- [x] **Step 2: Implement the drift service**

Create `api-center/src/operations/governance-drift.service.ts`:

```ts
import { Injectable } from "@nestjs/common";

type QuotaPolicySummary = { id: string; ownerTribeId: string; mode: string };
type PlanAssignmentSummary = { id: string; ownerTribeId: string; planKey: string };

interface DriftSnapshot {
  management: {
    quotaPolicies: QuotaPolicySummary[];
    planAssignments: PlanAssignmentSummary[];
  };
  runtime: {
    quotaPolicies: QuotaPolicySummary[];
    planAssignments: PlanAssignmentSummary[];
  };
}

export interface GovernanceDriftItem {
  severity: "warning" | "critical";
  resourceType: "quotaPolicy" | "planAssignment";
  resourceId: string;
  ownerTribeId: string;
  message: string;
}

@Injectable()
export class GovernanceDriftService {
  compare(snapshot: DriftSnapshot) {
    const items: GovernanceDriftItem[] = [];
    const runtimeQuotaIds = new Set(snapshot.runtime.quotaPolicies.map((policy) => policy.id));
    const runtimePlanIds = new Set(snapshot.runtime.planAssignments.map((plan) => plan.id));

    for (const policy of snapshot.management.quotaPolicies) {
      if (!runtimeQuotaIds.has(policy.id)) {
        items.push({
          severity: policy.mode === "enforce" ? "critical" : "warning",
          resourceType: "quotaPolicy",
          resourceId: policy.id,
          ownerTribeId: policy.ownerTribeId,
          message: "Quota policy is configured in Management but not active in API Center runtime.",
        });
      }
    }

    for (const plan of snapshot.management.planAssignments) {
      if (!runtimePlanIds.has(plan.id)) {
        items.push({
          severity: "warning",
          resourceType: "planAssignment",
          resourceId: plan.id,
          ownerTribeId: plan.ownerTribeId,
          message: "Plan assignment is configured in Management but not active in API Center runtime.",
        });
      }
    }

    return {
      status: items.length > 0 ? "drifted" : "in_sync",
      items,
    };
  }
}
```

- [x] **Step 3: Add the admin drift endpoint**

Create `api-center/src/operations/governance-drift.controller.ts`:

```ts
import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ScopedAdminGuard } from "../auth/guards/scoped-admin.guard";
import { GovernanceDriftService } from "./governance-drift.service";

@Controller("admin/operations/drift")
@UseGuards(ScopedAdminGuard)
export class GovernanceDriftController {
  constructor(private readonly drift: GovernanceDriftService) {}

  @Post("compare")
  compare(@Body() snapshot: Parameters<GovernanceDriftService["compare"]>[0]) {
    return { success: true, data: this.drift.compare(snapshot) };
  }
}
```

- [x] **Step 4: Register the operations module**

Create `api-center/src/operations/operations.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { GovernanceDriftController } from "./governance-drift.controller";
import { GovernanceDriftService } from "./governance-drift.service";

@Module({
  controllers: [GovernanceDriftController],
  providers: [GovernanceDriftService],
  exports: [GovernanceDriftService],
})
export class OperationsModule {}
```

Add `OperationsModule` to `api-center/src/app.module.ts`.

- [x] **Step 5: Add the Management route and panel**

Create `apicenter-management/src/components/governance-drift-panel.tsx`:

```tsx
type DriftItem = {
  severity: "warning" | "critical";
  resourceType: string;
  resourceId: string;
  ownerTribeId: string;
  message: string;
};

export function GovernanceDriftPanel({ items }: { items: DriftItem[] }) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">Governance drift</h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Management and runtime governance are in sync.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {items.map((item) => (
            <li className="p-3 text-sm" key={`${item.resourceType}:${item.resourceId}`}>
              <div className="font-medium">{item.ownerTribeId}</div>
              <div className="text-muted-foreground">{item.message}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [x] **Step 6: Run focused tests**

Run from `api-center`:

```powershell
npm run test -- src/operations/governance-drift.service.spec.ts src/operations/governance-drift.controller.spec.ts --runInBand
```

Run from `apicenter-management`:

```powershell
npm test -- src/components/governance-drift-panel.test.tsx
```

- [x] **Step 7: Commit**

```powershell
git add api-center/src/operations api-center/src/app.module.ts apicenter-management/src/app/api/local/operations/drift/route.ts apicenter-management/src/components/governance-drift-panel.tsx apicenter-management/src/components/governance-drift-panel.test.tsx apicenter-management/src/lib/api-center-client.ts apicenter-management/src/lib/schemas.ts
git commit -m "feat: add governance drift detection"
```

## Task 2: Runtime Dependency Map

**Files:**
- Create: `api-center/src/operations/runtime-dependency-map.service.ts`
- Create: `api-center/src/operations/runtime-dependency-map.service.spec.ts`
- Create: `api-center/src/operations/runtime-dependency-map.controller.ts`
- Create: `api-center/src/operations/runtime-dependency-map.controller.spec.ts`
- Modify: `api-center/src/operations/operations.module.ts`
- Create: `apicenter-management/src/app/api/local/operations/dependencies/route.ts`
- Create: `apicenter-management/src/components/runtime-dependency-map-panel.tsx`
- Create: `apicenter-management/src/components/runtime-dependency-map-panel.test.tsx`

- [x] **Step 1: Write dependency map service test**

Create `api-center/src/operations/runtime-dependency-map.service.spec.ts`:

```ts
import { RuntimeDependencyMapService } from "./runtime-dependency-map.service";

describe("RuntimeDependencyMapService", () => {
  it("builds tribe to shared service and Kafka dependencies", () => {
    const service = new RuntimeDependencyMapService();

    const map = service.build({
      services: [
        {
          serviceId: "campus-one",
          serviceType: "tribe",
          consumes: ["payment-service", "kafka"],
          exposes: ["/students"],
        },
        {
          serviceId: "payment-service",
          serviceType: "shared",
          consumes: [],
          exposes: ["/payments"],
        },
      ],
      topics: [{ ownerTribeId: "campus-one", topicName: "tribe.campus-one.events" }],
    });

    expect(map.edges).toContainEqual({
      from: "campus-one",
      to: "payment-service",
      type: "shared-service",
    });
    expect(map.edges).toContainEqual({
      from: "campus-one",
      to: "tribe.campus-one.events",
      type: "kafka-topic",
    });
  });
});
```

- [x] **Step 2: Implement dependency map service**

Create `api-center/src/operations/runtime-dependency-map.service.ts`:

```ts
import { Injectable } from "@nestjs/common";

type ServiceNode = {
  serviceId: string;
  serviceType: "tribe" | "shared" | string;
  consumes?: string[];
  exposes?: string[];
};

type TopicNode = {
  ownerTribeId: string;
  topicName: string;
};

@Injectable()
export class RuntimeDependencyMapService {
  build(input: { services: ServiceNode[]; topics: TopicNode[] }) {
    const nodes = [
      ...input.services.map((service) => ({
        id: service.serviceId,
        type: service.serviceType,
        label: service.serviceId,
      })),
      ...input.topics.map((topic) => ({
        id: topic.topicName,
        type: "kafka-topic",
        label: topic.topicName,
      })),
    ];

    const edges = [
      ...input.services.flatMap((service) =>
        (service.consumes ?? []).map((target) => ({
          from: service.serviceId,
          to: target,
          type: target === "kafka" ? "kafka" : "shared-service",
        })),
      ),
      ...input.topics.map((topic) => ({
        from: topic.ownerTribeId,
        to: topic.topicName,
        type: "kafka-topic",
      })),
    ];

    return { nodes, edges };
  }
}
```

- [x] **Step 3: Add endpoint and Management panel**

Add controller `GET /admin/operations/dependencies` that returns `{ success: true, data: map }`.

Create `apicenter-management/src/components/runtime-dependency-map-panel.tsx`:

```tsx
type DependencyEdge = { from: string; to: string; type: string };

export function RuntimeDependencyMapPanel({ edges }: { edges: DependencyEdge[] }) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">Runtime dependency map</h2>
      <div className="rounded-md border">
        {edges.map((edge) => (
          <div className="grid grid-cols-[1fr_auto_1fr] gap-3 border-b p-3 text-sm" key={`${edge.from}:${edge.to}:${edge.type}`}>
            <span>{edge.from}</span>
            <span className="text-muted-foreground">{edge.type}</span>
            <span>{edge.to}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [x] **Step 4: Run focused tests**

```powershell
npm run test -- src/operations/runtime-dependency-map.service.spec.ts src/operations/runtime-dependency-map.controller.spec.ts --runInBand
```

```powershell
npm test -- src/components/runtime-dependency-map-panel.test.tsx
```

- [x] **Step 5: Commit**

```powershell
git add api-center/src/operations/runtime-dependency-map.* api-center/src/operations/operations.module.ts apicenter-management/src/app/api/local/operations/dependencies/route.ts apicenter-management/src/components/runtime-dependency-map-panel.tsx apicenter-management/src/components/runtime-dependency-map-panel.test.tsx
git commit -m "feat: add runtime dependency map"
```

## Task 3: Promotion Evidence Bundle

**Files:**
- Create: `api-center/src/operations/promotion-evidence-bundle.service.ts`
- Create: `api-center/src/operations/promotion-evidence-bundle.service.spec.ts`
- Create: `api-center/src/operations/promotion-evidence-bundle.controller.ts`
- Create: `api-center/src/operations/promotion-evidence-bundle.controller.spec.ts`
- Modify: `api-center/src/operations/operations.module.ts`
- Create: `apicenter-management/src/app/api/local/operations/evidence/[serviceId]/route.ts`
- Create: `apicenter-management/src/components/promotion-evidence-panel.tsx`
- Create: `apicenter-management/src/components/promotion-evidence-panel.test.tsx`

- [x] **Step 1: Add evidence bundle test**

Create `api-center/src/operations/promotion-evidence-bundle.service.spec.ts`:

```ts
import { PromotionEvidenceBundleService } from "./promotion-evidence-bundle.service";

describe("PromotionEvidenceBundleService", () => {
  it("builds a complete promotion evidence bundle", () => {
    const service = new PromotionEvidenceBundleService();

    const bundle = service.build({
      serviceId: "campus-one",
      health: { status: "up" },
      quotaPolicy: { id: "quota-1", mode: "observe" },
      planAssignment: { id: "plan-1", planKey: "standard" },
      approval: { id: "approval-1", status: "approved" },
      smoke: { status: "passed" },
      manifest: { status: "valid" },
      pipeline: { topicExists: true, s3SinkIncludesTopic: true },
    });

    expect(bundle.ready).toBe(true);
    expect(bundle.sections.map((section) => section.key)).toEqual([
      "health",
      "quota",
      "plan",
      "approval",
      "smoke",
      "manifest",
      "pipeline",
    ]);
  });
});
```

- [x] **Step 2: Implement evidence bundle service**

Create `api-center/src/operations/promotion-evidence-bundle.service.ts`:

```ts
import { Injectable } from "@nestjs/common";

@Injectable()
export class PromotionEvidenceBundleService {
  build(input: Record<string, any>) {
    const sections = [
      { key: "health", status: input.health?.status === "up" ? "pass" : "fail", data: input.health },
      { key: "quota", status: input.quotaPolicy ? "pass" : "fail", data: input.quotaPolicy },
      { key: "plan", status: input.planAssignment ? "pass" : "fail", data: input.planAssignment },
      { key: "approval", status: input.approval?.status === "approved" ? "pass" : "fail", data: input.approval },
      { key: "smoke", status: input.smoke?.status === "passed" ? "pass" : "fail", data: input.smoke },
      { key: "manifest", status: input.manifest?.status === "valid" ? "pass" : "fail", data: input.manifest },
      { key: "pipeline", status: input.pipeline?.topicExists && input.pipeline?.s3SinkIncludesTopic ? "pass" : "fail", data: input.pipeline },
    ];

    return {
      serviceId: input.serviceId,
      ready: sections.every((section) => section.status === "pass"),
      generatedAt: new Date().toISOString(),
      sections,
    };
  }
}
```

- [x] **Step 3: Add JSON and Markdown export endpoint**

Create a controller with `GET /admin/operations/evidence/:serviceId` and optional `format=md`.

Markdown output should include:

```md
# Promotion Evidence: campus-one

## Health
- Status: pass

## Quota
- Policy: quota-1

## Approval
- Approval: approval-1
```

- [x] **Step 4: Add Management evidence panel**

Create `apicenter-management/src/components/promotion-evidence-panel.tsx` with a section list and a download link to `/api/local/operations/evidence/${serviceId}?format=md`.

- [x] **Step 5: Run focused tests**

```powershell
npm run test -- src/operations/promotion-evidence-bundle.service.spec.ts src/operations/promotion-evidence-bundle.controller.spec.ts --runInBand
```

```powershell
npm test -- src/components/promotion-evidence-panel.test.tsx
```

- [x] **Step 6: Commit**

```powershell
git add api-center/src/operations/promotion-evidence-bundle.* api-center/src/operations/operations.module.ts apicenter-management/src/app/api/local/operations/evidence apicenter-management/src/components/promotion-evidence-panel.tsx apicenter-management/src/components/promotion-evidence-panel.test.tsx
git commit -m "feat: add promotion evidence bundle"
```

## Task 4: Emergency Controls

**Files:**
- Create: `api-center/src/operations/emergency-control.service.ts`
- Create: `api-center/src/operations/emergency-control.service.spec.ts`
- Create: `api-center/src/operations/emergency-control.controller.ts`
- Create: `api-center/src/operations/emergency-control.controller.spec.ts`
- Modify: `api-center/src/shared/proxy-handler.ts`
- Modify: `api-center/src/shared-services/shared-services.controller.ts`
- Modify: `api-center/src/tribes/tribes.controller.ts`
- Create: `apicenter-management/src/app/api/local/operations/emergency/route.ts`
- Create: `apicenter-management/src/components/emergency-control-panel.tsx`
- Create: `apicenter-management/src/components/emergency-control-panel.test.tsx`

- [x] **Step 1: Write emergency control tests**

Create `api-center/src/operations/emergency-control.service.spec.ts`:

```ts
import { EmergencyControlService } from "./emergency-control.service";

describe("EmergencyControlService", () => {
  it("blocks traffic when a tribe is paused", () => {
    const service = new EmergencyControlService();

    service.apply({
      targetType: "tribe",
      targetId: "campus-one",
      mode: "pause",
      reason: "Incident containment",
      appliedBy: "platform@example.test",
    });

    expect(service.evaluate({ ownerTribeId: "campus-one", serviceId: "student-api" })).toEqual({
      allowed: false,
      reason: "Incident containment",
      mode: "pause",
    });
  });
});
```

- [x] **Step 2: Implement emergency control service**

Create `api-center/src/operations/emergency-control.service.ts`:

```ts
import { Injectable } from "@nestjs/common";

type EmergencyMode = "pause" | "isolate" | "quota_lockdown" | "observe_only";

interface EmergencyControl {
  targetType: "tribe" | "service" | "shared-service";
  targetId: string;
  mode: EmergencyMode;
  reason: string;
  appliedBy: string;
  expiresAt?: string;
}

@Injectable()
export class EmergencyControlService {
  private readonly controls = new Map<string, EmergencyControl>();

  apply(control: EmergencyControl) {
    this.controls.set(`${control.targetType}:${control.targetId}`, control);
    return control;
  }

  clear(targetType: EmergencyControl["targetType"], targetId: string) {
    this.controls.delete(`${targetType}:${targetId}`);
  }

  evaluate(input: { ownerTribeId: string; serviceId: string }) {
    const control =
      this.controls.get(`tribe:${input.ownerTribeId}`) ??
      this.controls.get(`service:${input.serviceId}`);

    if (!control) return { allowed: true };
    if (control.expiresAt && Date.parse(control.expiresAt) < Date.now()) return { allowed: true };

    return {
      allowed: control.mode === "observe_only",
      reason: control.reason,
      mode: control.mode,
    };
  }
}
```

- [x] **Step 3: Enforce emergency controls in runtime paths**

Before proxying or shared-service execution, call:

```ts
const emergency = this.emergencyControls.evaluate({
  ownerTribeId: tribeId,
  serviceId: targetServiceId,
});

if (!emergency.allowed) {
  throw new ForbiddenError(`Emergency control active: ${emergency.reason}`);
}
```

- [x] **Step 4: Add Management controls**

Create `apicenter-management/src/components/emergency-control-panel.tsx` with:

```tsx
export function EmergencyControlPanel({
  onApply,
}: {
  onApply: (input: { targetType: string; targetId: string; mode: string; reason: string }) => void;
}) {
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        onApply({
          targetType: String(form.get("targetType")),
          targetId: String(form.get("targetId")),
          mode: String(form.get("mode")),
          reason: String(form.get("reason")),
        });
      }}
    >
      <h2 className="text-base font-semibold">Emergency controls</h2>
      <input name="targetId" className="h-9 rounded-md border px-3" />
      <select name="targetType" className="h-9 rounded-md border px-3">
        <option value="tribe">Tribe</option>
        <option value="service">Service</option>
        <option value="shared-service">Shared service</option>
      </select>
      <select name="mode" className="h-9 rounded-md border px-3">
        <option value="pause">Pause</option>
        <option value="isolate">Isolate</option>
        <option value="quota_lockdown">Quota lockdown</option>
        <option value="observe_only">Rollback to observe</option>
      </select>
      <textarea name="reason" className="min-h-20 rounded-md border px-3 py-2" />
      <button className="h-9 rounded-md bg-destructive px-3 text-destructive-foreground" type="submit">
        Apply control
      </button>
    </form>
  );
}
```

- [x] **Step 5: Run focused tests**

```powershell
npm run test -- src/operations/emergency-control.service.spec.ts src/operations/emergency-control.controller.spec.ts src/shared/proxy-handler.spec.ts src/shared-services/shared-services.controller.spec.ts src/tribes/tribes.controller.spec.ts --runInBand
```

```powershell
npm test -- src/components/emergency-control-panel.test.tsx
```

- [x] **Step 6: Commit**

```powershell
git add api-center/src/operations/emergency-control.* api-center/src/shared/proxy-handler.ts api-center/src/shared-services/shared-services.controller.ts api-center/src/tribes/tribes.controller.ts apicenter-management/src/app/api/local/operations/emergency/route.ts apicenter-management/src/components/emergency-control-panel.tsx apicenter-management/src/components/emergency-control-panel.test.tsx
git commit -m "feat: add emergency platform controls"
```

## Task 5: API Product Marketplace And Deprecation Workflow

**Files:**
- Create: `api-center/src/catalog/api-product.service.ts`
- Create: `api-center/src/catalog/api-product.service.spec.ts`
- Create: `api-center/src/catalog/api-product.controller.ts`
- Create: `api-center/src/catalog/api-product.controller.spec.ts`
- Create: `api-center/src/deprecations/api-deprecation.service.ts`
- Create: `api-center/src/deprecations/api-deprecation.service.spec.ts`
- Create: `apicenter-management/src/app/marketplace/page.tsx`
- Create: `apicenter-management/src/app/api/local/catalog/products/route.ts`
- Create: `apicenter-management/src/components/api-marketplace-client.tsx`
- Create: `apicenter-management/src/components/deprecation-workflow-panel.tsx`
- Modify: `api-shared-services/contracts/service-manifest.schema.json`
- Modify: `api-shared-services/templates/service-manifest.json`
- Modify: `api-shared-services/tests/manifest.test.ts`

- [x] **Step 1: Add product projection test**

Create `api-center/src/catalog/api-product.service.spec.ts`:

```ts
import { ApiProductService } from "./api-product.service";

describe("ApiProductService", () => {
  it("projects registry services into marketplace products", () => {
    const service = new ApiProductService();

    const products = service.fromRegistry([
      {
        serviceId: "payment-service",
        name: "Payment Service",
        serviceType: "shared",
        ownerTeam: "Platform Payments",
        contact: "payments@example.test",
        serviceTier: "gold",
        requiredScopes: ["payments:create"],
        exposes: ["/payments"],
        status: "active",
      },
    ] as any);

    expect(products[0]).toMatchObject({
      productId: "payment-service",
      displayName: "Payment Service",
      category: "shared-service",
      onboardingStatus: "available",
    });
  });
});
```

- [x] **Step 2: Implement product projection**

Create `api-center/src/catalog/api-product.service.ts`:

```ts
import { Injectable } from "@nestjs/common";

@Injectable()
export class ApiProductService {
  fromRegistry(services: Array<Record<string, any>>) {
    return services.map((service) => ({
      productId: service.serviceId,
      displayName: service.name ?? service.serviceId,
      category: service.serviceType === "shared" ? "shared-service" : "tribe-api",
      ownerTeam: service.ownerTeam ?? "Unassigned",
      contact: service.contact ?? "",
      serviceTier: service.serviceTier ?? "standard",
      requiredScopes: service.requiredScopes ?? [],
      exposes: service.exposes ?? [],
      onboardingStatus: service.status === "active" ? "available" : "restricted",
    }));
  }
}
```

- [x] **Step 3: Add deprecation policy**

Create `api-center/src/deprecations/api-deprecation.service.ts`:

```ts
import { Injectable } from "@nestjs/common";

@Injectable()
export class ApiDeprecationService {
  evaluate(input: { productId: string; deprecatedAt?: string; sunsetAt?: string; consumers: string[] }) {
    if (!input.deprecatedAt) return { status: "active", impactedConsumers: [] };

    return {
      status: input.sunsetAt && Date.parse(input.sunsetAt) <= Date.now() ? "sunset" : "deprecated",
      impactedConsumers: input.consumers,
      nextAction:
        input.consumers.length > 0
          ? "Notify impacted consumers and track migration."
          : "No active consumers; product can be retired after approval.",
    };
  }
}
```

- [x] **Step 4: Extend shared-service manifest contract**

Add optional marketplace metadata to `api-shared-services/contracts/service-manifest.schema.json`:

```json
{
  "marketplace": {
    "type": "object",
    "properties": {
      "displayName": { "type": "string" },
      "category": { "type": "string" },
      "description": { "type": "string" },
      "docsUrl": { "type": "string" },
      "supportTier": { "type": "string" },
      "deprecatedAt": { "type": "string" },
      "sunsetAt": { "type": "string" }
    },
    "additionalProperties": false
  }
}
```

- [x] **Step 5: Add marketplace UI**

Create `apicenter-management/src/components/api-marketplace-client.tsx` with product cards showing product name, category, tier, owner, scopes, status, and onboarding action.

- [x] **Step 6: Run focused tests**

```powershell
npm run test -- src/catalog/api-product.service.spec.ts src/catalog/api-product.controller.spec.ts src/deprecations/api-deprecation.service.spec.ts --runInBand
```

```powershell
npm test -- src/components/api-marketplace-client.test.tsx src/components/deprecation-workflow-panel.test.tsx
```

```powershell
npm test -- tests/manifest.test.ts
```

- [x] **Step 7: Commit**

```powershell
git add api-center/src/catalog api-center/src/deprecations apicenter-management/src/app/marketplace apicenter-management/src/app/api/local/catalog/products/route.ts apicenter-management/src/components/api-marketplace-client.tsx apicenter-management/src/components/deprecation-workflow-panel.tsx api-shared-services/contracts/service-manifest.schema.json api-shared-services/templates/service-manifest.json api-shared-services/tests/manifest.test.ts
git commit -m "feat: add api product marketplace"
```

## Task 6: Quota Forecasting And Chargeback

**Files:**
- Create: `api-center/src/forecasting/quota-forecast.service.ts`
- Create: `api-center/src/forecasting/quota-forecast.service.spec.ts`
- Modify: `api-center/src/quotas/tribe-quota-usage.controller.ts`
- Create: `apicenter-management/src/components/quota-forecast-panel.tsx`
- Create: `apicenter-management/src/components/quota-forecast-panel.test.tsx`

- [x] **Step 1: Add forecast test**

Create `api-center/src/forecasting/quota-forecast.service.spec.ts`:

```ts
import { QuotaForecastService } from "./quota-forecast.service";

describe("QuotaForecastService", () => {
  it("predicts days until quota exhaustion", () => {
    const service = new QuotaForecastService();

    expect(
      service.forecast({
        quotaLimit: 10000,
        used: 7000,
        averageDailyUsage: 1000,
      }),
    ).toEqual({
      status: "warning",
      daysUntilExhaustion: 3,
      projectedMonthlyUsage: 30000,
    });
  });
});
```

- [x] **Step 2: Implement forecast service**

Create `api-center/src/forecasting/quota-forecast.service.ts`:

```ts
import { Injectable } from "@nestjs/common";

@Injectable()
export class QuotaForecastService {
  forecast(input: { quotaLimit: number; used: number; averageDailyUsage: number }) {
    const remaining = Math.max(0, input.quotaLimit - input.used);
    const daysUntilExhaustion =
      input.averageDailyUsage <= 0 ? null : Math.ceil(remaining / input.averageDailyUsage);
    const projectedMonthlyUsage = Math.round(input.averageDailyUsage * 30);

    return {
      status:
        daysUntilExhaustion !== null && daysUntilExhaustion <= 7
          ? "warning"
          : "normal",
      daysUntilExhaustion,
      projectedMonthlyUsage,
    };
  }
}
```

- [x] **Step 3: Attach forecasts to quota usage response**

Add a `forecast` object to quota usage responses:

```ts
forecast: {
  status: "normal" | "warning";
  daysUntilExhaustion: number | null;
  projectedMonthlyUsage: number;
}
```

- [x] **Step 4: Add Management forecast panel**

Create `apicenter-management/src/components/quota-forecast-panel.tsx`:

```tsx
export function QuotaForecastPanel({
  daysUntilExhaustion,
  projectedMonthlyUsage,
}: {
  daysUntilExhaustion: number | null;
  projectedMonthlyUsage: number;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold">Quota forecast</h2>
      <p className="text-sm text-muted-foreground">
        {daysUntilExhaustion === null
          ? "No exhaustion projected."
          : `Quota may be exhausted in ${daysUntilExhaustion} days.`}
      </p>
      <p className="text-sm">Projected monthly usage: {projectedMonthlyUsage.toLocaleString()} calls</p>
    </section>
  );
}
```

- [x] **Step 5: Run focused tests**

```powershell
npm run test -- src/forecasting/quota-forecast.service.spec.ts src/quotas/tribe-quota-usage.controller.spec.ts --runInBand
```

```powershell
npm test -- src/components/quota-forecast-panel.test.tsx
```

- [x] **Step 6: Commit**

```powershell
git add api-center/src/forecasting api-center/src/quotas/tribe-quota-usage.controller.ts apicenter-management/src/components/quota-forecast-panel.tsx apicenter-management/src/components/quota-forecast-panel.test.tsx
git commit -m "feat: add quota forecasting"
```

## Task 7: Compliance Export And Consumer Scorecards

**Files:**
- Create: `api-center/src/compliance/compliance-export.service.ts`
- Create: `api-center/src/compliance/compliance-export.service.spec.ts`
- Create: `api-center/src/operations/consumer-scorecard.service.ts`
- Create: `api-center/src/operations/consumer-scorecard.service.spec.ts`
- Create: `apicenter-management/src/app/compliance/page.tsx`
- Create: `apicenter-management/src/app/api/local/compliance/export/route.ts`
- Create: `apicenter-management/src/components/compliance-export-panel.tsx`
- Create: `apicenter-management/src/components/compliance-export-panel.test.tsx`
- Create: `apicenter-management/src/components/consumer-scorecard-panel.tsx`
- Create: `apicenter-management/src/components/consumer-scorecard-panel.test.tsx`
- Modify: `api-shared-services/src/TribeClient.ts`
- Modify: `api-shared-services/src/types.ts`
- Modify: `api-shared-services/docs/consumer-runbook.md`

- [x] **Step 1: Add compliance export test**

Create `api-center/src/compliance/compliance-export.service.spec.ts`:

```ts
import { ComplianceExportService } from "./compliance-export.service";

describe("ComplianceExportService", () => {
  it("creates a compliance packet from audit and evidence inputs", () => {
    const service = new ComplianceExportService();

    const packet = service.buildPacket({
      from: "2026-05-01",
      to: "2026-05-25",
      auditEvents: [{ type: "quota.policy.updated", timestamp: "2026-05-20T00:00:00.000Z" }],
      evidenceBundles: [{ serviceId: "campus-one", ready: true }],
    } as any);

    expect(packet.summary.auditEventCount).toBe(1);
    expect(packet.summary.evidenceBundleCount).toBe(1);
  });
});
```

- [x] **Step 2: Implement compliance export service**

Create `api-center/src/compliance/compliance-export.service.ts`:

```ts
import { Injectable } from "@nestjs/common";

@Injectable()
export class ComplianceExportService {
  buildPacket(input: {
    from: string;
    to: string;
    auditEvents: Array<Record<string, any>>;
    evidenceBundles: Array<Record<string, any>>;
  }) {
    return {
      generatedAt: new Date().toISOString(),
      range: { from: input.from, to: input.to },
      summary: {
        auditEventCount: input.auditEvents.length,
        evidenceBundleCount: input.evidenceBundles.length,
      },
      auditEvents: input.auditEvents,
      evidenceBundles: input.evidenceBundles,
    };
  }
}
```

- [x] **Step 3: Add consumer scorecard test**

Create `api-center/src/operations/consumer-scorecard.service.spec.ts`:

```ts
import { ConsumerScorecardService } from "./consumer-scorecard.service";

describe("ConsumerScorecardService", () => {
  it("flags stale SDK usage and quota pressure", () => {
    const service = new ConsumerScorecardService();

    const scorecard = service.score({
      ownerTribeId: "campus-one",
      sdkVersion: "0.1.0",
      latestSdkVersion: "0.3.0",
      quotaUsagePercent: 92,
      errorRatePercent: 1.5,
    });

    expect(scorecard.status).toBe("needs_attention");
    expect(scorecard.findings).toContain("SDK version is behind the current supported version.");
    expect(scorecard.findings).toContain("Quota usage is above 90 percent.");
  });
});
```

- [x] **Step 4: Implement scorecard service**

Create `api-center/src/operations/consumer-scorecard.service.ts`:

```ts
import { Injectable } from "@nestjs/common";

@Injectable()
export class ConsumerScorecardService {
  score(input: {
    ownerTribeId: string;
    sdkVersion: string;
    latestSdkVersion: string;
    quotaUsagePercent: number;
    errorRatePercent: number;
  }) {
    const findings: string[] = [];

    if (input.sdkVersion !== input.latestSdkVersion) {
      findings.push("SDK version is behind the current supported version.");
    }
    if (input.quotaUsagePercent >= 90) {
      findings.push("Quota usage is above 90 percent.");
    }
    if (input.errorRatePercent >= 2) {
      findings.push("Error rate is above the platform threshold.");
    }

    return {
      ownerTribeId: input.ownerTribeId,
      status: findings.length > 0 ? "needs_attention" : "healthy",
      findings,
    };
  }
}
```

- [x] **Step 5: Add Management compliance and scorecard panels**

Create `compliance-export-panel.tsx` with date range controls and JSON/Markdown export buttons. Create `consumer-scorecard-panel.tsx` with SDK version, quota pressure, error rate, and findings.

- [x] **Step 6: Update SDK docs with adoption reporting**

In `api-shared-services/docs/consumer-runbook.md`, add:

```md
## SDK Adoption Reporting

APICenter Management may show whether a tribe is on the current supported SDK version. Tribes should upgrade before production promotion when quota handling, retry behavior, or manifest compatibility changes.
```

- [x] **Step 7: Run focused tests**

```powershell
npm run test -- src/compliance/compliance-export.service.spec.ts src/operations/consumer-scorecard.service.spec.ts --runInBand
```

```powershell
npm test -- src/components/compliance-export-panel.test.tsx src/components/consumer-scorecard-panel.test.tsx
```

```powershell
npm test -- tests/TribeClient.test.ts
```

- [x] **Step 8: Commit**

```powershell
git add api-center/src/compliance api-center/src/operations/consumer-scorecard.* apicenter-management/src/app/compliance apicenter-management/src/app/api/local/compliance/export/route.ts apicenter-management/src/components/compliance-export-panel.tsx apicenter-management/src/components/compliance-export-panel.test.tsx apicenter-management/src/components/consumer-scorecard-panel.tsx apicenter-management/src/components/consumer-scorecard-panel.test.tsx api-shared-services/src/TribeClient.ts api-shared-services/src/types.ts api-shared-services/docs/consumer-runbook.md
git commit -m "feat: add compliance exports and consumer scorecards"
```

## Task 8: Unified Operational Trust Page And Final Verification

**Files:**
- Create: `apicenter-management/src/app/operational-trust/page.tsx`
- Create: `apicenter-management/src/components/operational-trust-client.tsx`
- Create: `apicenter-management/src/components/operational-trust-client.test.tsx`
- Modify: `apicenter-management/src/components/app-shell.tsx`
- Modify: `apicenter-management/src/lib/schemas.ts`
- Modify: `apicenter-management/src/lib/api-center-client.ts`
- Modify: `api-center/docs/developer/operational-trust-runbook.md`
- Modify: `api-shared-services/docs/consumer-runbook.md`

- [x] **Step 1: Add the operational trust client test**

Create `apicenter-management/src/components/operational-trust-client.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OperationalTrustClient } from "./operational-trust-client";

describe("OperationalTrustClient", () => {
  it("renders the trust sections operators need before promotion", () => {
    render(
      <OperationalTrustClient
        driftItems={[]}
        dependencyEdges={[]}
        evidenceSections={[]}
        scorecards={[]}
      />,
    );

    expect(screen.getByText("Governance drift")).toBeTruthy();
    expect(screen.getByText("Runtime dependency map")).toBeTruthy();
    expect(screen.getByText("Promotion evidence")).toBeTruthy();
    expect(screen.getByText("Consumer scorecards")).toBeTruthy();
  });
});
```

- [x] **Step 2: Implement the page shell**

Create `apicenter-management/src/components/operational-trust-client.tsx`:

```tsx
import { GovernanceDriftPanel } from "./governance-drift-panel";
import { RuntimeDependencyMapPanel } from "./runtime-dependency-map-panel";
import { PromotionEvidencePanel } from "./promotion-evidence-panel";
import { ConsumerScorecardPanel } from "./consumer-scorecard-panel";

export function OperationalTrustClient({
  driftItems,
  dependencyEdges,
  evidenceSections,
  scorecards,
}: {
  driftItems: any[];
  dependencyEdges: any[];
  evidenceSections: any[];
  scorecards: any[];
}) {
  return (
    <div className="space-y-6">
      <GovernanceDriftPanel items={driftItems} />
      <RuntimeDependencyMapPanel edges={dependencyEdges} />
      <PromotionEvidencePanel sections={evidenceSections} />
      <ConsumerScorecardPanel scorecards={scorecards} />
    </div>
  );
}
```

Create `apicenter-management/src/app/operational-trust/page.tsx` and fetch data through local API routes.

- [x] **Step 3: Add navigation**

In `apicenter-management/src/components/app-shell.tsx`, add:

```ts
{ href: "/operational-trust", label: "Operational Trust" },
{ href: "/marketplace", label: "Marketplace" },
{ href: "/compliance", label: "Compliance" },
```

- [x] **Step 4: Add runbook**

Create `api-center/docs/developer/operational-trust-runbook.md`:

```md
# APICenter Operational Trust Runbook

Use this page before production promotion, during incidents, and during audit preparation.

## Required Checks

1. Governance drift must be empty.
2. Runtime dependency map must show known consumers and providers.
3. Promotion evidence bundle must pass all sections.
4. Emergency controls must be inactive unless an incident is open.
5. Consumer scorecards must not show stale SDK, high quota pressure, or high error rate for the promoted tribe.
```

- [x] **Step 5: Run complete verification**

Run from `api-center`:

```powershell
npm run test -- src/operations/governance-drift.service.spec.ts src/operations/runtime-dependency-map.service.spec.ts src/operations/promotion-evidence-bundle.service.spec.ts src/operations/emergency-control.service.spec.ts src/catalog/api-product.service.spec.ts src/forecasting/quota-forecast.service.spec.ts src/compliance/compliance-export.service.spec.ts src/operations/consumer-scorecard.service.spec.ts --runInBand
npm run typecheck
npm run lint
npm run build
```

Run from `apicenter-management`:

```powershell
npm test -- src/components/governance-drift-panel.test.tsx src/components/runtime-dependency-map-panel.test.tsx src/components/promotion-evidence-panel.test.tsx src/components/emergency-control-panel.test.tsx src/components/api-marketplace-client.test.tsx src/components/quota-forecast-panel.test.tsx src/components/compliance-export-panel.test.tsx src/components/consumer-scorecard-panel.test.tsx src/components/operational-trust-client.test.tsx
npm run typecheck
npm run lint
npm run build
```

Run from `api-shared-services`:

```powershell
npm test -- tests/manifest.test.ts tests/TribeClient.test.ts
npm run typecheck
npm run lint
npm run build
npm run check:contracts
```

- [x] **Step 6: Mark plan complete after verification**

After verification passes, update this plan checklist from `[ ]` to `[x]`, then update both plan indexes from `active` to `completed`.

- [x] **Step 7: Commit**

```powershell
git add apicenter-management/src/app/operational-trust apicenter-management/src/components/operational-trust-client.tsx apicenter-management/src/components/operational-trust-client.test.tsx apicenter-management/src/components/app-shell.tsx apicenter-management/src/lib/schemas.ts apicenter-management/src/lib/api-center-client.ts api-center/docs/developer/operational-trust-runbook.md api-shared-services/docs/consumer-runbook.md api-center/docs/superpowers/plans/2026-05-25-apicenter-operational-trust-and-productization.md api-center/docs/superpowers/plans/README.md apicenter-management/docs/superpowers/plans/README.md
git commit -m "docs: complete operational trust productization plan"
```

---

## Execution Notes

- Implement Task 1 before Task 3 because promotion evidence should include drift status.
- Implement Task 2 before Task 4 because emergency controls need visible blast-radius context.
- Task 5 can run after Task 2 because marketplace impact depends on dependency visibility.
- Task 6 and Task 7 can run in parallel after Task 1 because forecasting and compliance use different service boundaries.
- Task 8 is the integration slice and should run last.

## Definition Of Done

- Operators can see governance drift between intended config and runtime state.
- Operators can inspect tribe, shared-service, Kafka, data, and provider dependencies.
- Operators can export a promotion evidence bundle for a service.
- Platform admins can apply and clear emergency controls with audit evidence.
- Tribes can browse APIs/shared services as marketplace products.
- Quota usage includes forecast and chargeback pressure.
- Deprecated APIs show impacted consumers and migration deadlines.
- Compliance exports include audit events and promotion evidence over a date range.
- Consumer scorecards flag stale SDKs, quota pressure, and error-rate risk.
- API Center, Management, and Shared Services pass focused tests, typecheck, lint, build, and contract checks.
