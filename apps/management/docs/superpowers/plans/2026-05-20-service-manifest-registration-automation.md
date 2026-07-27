# Service Manifest Registration Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build controlled automation for registering tribe-owned services so each microservice gets its own `serviceId`, maps to one owning `ownerTribeId`, and receives a generated APICenter runtime handoff without allowing unreviewed production self-registration.

**Architecture:** `apicenter-management` remains the operator control plane and first automation surface. `api-center` remains the source of truth for registry writes, access policy, service routing, and audit. Tribe repos own service manifest files and can validate or submit them, but production activation requires APICenter validation plus platform approval.

**Tech Stack:** Next.js 16, React 19, TypeScript, Zod, TanStack Query, Vitest, NestJS 11, class-validator, Prisma/Postgres, Jest, GitHub Actions, `@implementsprint/sdk`.

---

## Target Model

The automation must preserve the current APICenter ownership boundary:

```text
ownerTribeId / APICENTER_TRIBE_ID = tribe principal for visibility, token, secret, topic ownership
serviceId / APICENTER_SERVICE_ID = concrete backend or microservice identity for routing and attribution
```

For a microservice:

```json
{
  "serviceId": "logistics-orders",
  "ownerTribeId": "logistics",
  "serviceType": "tribe",
  "exposes": ["/orders", "/health"],
  "consumes": ["payment", "email"],
  "requiredScopes": ["orders:read", "orders:write"]
}
```

Generated runtime handoff:

```env
APICENTER_URL=https://api-center.itsandbox.site
APICENTER_TRIBE_ID=logistics
APICENTER_SERVICE_ID=logistics-orders
APICENTER_TRIBE_SECRET=<secret-for-logistics>
```

Generated event guidance:

```text
event topic = tribe.logistics.events
sourceServiceId = logistics-orders
```

Do not build a model where every microservice receives its own event topic or secret by default.

## Current Repo Anchors

`apicenter-management` already has:

- `src/components/manifest-tools-client.tsx` for paste/import registry manifests.
- `src/components/tribe-form.tsx` for manual create/edit registration.
- `src/lib/schemas.ts` with `serviceManifestSchema` and `ownerTribeId`.
- `src/lib/api-center-client.ts` with `registerService()`.
- `src/app/api/local/registry/register/route.ts` forwarding management writes to API Center.
- `src/lib/event-topics.ts` resolving tribe-owned event topic names.
- `src/lib/service-onboarding.ts` generating handoff packet content.

`api-center` already has:

- `src/shared/dto/service-manifest.dto.ts` with `ownerTribeId`.
- `src/registry/registry.controller.ts` exposing `/api/v1/registry/register`.
- `src/registry/registry.service.ts` with owned-service access helpers.
- `src/registry/postgres-registry-store.service.ts` persisting `ownerTribeId`.
- `prisma/schema.prisma` with `Service.ownerTribeId`.
- `supabase/migrations/20260519000000_add_owner_tribe_id.sql`.

`api-shared-services` already has:

- SDK `sourceServiceId` support.
- SDK `publishTribeEvent()` support.
- Consumer docs that explain `APICENTER_TRIBE_ID` and `APICENTER_SERVICE_ID`.

## Scope Decisions

- Production registration must be request based: validate, review, approve, then apply.
- Local/dev registration can remain direct after validation.
- Tribe repos can own manifests and run validators, but they should not write directly to production registry.
- SDK updates are optional and should be limited to validation helpers, manifest templates, and docs. The SDK must not become the production source of truth for registration.
- Existing records must remain routable while ownership is migrated from service-centric to tribe-centric metadata.

## Phase 1: Add A Canonical Registration Policy In Management

**Purpose:** Make `apicenter-management` compute a clear plan before registering or updating any service.

**Files:**

- Create: `src/lib/service-registration-policy.ts`
- Create: `src/lib/service-registration-policy.test.ts`
- Modify: `src/lib/schemas.ts`

### Task 1: Define Registration Plan Types

**Files:**

- Modify: `src/lib/schemas.ts`
- Create: `src/lib/service-registration-policy.ts`

- [ ] **Step 1: Add plan result schemas**

Add these schemas near `serviceManifestSchema` in `src/lib/schemas.ts`:

```ts
export const registrationPlanSeveritySchema = z.enum([
  "info",
  "warning",
  "blocking",
]);

export const registrationPlanIssueSchema = z.object({
  severity: registrationPlanSeveritySchema,
  code: z.string(),
  serviceId: z.string().optional(),
  message: z.string(),
});

export const serviceRegistrationPlanItemSchema = z.object({
  serviceId: z.string(),
  ownerTribeId: z.string(),
  sourceServiceId: z.string(),
  eventTopic: z.string(),
  action: z.enum(["create", "update"]),
  manifest: serviceManifestSchema,
});

export const serviceRegistrationPlanSchema = z.object({
  canApply: z.boolean(),
  items: z.array(serviceRegistrationPlanItemSchema),
  issues: z.array(registrationPlanIssueSchema),
});
```

Export inferred types:

```ts
export type RegistrationPlanIssue = z.infer<
  typeof registrationPlanIssueSchema
>;
export type ServiceRegistrationPlanItem = z.infer<
  typeof serviceRegistrationPlanItemSchema
>;
export type ServiceRegistrationPlan = z.infer<
  typeof serviceRegistrationPlanSchema
>;
```

- [ ] **Step 2: Create the policy module**

Create `src/lib/service-registration-policy.ts`:

```ts
import {
  serviceManifestSchema,
  type RegistrationPlanIssue,
  type ServiceManifest,
  type ServiceRegistrationPlan,
  type ServiceRegistryEntry,
} from "@/lib/schemas";
import { getServiceEventTopics } from "@/lib/event-topics";

export type RegistrationMode = "local-direct" | "production-request";

export function buildServiceRegistrationPlan(input: {
  manifests: ServiceManifest[];
  existingServices: ServiceRegistryEntry[];
  mode: RegistrationMode;
}): ServiceRegistrationPlan {
  const manifests = input.manifests.map((manifest) =>
    serviceManifestSchema.parse(manifest),
  );
  const issues: RegistrationPlanIssue[] = [];
  const existingById = new Map(
    input.existingServices.map((service) => [service.serviceId, service]),
  );
  const batchById = new Map<string, ServiceManifest>();

  for (const manifest of manifests) {
    if (batchById.has(manifest.serviceId)) {
      issues.push({
        severity: "blocking",
        code: "duplicate-service-id",
        serviceId: manifest.serviceId,
        message: `Manifest batch contains duplicate serviceId '${manifest.serviceId}'.`,
      });
    }
    batchById.set(manifest.serviceId, manifest);
  }

  const items = manifests.map((manifest) => {
    const ownerTribeId = resolveOwnerTribeId(manifest);
    validateOwnerTribe(manifest, ownerTribeId, existingById, batchById, issues);
    validateConsumes(manifest, existingById, batchById, input.mode, issues);
    validateOperationalHints(manifest, ownerTribeId, issues);

    return {
      serviceId: manifest.serviceId,
      ownerTribeId,
      sourceServiceId: manifest.serviceId,
      eventTopic: getServiceEventTopics({
        serviceId: manifest.serviceId,
        ownerTribeId,
        serviceType: manifest.serviceType,
      }).primary,
      action: existingById.has(manifest.serviceId) ? "update" : "create",
      manifest,
    };
  });

  return {
    canApply: issues.every((issue) => issue.severity !== "blocking"),
    items,
    issues,
  };
}

function resolveOwnerTribeId(manifest: ServiceManifest) {
  if ((manifest.serviceType ?? "tribe") === "shared") {
    return manifest.ownerTribeId ?? manifest.serviceId;
  }
  return manifest.ownerTribeId ?? manifest.serviceId;
}

function validateOwnerTribe(
  manifest: ServiceManifest,
  ownerTribeId: string,
  existingById: Map<string, ServiceRegistryEntry>,
  batchById: Map<string, ServiceManifest>,
  issues: RegistrationPlanIssue[],
) {
  if ((manifest.serviceType ?? "tribe") === "shared") return;
  if (ownerTribeId === manifest.serviceId) return;

  const existingOwner = existingById.get(ownerTribeId);
  const batchOwner = batchById.get(ownerTribeId);
  const ownerExists =
    Boolean(existingOwner && (existingOwner.serviceType ?? "tribe") !== "shared") ||
    batchOwner?.serviceType === "tribe";

  if (!ownerExists) {
    issues.push({
      severity: "blocking",
      code: "owner-tribe-missing",
      serviceId: manifest.serviceId,
      message: `Owner tribe '${ownerTribeId}' must exist before '${manifest.serviceId}' can be registered as its microservice.`,
    });
  }
}

function validateConsumes(
  manifest: ServiceManifest,
  existingById: Map<string, ServiceRegistryEntry>,
  batchById: Map<string, ServiceManifest>,
  mode: RegistrationMode,
  issues: RegistrationPlanIssue[],
) {
  for (const dependency of manifest.consumes) {
    const exists = existingById.has(dependency) || batchById.has(dependency);
    if (!exists) {
      issues.push({
        severity: mode === "production-request" ? "blocking" : "warning",
        code: "unknown-consumed-service",
        serviceId: manifest.serviceId,
        message: `'${manifest.serviceId}' consumes '${dependency}', but that service is not registered in APICenter yet.`,
      });
    }
  }
}

function validateOperationalHints(
  manifest: ServiceManifest,
  ownerTribeId: string,
  issues: RegistrationPlanIssue[],
) {
  if (!manifest.exposes.includes("/health") && manifest.healthCheck !== "/health") {
    issues.push({
      severity: "warning",
      code: "missing-health-route",
      serviceId: manifest.serviceId,
      message: `'${manifest.serviceId}' should expose or configure /health for contract checks.`,
    });
  }

  if (manifest.ownerTribeId && ownerTribeId !== manifest.serviceId) {
    issues.push({
      severity: "info",
      code: "microservice-attribution",
      serviceId: manifest.serviceId,
      message: `Use APICENTER_TRIBE_ID='${ownerTribeId}' and APICENTER_SERVICE_ID='${manifest.serviceId}'.`,
    });
  }
}
```

- [ ] **Step 3: Write focused policy tests**

Create `src/lib/service-registration-policy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildServiceRegistrationPlan } from "@/lib/service-registration-policy";
import type { ServiceManifest, ServiceRegistryEntry } from "@/lib/schemas";

function manifest(overrides: Partial<ServiceManifest> = {}): ServiceManifest {
  return {
    serviceId: "logistics",
    name: "Logistics",
    baseUrl: "https://logistics.example.test",
    requiredScopes: ["logistics:read"],
    exposes: ["/health"],
    consumes: [],
    serviceType: "tribe",
    version: "1.0.0",
    tags: [],
    serviceTier: "standard",
    ...overrides,
  };
}

function registry(overrides: Partial<ServiceRegistryEntry> = {}): ServiceRegistryEntry {
  return {
    ...manifest(),
    registeredAt: "2026-05-20T00:00:00.000Z",
    updatedAt: "2026-05-20T00:00:00.000Z",
    status: "active",
    ...overrides,
  };
}

describe("buildServiceRegistrationPlan", () => {
  it("maps microservices to owner tribe topics and service attribution", () => {
    const plan = buildServiceRegistrationPlan({
      mode: "production-request",
      existingServices: [registry({ serviceId: "logistics" })],
      manifests: [
        manifest({
          serviceId: "logistics-orders",
          ownerTribeId: "logistics",
          name: "Logistics Orders",
          baseUrl: "https://orders.example.test",
          requiredScopes: ["orders:read"],
          exposes: ["/orders", "/health"],
          consumes: [],
        }),
      ],
    });

    expect(plan.canApply).toBe(true);
    expect(plan.items[0]).toMatchObject({
      serviceId: "logistics-orders",
      ownerTribeId: "logistics",
      sourceServiceId: "logistics-orders",
      eventTopic: "tribe.logistics.events",
      action: "create",
    });
  });

  it("blocks production registration when owner tribe is missing", () => {
    const plan = buildServiceRegistrationPlan({
      mode: "production-request",
      existingServices: [],
      manifests: [
        manifest({
          serviceId: "logistics-orders",
          ownerTribeId: "logistics",
        }),
      ],
    });

    expect(plan.canApply).toBe(false);
    expect(plan.issues).toContainEqual(
      expect.objectContaining({
        code: "owner-tribe-missing",
        severity: "blocking",
        serviceId: "logistics-orders",
      }),
    );
  });

  it("blocks duplicate service IDs in one batch", () => {
    const plan = buildServiceRegistrationPlan({
      mode: "production-request",
      existingServices: [],
      manifests: [manifest(), manifest()],
    });

    expect(plan.canApply).toBe(false);
    expect(plan.issues).toContainEqual(
      expect.objectContaining({ code: "duplicate-service-id" }),
    );
  });

  it("warns for unknown consumes in local mode and blocks them in production mode", () => {
    const localPlan = buildServiceRegistrationPlan({
      mode: "local-direct",
      existingServices: [],
      manifests: [manifest({ consumes: ["payment"] })],
    });
    const productionPlan = buildServiceRegistrationPlan({
      mode: "production-request",
      existingServices: [],
      manifests: [manifest({ consumes: ["payment"] })],
    });

    expect(localPlan.canApply).toBe(true);
    expect(localPlan.issues).toContainEqual(
      expect.objectContaining({
        code: "unknown-consumed-service",
        severity: "warning",
      }),
    );
    expect(productionPlan.canApply).toBe(false);
    expect(productionPlan.issues).toContainEqual(
      expect.objectContaining({
        code: "unknown-consumed-service",
        severity: "blocking",
      }),
    );
  });
});
```

- [ ] **Step 4: Run policy tests**

Run:

```powershell
npm test -- src/lib/service-registration-policy.test.ts
```

Expected:

```text
4 tests passed
```

- [ ] **Step 5: Commit phase 1**

```powershell
git add src/lib/schemas.ts src/lib/service-registration-policy.ts src/lib/service-registration-policy.test.ts
git commit -m "feat(management): add service registration policy planner"
```

## Phase 2: Upgrade Manifest Tools Into A Safe Import Workflow

**Purpose:** Let operators paste a service manifest, see exact create/update effects, see tribe ownership and handoff values, and apply only when the plan has no blocking issues.

**Files:**

- Modify: `src/components/manifest-tools-client.tsx`
- Create: `src/components/manifest-tools-client.test.tsx`
- Modify: `src/lib/query-keys.ts`

### Task 2: Replace Basic Dry Run With Policy Plan

- [ ] **Step 1: Import the policy helper**

In `src/components/manifest-tools-client.tsx`, add:

```ts
import { buildServiceRegistrationPlan } from "@/lib/service-registration-policy";
```

- [ ] **Step 2: Change dry-run state type**

Replace the local `DryRunResult` state with:

```ts
const [plan, setPlan] = useState<ServiceRegistrationPlan | null>(null);
```

Import the type:

```ts
import type { ServiceRegistrationPlan } from "@/lib/schemas";
```

- [ ] **Step 3: Build the plan during validation**

Update `validateInput()`:

```ts
function validateInput() {
  try {
    const manifests = parseManifestInput(input);
    setPlan(
      buildServiceRegistrationPlan({
        manifests,
        existingServices: servicesQuery.data ?? [],
        mode: "local-direct",
      }),
    );
    setResult("");
    toast.success("Registration plan ready");
  } catch (error) {
    setPlan(null);
    setResult(error instanceof Error ? error.message : "Validation failed");
    toast.error("Dry run failed");
  }
}
```

- [ ] **Step 4: Block imports when the plan is blocking**

Change the import button to:

```tsx
<Button
  onClick={() => importMutation.mutate()}
  disabled={!plan?.canApply || importMutation.isPending}
>
  Import manifests
</Button>
```

- [ ] **Step 5: Display plan rows**

Replace `DryRunPanel` with `RegistrationPlanPanel` that shows:

```tsx
function RegistrationPlanPanel({ plan }: { plan: ServiceRegistrationPlan }) {
  return (
    <Alert variant={plan.canApply ? "default" : "destructive"}>
      <AlertTitle>
        {plan.canApply ? "Registration plan is applicable" : "Registration plan is blocked"}
      </AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <div className="grid gap-2">
          {plan.items.map((item) => (
            <div key={item.serviceId} className="rounded-md border bg-background p-3">
              <div className="font-medium">
                {item.action}: {item.serviceId}
              </div>
              <div className="font-mono text-xs text-muted-foreground">
                APICENTER_TRIBE_ID={item.ownerTribeId}
              </div>
              <div className="font-mono text-xs text-muted-foreground">
                APICENTER_SERVICE_ID={item.sourceServiceId}
              </div>
              <div className="font-mono text-xs text-muted-foreground">
                topic={item.eventTopic}
              </div>
            </div>
          ))}
        </div>
        {plan.issues.length ? (
          <div className="grid gap-2">
            {plan.issues.map((issue) => (
              <div key={`${issue.code}:${issue.serviceId ?? "global"}:${issue.message}`}>
                <span className="font-medium">{issue.severity}</span>: {issue.message}
              </div>
            ))}
          </div>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
```

- [ ] **Step 6: Add component tests**

Create `src/components/manifest-tools-client.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ManifestToolsClient } from "@/components/manifest-tools-client";
import * as apiClient from "@/lib/api-center-client";

vi.mock("@/lib/api-center-client", () => ({
  listServices: vi.fn(),
  registerService: vi.fn(),
}));

function renderWithClient() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ManifestToolsClient />
    </QueryClientProvider>,
  );
}

describe("ManifestToolsClient", () => {
  it("shows owner tribe handoff and event topic for a microservice import", async () => {
    vi.mocked(apiClient.listServices).mockResolvedValue([
      {
        serviceId: "logistics",
        ownerTribeId: "logistics",
        name: "Logistics",
        baseUrl: "https://logistics.example.test",
        requiredScopes: ["logistics:read"],
        exposes: ["/health"],
        consumes: [],
        serviceType: "tribe",
        version: "1.0.0",
        tags: [],
        serviceTier: "standard",
        registeredAt: "2026-05-20T00:00:00.000Z",
        updatedAt: "2026-05-20T00:00:00.000Z",
        status: "active",
      },
    ]);

    renderWithClient();

    const textarea = await screen.findByPlaceholderText(/serviceId/i);
    await userEvent.type(
      textarea,
      JSON.stringify({
        serviceId: "logistics-orders",
        ownerTribeId: "logistics",
        name: "Logistics Orders",
        baseUrl: "https://orders.example.test",
        requiredScopes: ["orders:read"],
        exposes: ["/orders", "/health"],
        consumes: [],
        serviceType: "tribe",
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: /validate/i }));

    expect(await screen.findByText(/Registration plan is applicable/i)).toBeInTheDocument();
    expect(screen.getByText("APICENTER_TRIBE_ID=logistics")).toBeInTheDocument();
    expect(screen.getByText("APICENTER_SERVICE_ID=logistics-orders")).toBeInTheDocument();
    expect(screen.getByText("topic=tribe.logistics.events")).toBeInTheDocument();
  });

  it("blocks import when the owner tribe is missing", async () => {
    vi.mocked(apiClient.listServices).mockResolvedValue([]);
    renderWithClient();

    const textarea = await screen.findByPlaceholderText(/serviceId/i);
    await userEvent.type(
      textarea,
      JSON.stringify({
        serviceId: "logistics-orders",
        ownerTribeId: "logistics",
        name: "Logistics Orders",
        baseUrl: "https://orders.example.test",
        requiredScopes: ["orders:read"],
        exposes: ["/orders", "/health"],
        consumes: [],
        serviceType: "tribe",
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: /validate/i }));

    expect(await screen.findByText(/Registration plan is blocked/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /import manifests/i })).toBeDisabled(),
    );
  });
});
```

- [ ] **Step 7: Run component tests**

```powershell
npm test -- src/components/manifest-tools-client.test.tsx src/lib/service-registration-policy.test.ts
```

Expected:

```text
6 tests passed
```

- [ ] **Step 8: Commit phase 2**

```powershell
git add src/components/manifest-tools-client.tsx src/components/manifest-tools-client.test.tsx src/lib/query-keys.ts
git commit -m "feat(management): show safe service registration plans"
```

## Phase 3: Harden API Center Registry Enforcement

**Purpose:** Management validation is not enough. API Center must enforce the same ownership model for direct admin calls and must return `ownerTribeId` consistently.

**Files:**

- Modify: `api-center/src/registry/registry.controller.ts`
- Modify: `api-center/src/registry/registry.service.ts`
- Modify: `api-center/src/registry/registry.service.spec.ts`
- Modify: `api-center/src/shared/dto/service-manifest.dto.spec.ts`

### Task 3: Return `ownerTribeId` From Registry List

- [ ] **Step 1: Add a failing controller test**

In `api-center/src/registry/registry.controller.spec.ts`, add a test that `listServices()` includes `ownerTribeId`:

```ts
it("returns ownerTribeId in service list responses", () => {
  handler.listServices.mockReturnValue([
    {
      serviceId: "logistics-orders",
      ownerTribeId: "logistics",
      name: "Logistics Orders",
      baseUrl: "https://orders.example.test",
      status: "active",
      serviceType: "tribe",
      exposes: ["/orders"],
      requiredScopes: ["orders:read"],
      consumes: [],
      version: "1.0.0",
      registeredAt: "2026-05-20T00:00:00.000Z",
      updatedAt: "2026-05-20T00:00:00.000Z",
    },
  ]);

  const result = controller.listServices();

  expect(result.data[0]).toMatchObject({
    serviceId: "logistics-orders",
    ownerTribeId: "logistics",
  });
});
```

- [ ] **Step 2: Run the controller test and verify it fails**

```powershell
npm test -- registry/registry.controller.spec.ts
```

Expected before implementation:

```text
FAIL ownerTribeId missing from list response
```

- [ ] **Step 3: Add ownerTribeId to list response**

In `api-center/src/registry/registry.controller.ts`, add:

```ts
ownerTribeId: svc.ownerTribeId,
```

inside the object returned by `listServices()`.

- [ ] **Step 4: Add server-side ownership validation**

In `api-center/src/registry/registry.service.ts`, call a new validator near the start of `register()` after checking `existing`:

```ts
this.validateOwnerTribeRegistration(manifest);
```

Add this helper:

```ts
private validateOwnerTribeRegistration(manifest: ServiceManifest): void {
  if ((manifest.serviceType ?? "tribe") === "shared") return;

  const ownerTribeId = manifest.ownerTribeId ?? manifest.serviceId;
  if (ownerTribeId === manifest.serviceId) return;

  const owner = this.services[ownerTribeId];
  if (!owner || (owner.serviceType ?? "tribe") !== "tribe") {
    throw new ValidationError(
      `Owner tribe '${ownerTribeId}' must be registered before service '${manifest.serviceId}' can be registered`,
    );
  }
}
```

- [ ] **Step 5: Add registry service tests**

In `api-center/src/registry/registry.service.spec.ts`, add:

```ts
it("rejects microservice registration when ownerTribeId is missing from registry", async () => {
  await expect(
    service.register(
      baseManifest({
        serviceId: "logistics-orders",
        ownerTribeId: "logistics",
        name: "Logistics Orders",
      }),
    ),
  ).rejects.toThrow("Owner tribe 'logistics' must be registered");
});

it("accepts microservice registration after owner tribe exists", async () => {
  await service.register(
    baseManifest({
      serviceId: "logistics",
      ownerTribeId: "logistics",
      name: "Logistics",
    }),
  );

  const entry = await service.register(
    baseManifest({
      serviceId: "logistics-orders",
      ownerTribeId: "logistics",
      name: "Logistics Orders",
    }),
  );

  expect(entry).toMatchObject({
    serviceId: "logistics-orders",
    ownerTribeId: "logistics",
  });
});
```

- [ ] **Step 6: Run gateway tests**

```powershell
npm test -- registry/registry.controller.spec.ts registry/registry.service.spec.ts shared/dto/service-manifest.dto.spec.ts
```

Expected:

```text
all selected suites passed
```

- [ ] **Step 7: Commit phase 3**

```powershell
git add src/registry/registry.controller.ts src/registry/registry.controller.spec.ts src/registry/registry.service.ts src/registry/registry.service.spec.ts src/shared/dto/service-manifest.dto.spec.ts
git commit -m "feat(api-center): enforce owner tribe service registration"
```

## Phase 4: Add Production Registration Requests

**Purpose:** Move production automation from direct import to a controlled request queue with approval, audit, and explicit apply.

**Files:**

- Modify: `api-center/prisma/schema.prisma`
- Create: `api-center/supabase/migrations/20260520000000_add_service_registration_requests.sql`
- Create: `api-center/src/registry/registration-request.dto.ts`
- Create: `api-center/src/registry/registration-requests.service.ts`
- Create: `api-center/src/registry/registration-requests.controller.ts`
- Create: `api-center/src/registry/registration-requests.service.spec.ts`
- Modify: `api-center/src/registry/registry.module.ts`
- Modify: `apicenter-management/src/lib/schemas.ts`
- Modify: `apicenter-management/src/lib/api-center-client.ts`
- Create: `apicenter-management/src/app/api/local/registry/registration-requests/route.ts`
- Create: `apicenter-management/src/app/api/local/registry/registration-requests/[requestId]/approve/route.ts`
- Create: `apicenter-management/src/app/api/local/registry/registration-requests/[requestId]/reject/route.ts`
- Create: `apicenter-management/src/app/registration-requests/page.tsx`
- Create: `apicenter-management/src/components/registration-requests-client.tsx`
- Create: `apicenter-management/src/components/registration-requests-client.test.tsx`

### Task 4: Add Request Persistence In API Center

- [ ] **Step 1: Add Prisma model**

Add to `api-center/prisma/schema.prisma`:

```prisma
model ServiceRegistrationRequest {
  id               String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  serviceId        String   @map("service_id")
  ownerTribeId     String   @map("owner_tribe_id")
  status           String   @default("pending")
  manifest         Json
  validationReport Json     @default("{}") @map("validation_report")
  requestedBy      String?  @map("requested_by")
  approvedBy       String?  @map("approved_by")
  rejectedBy       String?  @map("rejected_by")
  rejectionReason  String?  @map("rejection_reason")
  appliedServiceId String?  @map("applied_service_id")
  createdAt        DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt        DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)
  decidedAt        DateTime? @map("decided_at") @db.Timestamptz(6)
  appliedAt        DateTime? @map("applied_at") @db.Timestamptz(6)

  @@index([status, createdAt], name: "service_registration_requests_status_created_idx")
  @@index([serviceId], name: "service_registration_requests_service_idx")
  @@index([ownerTribeId], name: "service_registration_requests_owner_idx")
  @@map("service_registration_requests")
  @@schema("api_center_ops")
}
```

- [ ] **Step 2: Add SQL migration**

Create `api-center/supabase/migrations/20260520000000_add_service_registration_requests.sql`:

```sql
create table if not exists api_center_ops.service_registration_requests (
  id uuid primary key default gen_random_uuid(),
  service_id text not null,
  owner_tribe_id text not null,
  status text not null default 'pending',
  manifest jsonb not null,
  validation_report jsonb not null default '{}'::jsonb,
  requested_by text,
  approved_by text,
  rejected_by text,
  rejection_reason text,
  applied_service_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz,
  applied_at timestamptz
);

create index if not exists service_registration_requests_status_created_idx
  on api_center_ops.service_registration_requests (status, created_at desc);

create index if not exists service_registration_requests_service_idx
  on api_center_ops.service_registration_requests (service_id);

create index if not exists service_registration_requests_owner_idx
  on api_center_ops.service_registration_requests (owner_tribe_id);

alter table api_center_ops.service_registration_requests
  add constraint service_registration_requests_status_check
  check (status in ('pending', 'approved', 'rejected', 'applied'));
```

- [ ] **Step 3: Add request DTOs**

Create `api-center/src/registry/registration-request.dto.ts`:

```ts
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsObject, IsOptional, IsString, Matches, MaxLength } from "class-validator";
import { ServiceManifestDto } from "../shared/dto/service-manifest.dto";

export class CreateRegistrationRequestDto {
  @ApiProperty({ type: ServiceManifestDto })
  @IsObject()
  manifest!: ServiceManifestDto;

  @ApiPropertyOptional({ example: "github:logistics/orders-api/.github/workflows/register.yml" })
  @IsString()
  @MaxLength(256)
  @IsOptional()
  requestedBy?: string;
}

export class RejectRegistrationRequestDto {
  @ApiProperty({ example: "Consumes list references an unapproved production service." })
  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class RegistrationRequestIdDto {
  @Matches(/^[0-9a-fA-F-]{36}$/)
  requestId!: string;
}
```

- [ ] **Step 4: Implement request service**

Create `api-center/src/registry/registration-requests.service.ts` with methods:

```ts
createRequest(input: { manifest: ServiceManifestDto; requestedBy?: string })
listRequests(status?: string)
approveRequest(requestId: string, approvedBy: string)
rejectRequest(requestId: string, rejectedBy: string, reason: string)
```

`approveRequest()` must call `RegistryService.register()` and then mark the request `applied`.

- [ ] **Step 5: Implement request controller**

Create `api-center/src/registry/registration-requests.controller.ts`:

```ts
@Controller("registry/registration-requests")
@UseGuards(ScopedAdminGuard)
export class RegistrationRequestsController {
  constructor(private readonly requests: RegistrationRequestsService) {}

  @Post()
  create(@Body() dto: CreateRegistrationRequestDto) {
    return this.requests.createRequest(dto);
  }

  @Get()
  list(@Query("status") status?: string) {
    return this.requests.listRequests(status);
  }

  @Post(":requestId/approve")
  approve(@Param("requestId") requestId: string, @Req() req: AuthenticatedRequest) {
    return this.requests.approveRequest(requestId, req.user?.sub ?? "platform-admin");
  }

  @Post(":requestId/reject")
  reject(
    @Param("requestId") requestId: string,
    @Body() dto: RejectRegistrationRequestDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.requests.rejectRequest(requestId, req.user?.sub ?? "platform-admin", dto.reason);
  }
}
```

- [ ] **Step 6: Test request lifecycle**

Create `api-center/src/registry/registration-requests.service.spec.ts` covering:

- pending request creation stores `serviceId`, `ownerTribeId`, manifest, and validation report.
- approval calls `RegistryService.register()` once.
- rejection records reason and does not call `register()`.
- approving a non-pending request fails.

Run:

```powershell
npm test -- registry/registration-requests.service.spec.ts
```

Expected:

```text
4 tests passed
```

- [ ] **Step 7: Wire request module and run API Center gates**

```powershell
npm run typecheck
npm test -- registry/registration-requests.service.spec.ts registry/registry.controller.spec.ts registry/registry.service.spec.ts
npm run build
```

Expected:

```text
typecheck passes
selected Jest suites pass
build exits 0
```

- [ ] **Step 8: Commit API Center request API**

```powershell
git add prisma/schema.prisma supabase/migrations/20260520000000_add_service_registration_requests.sql src/registry
git commit -m "feat(api-center): add service registration request approvals"
```

### Task 5: Add Management Request Queue UI

- [ ] **Step 1: Add schemas and client methods**

In `apicenter-management/src/lib/schemas.ts`, add response schemas for request list, create, approve, and reject.

In `apicenter-management/src/lib/api-center-client.ts`, add:

```ts
export async function createRegistrationRequest(input: ServiceManifest) { ... }
export async function listRegistrationRequests(status?: string) { ... }
export async function approveRegistrationRequest(requestId: string) { ... }
export async function rejectRegistrationRequest(requestId: string, reason: string) { ... }
```

- [ ] **Step 2: Add local proxy routes**

Create management proxy routes:

```text
src/app/api/local/registry/registration-requests/route.ts
src/app/api/local/registry/registration-requests/[requestId]/approve/route.ts
src/app/api/local/registry/registration-requests/[requestId]/reject/route.ts
```

Each route must call `requireManagementRouteAction()` with `state-write` for create/approve/reject and forward to the API Center endpoint through `apiCenterAdminRequest()`.

- [ ] **Step 3: Add request queue page**

Create `src/app/registration-requests/page.tsx`:

```tsx
import { PageHeading } from "@/components/page-heading";
import { RegistrationRequestsClient } from "@/components/registration-requests-client";

export default function RegistrationRequestsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Registration requests"
        description="Review manifest submissions before they become active APICenter registry entries."
      />
      <RegistrationRequestsClient />
    </div>
  );
}
```

- [ ] **Step 4: Add approval UI tests**

Create `src/components/registration-requests-client.test.tsx` covering:

- pending request shows service ID, owner tribe ID, action buttons, and generated env.
- approve button calls `approveRegistrationRequest()`.
- reject requires a reason.

Run:

```powershell
npm test -- src/components/registration-requests-client.test.tsx
```

Expected:

```text
3 tests passed
```

- [ ] **Step 5: Commit management request UI**

```powershell
git add src/app/registration-requests src/app/api/local/registry/registration-requests src/components/registration-requests-client.tsx src/components/registration-requests-client.test.tsx src/lib/api-center-client.ts src/lib/schemas.ts
git commit -m "feat(management): add registration request approval queue"
```

## Phase 5: Add Tribe Repo Validation Helper

**Purpose:** Give tribes a way to validate their manifest before submitting it, without allowing the SDK to become a production registry writer.

**Files:**

- Create: `api-shared-services/docs/service-manifest-automation.md`
- Create: `api-shared-services/templates/service-manifest.json`
- Optional create: `api-shared-services/src/manifest.ts`
- Optional create: `api-shared-services/tests/manifest.test.ts`
- Optional modify: `api-shared-services/package.json`
- Optional create: `api-shared-services/bin/apicenter-validate-manifest.mjs`

### Task 6: Document The Tribe-Side Manifest Contract

- [ ] **Step 1: Add template**

Create `api-shared-services/templates/service-manifest.json`:

```json
{
  "serviceId": "logistics-orders",
  "ownerTribeId": "logistics",
  "serviceType": "tribe",
  "name": "Logistics Orders API",
  "baseUrl": "https://orders.logistics.itsandbox.site",
  "requiredScopes": ["orders:read", "orders:write"],
  "exposes": ["/orders", "/orders/:id", "/health"],
  "consumes": ["payment", "email"],
  "healthCheck": "/health",
  "version": "1.0.0",
  "ownerTeam": "logistics",
  "contact": "logistics-platform@example.com",
  "serviceTier": "standard",
  "tags": ["orders", "logistics"]
}
```

- [ ] **Step 2: Add docs**

Create `api-shared-services/docs/service-manifest-automation.md` explaining:

- `serviceId` is assigned/approved through APICenter.
- `ownerTribeId` is the tribe principal.
- `APICENTER_TRIBE_ID` uses `ownerTribeId`.
- `APICENTER_SERVICE_ID` uses `serviceId`.
- events use `publishTribeEvent()` and `sourceServiceId`.
- production submission goes through APICenter registration requests.
- dev/local can be manually imported through `apicenter-management`.

- [ ] **Step 3: Link docs**

Add links from:

```text
api-shared-services/README.md
api-shared-services/docs/consumer-runbook.md
api-shared-services/docs/tribe-sdk-consumption.md
```

- [ ] **Step 4: Run docs checks**

```powershell
rg -n "APICENTER_SERVICE_ID|ownerTribeId|publishTribeEvent|service-manifest" README.md docs templates
```

Expected:

```text
all new docs and template anchors are discoverable
```

- [ ] **Step 5: Commit docs helper**

```powershell
git add README.md docs/consumer-runbook.md docs/tribe-sdk-consumption.md docs/service-manifest-automation.md templates/service-manifest.json
git commit -m "docs(sdk): add service manifest automation guide"
```

### Task 7: Optional SDK CLI Validator

Only implement this after the management request path is stable.

- [ ] **Step 1: Add manifest validator export**

Create `api-shared-services/src/manifest.ts` with a small Zod schema matching the gateway manifest contract.

- [ ] **Step 2: Add CLI**

Create `api-shared-services/bin/apicenter-validate-manifest.mjs`:

```js
#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { validateServiceManifest } from "../dist/manifest.js";

const file = process.argv[2] ?? "apicenter.service.json";
const raw = readFileSync(file, "utf8");
const parsed = JSON.parse(raw);
const result = validateServiceManifest(parsed);

if (!result.success) {
  console.error(JSON.stringify(result.error.format(), null, 2));
  process.exit(1);
}

console.log(`Manifest valid: ${result.data.serviceId}`);
```

- [ ] **Step 3: Add package bin**

In `api-shared-services/package.json`:

```json
"bin": {
  "apicenter-validate-manifest": "./bin/apicenter-validate-manifest.mjs"
}
```

- [ ] **Step 4: Add tests and build check**

```powershell
npm test -- tests/manifest.test.ts
npm run build
node .\bin\apicenter-validate-manifest.mjs .\templates\service-manifest.json
```

Expected:

```text
manifest tests pass
build exits 0
Manifest valid: logistics-orders
```

## Phase 6: Add CI Submission Automation

**Purpose:** Let tribe repos validate manifests in CI and submit a registration request, without direct production activation.

**Files:**

- Create: `api-shared-services/docs/github-actions-registration-request.md`
- Optional create in a tribe template repo: `.github/workflows/apicenter-registration.yml`

### Task 8: Document GitHub Actions Request Flow

- [ ] **Step 1: Add workflow example**

Create `api-shared-services/docs/github-actions-registration-request.md`:

```yaml
name: APICenter registration request

on:
  workflow_dispatch:
  pull_request:
    paths:
      - apicenter.service.json

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
          registry-url: https://npm.pkg.github.com
          scope: "@implementsprint"
      - run: npm ci
      - run: npx apicenter-validate-manifest apicenter.service.json

  submit:
    if: github.event_name == 'workflow_dispatch'
    needs: validate
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: |
          curl -sS -X POST "$APICENTER_MANAGEMENT_URL/api/local/registry/registration-requests" \
            -H "authorization: Bearer $APICENTER_MANAGEMENT_TOKEN" \
            -H "content-type: application/json" \
            --data "{\"manifest\":$(cat apicenter.service.json),\"requestedBy\":\"github:${GITHUB_REPOSITORY}:${GITHUB_SHA}\"}"
        env:
          APICENTER_MANAGEMENT_URL: ${{ secrets.APICENTER_MANAGEMENT_URL }}
          APICENTER_MANAGEMENT_TOKEN: ${{ secrets.APICENTER_MANAGEMENT_TOKEN }}
```

- [ ] **Step 2: Explain secrets**

Document:

```text
APICENTER_MANAGEMENT_URL = management console base URL
APICENTER_MANAGEMENT_TOKEN = scoped token allowed to create registration requests only
```

Do not use the runtime `APICENTER_TRIBE_SECRET` for registration request submission.

- [ ] **Step 3: Commit CI docs**

```powershell
git add docs/github-actions-registration-request.md
git commit -m "docs(sdk): add CI registration request workflow"
```

## Phase 7: Migrate Old Records To The New Model

**Purpose:** Convert service-centric entries into owner-tribe entries without breaking existing routing.

**Files:**

- Create: `apicenter-management/src/lib/owner-tribe-migration.ts`
- Create: `apicenter-management/src/lib/owner-tribe-migration.test.ts`
- Modify: `apicenter-management/src/components/manifest-tools-client.tsx`
- Modify: `apicenter-management/docs/operations/apicenter-management-runbook.md`

### Task 9: Add Migration Planner

- [ ] **Step 1: Create migration helper**

Create `src/lib/owner-tribe-migration.ts`:

```ts
import type { ServiceManifest, ServiceRegistryEntry } from "@/lib/schemas";

export function buildOwnerTribeMigration(input: {
  service: ServiceRegistryEntry;
  ownerTribeId: string;
}): ServiceManifest {
  return {
    serviceId: input.service.serviceId,
    ownerTribeId: input.ownerTribeId,
    serviceType: input.service.serviceType ?? "tribe",
    name: input.service.name,
    baseUrl: input.service.baseUrl,
    requiredScopes: input.service.requiredScopes,
    exposes: input.service.exposes,
    consumes: input.service.consumes,
    healthCheck: input.service.healthCheck,
    version: input.service.version ?? "1.0.0",
    description: input.service.description,
    tags: input.service.tags ?? [],
    ownerTeam: input.service.ownerTeam,
    contact: input.service.contact,
    serviceTier: input.service.serviceTier ?? "standard",
    costCenter: input.service.costCenter,
  };
}
```

- [ ] **Step 2: Add test**

Create `src/lib/owner-tribe-migration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildOwnerTribeMigration } from "@/lib/owner-tribe-migration";
import type { ServiceRegistryEntry } from "@/lib/schemas";

describe("buildOwnerTribeMigration", () => {
  it("keeps serviceId and routes while changing ownerTribeId", () => {
    const service: ServiceRegistryEntry = {
      serviceId: "logistics-orders",
      name: "Logistics Orders",
      baseUrl: "https://orders.example.test",
      requiredScopes: ["orders:read"],
      exposes: ["/orders", "/health"],
      consumes: ["payment"],
      serviceType: "tribe",
      version: "1.0.0",
      tags: [],
      serviceTier: "standard",
      registeredAt: "2026-05-20T00:00:00.000Z",
      updatedAt: "2026-05-20T00:00:00.000Z",
      status: "active",
    };

    expect(buildOwnerTribeMigration({ service, ownerTribeId: "logistics" }))
      .toMatchObject({
        serviceId: "logistics-orders",
        ownerTribeId: "logistics",
        exposes: ["/orders", "/health"],
        consumes: ["payment"],
      });
  });
});
```

- [ ] **Step 3: Add runbook migration steps**

Update `docs/operations/apicenter-management-runbook.md` with:

```text
Old:
serviceId=logistics-orders
ownerTribeId unset
topic=tribe.logistics-orders.events

New:
serviceId=logistics-orders
ownerTribeId=logistics
topic=tribe.logistics.events
sourceServiceId=logistics-orders
```

- [ ] **Step 4: Run migration tests**

```powershell
npm test -- src/lib/owner-tribe-migration.test.ts src/lib/service-registration-policy.test.ts
```

Expected:

```text
all selected tests passed
```

## Phase 8: Rollout And Verification

**Purpose:** Ship in a way that keeps current registry entries working and gives operators clear rollback points.

### Task 10: Run Local Gates

- [ ] **Step 1: Management gates**

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/lib/service-registration-policy.test.ts src/components/manifest-tools-client.test.tsx src/components/registration-requests-client.test.tsx src/lib/owner-tribe-migration.test.ts
npx tsc --noEmit
npm run build
```

Expected:

```text
selected Vitest tests pass
TypeScript exits 0
Next build exits 0
```

- [ ] **Step 2: API Center gates**

```powershell
cd C:\Codes\apic\api-center
npm run typecheck
npm test -- registry/registry.controller.spec.ts registry/registry.service.spec.ts registry/registration-requests.service.spec.ts shared/dto/service-manifest.dto.spec.ts
npm run build
```

Expected:

```text
typecheck passes
selected Jest suites pass
Nest build exits 0
```

- [ ] **Step 3: SDK docs/helper gates**

```powershell
cd C:\Codes\apic\api-shared-services
npm run typecheck
npm test
npm run build
```

Expected:

```text
typecheck passes
tests pass
build exits 0
```

### Task 11: Rollout Order

- [ ] **Step 1: Deploy API Center first**

Deploy API Center changes that return `ownerTribeId`, enforce owner registration, and expose registration requests.

- [ ] **Step 2: Deploy management second**

Deploy `apicenter-management` with policy planning and request UI after API Center endpoints are live.

- [ ] **Step 3: Publish SDK/docs only if CLI/helper changed**

If Phase 5 optional CLI is implemented, release the SDK using the one-click release workflow. If only docs changed, do not publish a package version.

- [ ] **Step 4: Test one non-production microservice**

Use:

```text
ownerTribeId=flow-ci
serviceId=flow-ci-api
```

Expected:

```text
management registration plan shows APICENTER_TRIBE_ID=flow-ci
management registration plan shows APICENTER_SERVICE_ID=flow-ci-api
topic resolves to tribe.flow-ci.events or the configured environment-prefixed physical topic
API Center can route /api/v1/tribes/flow-ci-api/*
publishTribeEvent() records sourceServiceId=flow-ci-api
```

- [ ] **Step 5: Test production request approval**

Create a registration request, approve it, then verify:

```text
registry entry exists
ownerTribeId is present
onboarding packet shows correct env vars
secret status is checked against the owner tribe ID
Confluent topic status checks tribe.<ownerTribeId>.events
audit log contains request create and approval
```

## Acceptance Criteria

- Operators can paste or import a manifest and see a registration plan before any registry write.
- The plan clearly shows `APICENTER_TRIBE_ID`, `APICENTER_SERVICE_ID`, and event topic.
- A microservice cannot be production-registered unless its owner tribe exists.
- Production registration can be requested automatically, but not applied without approval.
- API Center direct admin registration also enforces owner tribe existence.
- Existing single-service tribes still work with `serviceId === ownerTribeId`.
- Existing microservice records can be updated without changing their `serviceId`.
- Tribe-owned event topics remain `tribe.<ownerTribeId>.events`.
- Event attribution remains `sourceServiceId=<serviceId>`.
- SDK helper work, if implemented, validates manifests only and does not bypass APICenter approval.

## Rollback Plan

- If management import UI has issues, use the existing manual `TribeForm` create/edit page and API Center registry endpoints.
- If registration request API has issues, disable the request page in navigation and keep direct operator import for local/dev only.
- If owner enforcement blocks a valid production case, register the owner tribe first, then reapply the microservice manifest.
- If SDK CLI release has issues, leave package version unchanged and keep validation as documentation plus management dry-run.

## Final Production Policy

```text
dev/local: direct import allowed after validation
staging/test: direct import allowed for operators, request flow preferred
production: request flow required, approval required, audit required
```

The final operating rule is:

```text
APICenter owns registration truth.
apicenter-management owns approval and provisioning workflow.
Tribe repos own proposed manifests.
SDK helps validate and consume, but does not own production registration.
```
