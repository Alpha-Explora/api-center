# Tribe Multi-Environment Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a tribe register one stable service identity with multiple platform-governed environment records, each with its own URL, health check, secret, topic, quota/plan evidence, and lifecycle state.

**Architecture:** Keep `Service` as the stable identity keyed by `serviceId` and `ownerTribeId`, then add environment-scoped child records instead of faking services like `trinithrive-test`. API Center will accept `environments[]` on registration while preserving the current single-URL manifest path by converting it into a default `test` environment. Management will render an environment repeater using platform-approved environment keys and route provisioning/cleanup through environment-aware helpers.

**Tech Stack:** NestJS, Prisma/Postgres, Redis-backed registry cache, Next.js 16, React Hook Form, Zod, Vitest/Jest, GCP Secret Manager, Confluent Cloud REST APIs.

---

## File Structure

Backend source of truth:

- Modify: `api-center/prisma/schema.prisma`
- Create: `api-center/prisma/migrations/20260618000000_add_service_environments/migration.sql`
- Modify: `api-center/src/types/index.ts`
- Modify: `api-center/src/shared/dto/service-manifest.dto.ts`
- Modify: `api-center/src/registry/postgres-registry-store.service.ts`
- Modify: `api-center/src/registry/registry.service.ts`
- Modify: `api-center/src/registry/registry.controller.ts`
- Modify: `api-center/src/shared/proxy-handler.ts`
- Test: `api-center/src/registry/registry.controller.spec.ts`
- Test: `api-center/src/registry/postgres-registry-store.service.spec.ts`
- Test: `api-center/src/shared/proxy-handler.spec.ts`

Management app:

- Modify: `apicenter-management/src/lib/schemas.ts`
- Modify: `apicenter-management/src/lib/event-topics.ts`
- Modify: `apicenter-management/src/lib/api-center-client.ts`
- Modify: `apicenter-management/src/components/tribe-form.tsx`
- Modify: `apicenter-management/src/components/service-detail-client.tsx`
- Modify: `apicenter-management/src/components/tribe-deprovisioning-card.tsx`
- Test: `apicenter-management/src/lib/schemas.test.ts`
- Test: `apicenter-management/src/lib/event-topics.test.ts`
- Test: `apicenter-management/src/components/tribe-form.test.tsx`
- Test: `apicenter-management/src/components/tribe-deprovisioning-card.test.tsx`

Docs:

- Modify: `api-center/docs/developer/tribe-onboarding.md`
- Modify: `apicenter-management/docs/operations/apicenter-management-runbook.md`
- Modify: `api-center/docs/superpowers/plans/README.md`

---

## Definitions

Use these environment keys in the first release:

```ts
export const SERVICE_ENVIRONMENT_KEYS = [
  "test",
  "staging",
  "uat",
  "demo",
  "live",
] as const;
```

`live` remains the only environment that requires live-style approval and typed confirmation. `staging`, `uat`, and `demo` are non-live controlled environments.

Do not allow arbitrary environment keys in this implementation. Each environment row can still have a tribe-specific URL.

---

### Task 1: Add Backend Manifest Types And DTO Validation

**Files:**
- Modify: `api-center/src/types/index.ts`
- Modify: `api-center/src/shared/dto/service-manifest.dto.ts`
- Test: `api-center/src/registry/registry.controller.spec.ts`

- [ ] **Step 1: Write the failing controller test for multi-environment registration**

Add a test in `api-center/src/registry/registry.controller.spec.ts` that submits one service with two environments and asserts the registry receives both.

```ts
it("registers one service identity with multiple environment URLs", async () => {
  approvals.assertApprovedForAction.mockResolvedValue(undefined);
  registry.register.mockResolvedValue({
    serviceId: "trinithrive",
    name: "TriniThrive",
    baseUrl: "https://trinithrive-test.example.com",
    requiredScopes: ["service:read"],
    exposes: ["/health"],
    consumes: [],
    ownerTribeId: "trinithrive",
    serviceType: "tribe",
    environments: [
      {
        environment: "test",
        baseUrl: "https://trinithrive-test.example.com",
        healthCheck: "/health",
        status: "active",
      },
      {
        environment: "staging",
        baseUrl: "https://trinithrive-staging.example.com",
        healthCheck: "/health",
        status: "active",
      },
    ],
    registeredAt: "2026-06-18T00:00:00.000Z",
    updatedAt: "2026-06-18T00:00:00.000Z",
    status: "active",
  });

  await controller.register(
    {
      serviceId: "trinithrive",
      name: "TriniThrive",
      baseUrl: "https://trinithrive-test.example.com",
      requiredScopes: ["service:read"],
      exposes: ["/health"],
      ownerTribeId: "trinithrive",
      serviceType: "tribe",
      environments: [
        {
          environment: "test",
          baseUrl: "https://trinithrive-test.example.com",
          healthCheck: "/health",
        },
        {
          environment: "staging",
          baseUrl: "https://trinithrive-staging.example.com",
          healthCheck: "/health",
        },
      ],
    } as any,
    { correlationId: "corr-env" } as any,
  );

  expect(registry.register).toHaveBeenCalledWith(
    expect.objectContaining({
      serviceId: "trinithrive",
      ownerTribeId: "trinithrive",
      environments: [
        expect.objectContaining({
          environment: "test",
          baseUrl: "https://trinithrive-test.example.com",
        }),
        expect.objectContaining({
          environment: "staging",
          baseUrl: "https://trinithrive-staging.example.com",
        }),
      ],
    }),
  );
});
```

- [ ] **Step 2: Run the backend test and verify it fails**

Run:

```powershell
cd C:\Codes\apic\api-center
npm test -- src/registry/registry.controller.spec.ts
```

Expected: FAIL because `ServiceManifestDto` does not accept `environments` and `ServiceManifest` has no environment collection.

- [ ] **Step 3: Add the backend environment types**

In `api-center/src/types/index.ts`, add:

```ts
export type ServiceEnvironmentKey =
  | "test"
  | "staging"
  | "uat"
  | "demo"
  | "live";

export interface ServiceEnvironmentManifest {
  environment: ServiceEnvironmentKey;
  baseUrl: string;
  healthCheck?: string;
  status?: ServiceLifecycleStatus;
  healthy?: boolean;
  lastHealthCheckAt?: string;
}
```

Then extend `ServiceManifest`:

```ts
  environments?: ServiceEnvironmentManifest[];
```

And extend `ServiceRegistryEntry` with a required normalized collection:

```ts
  environments: ServiceEnvironmentManifest[];
```

- [ ] **Step 4: Add DTO validation for environment rows**

In `api-center/src/shared/dto/service-manifest.dto.ts`, import `ValidateNested` and `Type`:

```ts
import { Type } from "class-transformer";
import { ValidateNested } from "class-validator";
```

Add this class above `ServiceManifestDto`:

```ts
export class ServiceEnvironmentDto {
  @ApiProperty({ example: "test", enum: ["test", "staging", "uat", "demo", "live"] })
  @IsString()
  @IsIn(["test", "staging", "uat", "demo", "live"], {
    message: "environment must be one of test, staging, uat, demo, or live",
  })
  environment!: string;

  @ApiProperty({ example: "https://trinithrive-test.example.com" })
  @IsString()
  @IsUrl(
    {
      require_tld: false,
      require_protocol: true,
      protocols: ["http", "https"],
    },
    { message: "environment baseUrl must be a valid URL" },
  )
  baseUrl!: string;

  @ApiPropertyOptional({ example: "/health" })
  @IsString()
  @IsOptional()
  healthCheck?: string;
}
```

Add to `ServiceManifestDto`:

```ts
  @ApiPropertyOptional({ type: [ServiceEnvironmentDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ServiceEnvironmentDto)
  @IsOptional()
  environments?: ServiceEnvironmentDto[];
```

- [ ] **Step 5: Normalize environments in the controller**

In `api-center/src/registry/registry.controller.ts`, when constructing `manifest`, include:

```ts
      environments: normalizeManifestEnvironments(manifestDto),
```

Add this helper near the bottom of the file:

```ts
function normalizeManifestEnvironments(manifest: ServiceManifestDto) {
  if (manifest.environments?.length) {
    return manifest.environments.map((environment) => ({
      environment: environment.environment as any,
      baseUrl: environment.baseUrl,
      healthCheck: environment.healthCheck ?? manifest.healthCheck,
      status: "active" as const,
    }));
  }

  return [
    {
      environment: (manifest.targetEnvironment ?? "test") as any,
      baseUrl: manifest.baseUrl,
      healthCheck: manifest.healthCheck,
      status: "active" as const,
    },
  ];
}
```

- [ ] **Step 6: Run the backend test and verify it passes**

Run:

```powershell
cd C:\Codes\apic\api-center
npm test -- src/registry/registry.controller.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```powershell
git add src/types/index.ts src/shared/dto/service-manifest.dto.ts src/registry/registry.controller.ts src/registry/registry.controller.spec.ts
git commit -m "feat: accept environment-scoped service manifests"
```

---

### Task 2: Add Postgres ServiceEnvironment Persistence

**Files:**
- Modify: `api-center/prisma/schema.prisma`
- Create: `api-center/prisma/migrations/20260618000000_add_service_environments/migration.sql`
- Modify: `api-center/src/registry/postgres-registry-store.service.ts`
- Test: `api-center/src/registry/postgres-registry-store.service.spec.ts`

- [ ] **Step 1: Write the failing persistence test**

In `api-center/src/registry/postgres-registry-store.service.spec.ts`, add:

```ts
it("persists environment rows separately from service identity", async () => {
  const tx = createTransactionMock();
  prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));
  tx.organization.upsert.mockResolvedValue({ id: "org-1" });
  tx.service.upsert.mockResolvedValue({ id: "svc-1" });

  await service.upsert(
    entry({
      serviceId: "trinithrive",
      ownerTribeId: "trinithrive",
      baseUrl: "https://trinithrive-test.example.com",
      environments: [
        {
          environment: "test",
          baseUrl: "https://trinithrive-test.example.com",
          healthCheck: "/health",
          status: "active",
        },
        {
          environment: "staging",
          baseUrl: "https://trinithrive-staging.example.com",
          healthCheck: "/health",
          status: "active",
        },
      ],
    }),
  );

  expect(tx.serviceEnvironment.deleteMany).toHaveBeenCalledWith({
    where: { serviceId: "svc-1" },
  });
  expect(tx.serviceEnvironment.createMany).toHaveBeenCalledWith({
    data: [
      expect.objectContaining({
        serviceId: "svc-1",
        environment: "test",
        baseUrl: "https://trinithrive-test.example.com",
      }),
      expect.objectContaining({
        serviceId: "svc-1",
        environment: "staging",
        baseUrl: "https://trinithrive-staging.example.com",
      }),
    ],
  });
});
```

- [ ] **Step 2: Run the persistence test and verify it fails**

Run:

```powershell
cd C:\Codes\apic\api-center
npm test -- src/registry/postgres-registry-store.service.spec.ts
```

Expected: FAIL because `serviceEnvironment` does not exist on the Prisma mock/service.

- [ ] **Step 3: Add the Prisma model**

In `api-center/prisma/schema.prisma`, add this relation on `Service`:

```prisma
  environments       ServiceEnvironment[]
```

Add this model after `Service`:

```prisma
model ServiceEnvironment {
  id                String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  serviceId         String    @map("service_id") @db.Uuid
  environment       String
  baseUrl           String    @map("base_url")
  healthCheckPath   String?   @map("health_check_path")
  status            String    @default("active")
  healthy           Boolean?
  lastHealthCheckAt DateTime? @map("last_health_check_at") @db.Timestamptz(6)
  registeredAt      DateTime  @default(now()) @map("registered_at") @db.Timestamptz(6)
  updatedAt         DateTime  @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  service Service @relation(fields: [serviceId], references: [id], onDelete: Cascade)

  @@unique([serviceId, environment], name: "service_environment_unique")
  @@index([environment, status], name: "service_environments_env_status_idx")
  @@map("service_environments")
  @@schema("api_center")
}
```

- [ ] **Step 4: Add the migration SQL**

Create `api-center/prisma/migrations/20260618000000_add_service_environments/migration.sql`:

```sql
CREATE TABLE api_center.service_environments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES api_center.services(id) ON DELETE CASCADE,
  environment text NOT NULL,
  base_url text NOT NULL,
  health_check_path text,
  status text NOT NULL DEFAULT 'active',
  healthy boolean,
  last_health_check_at timestamptz,
  registered_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_environment_unique UNIQUE (service_id, environment),
  CONSTRAINT service_environment_key_check CHECK (environment IN ('test', 'staging', 'uat', 'demo', 'live'))
);

CREATE INDEX service_environments_env_status_idx
  ON api_center.service_environments(environment, status);

INSERT INTO api_center.service_environments (
  service_id,
  environment,
  base_url,
  health_check_path,
  status,
  healthy,
  last_health_check_at,
  registered_at,
  updated_at
)
SELECT
  id,
  'test',
  base_url,
  health_check_path,
  status,
  healthy,
  last_health_check_at,
  registered_at,
  updated_at
FROM api_center.services
ON CONFLICT (service_id, environment) DO NOTHING;
```

- [ ] **Step 5: Persist environments in Postgres store**

In `api-center/src/registry/postgres-registry-store.service.ts`, include environments in the payload:

```ts
type ServiceRowWithRegistryRelations = Prisma.ServiceGetPayload<{
  include: {
    environments: true;
    routes: true;
    scopes: true;
    dependencies: {
      include: {
        dependsOnService: true;
      };
    };
  };
}>;
```

Update `loadAll()` include:

```ts
        environments: true,
```

After dependency persistence in `upsert()`, add:

```ts
      await tx.serviceEnvironment.deleteMany({
        where: { serviceId: service.id },
      });

      await tx.serviceEnvironment.createMany({
        data: normalizeEnvironmentRows(entry).map((environment) => ({
          serviceId: service.id,
          environment: environment.environment,
          baseUrl: environment.baseUrl,
          healthCheckPath: environment.healthCheck,
          status: environment.status ?? "active",
          healthy: environment.healthy,
          lastHealthCheckAt: environment.lastHealthCheckAt
            ? new Date(environment.lastHealthCheckAt)
            : undefined,
          registeredAt: new Date(entry.registeredAt),
          updatedAt: new Date(entry.updatedAt),
        })),
      });
```

Add helper:

```ts
function normalizeEnvironmentRows(entry: ServiceRegistryEntry) {
  if (entry.environments?.length) return entry.environments;

  return [
    {
      environment: "test" as const,
      baseUrl: entry.baseUrl,
      healthCheck: entry.healthCheck,
      status: entry.status,
      healthy: entry.healthy,
      lastHealthCheckAt: entry.lastHealthCheckAt,
    },
  ];
}
```

In `mapRowToRegistryEntry()`, add:

```ts
    environments:
      row.environments.length > 0
        ? row.environments.map((environment) => ({
            environment: environment.environment as any,
            baseUrl: environment.baseUrl,
            healthCheck: environment.healthCheckPath ?? undefined,
            status: environment.status as ServiceLifecycleStatus,
            healthy: environment.healthy ?? undefined,
            lastHealthCheckAt: environment.lastHealthCheckAt?.toISOString(),
          }))
        : [
            {
              environment: "test" as any,
              baseUrl: row.baseUrl,
              healthCheck: row.healthCheckPath ?? undefined,
              status: row.status as ServiceLifecycleStatus,
              healthy: row.healthy ?? undefined,
              lastHealthCheckAt: row.lastHealthCheckAt?.toISOString(),
            },
          ],
```

- [ ] **Step 6: Run Prisma generate**

Run:

```powershell
cd C:\Codes\apic\api-center
npx prisma generate
```

Expected: Prisma client generation succeeds.

- [ ] **Step 7: Run the persistence test and verify it passes**

Run:

```powershell
cd C:\Codes\apic\api-center
npm test -- src/registry/postgres-registry-store.service.spec.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

```powershell
git add prisma/schema.prisma prisma/migrations/20260618000000_add_service_environments/migration.sql src/registry/postgres-registry-store.service.ts src/registry/postgres-registry-store.service.spec.ts
git commit -m "feat: persist service environment records"
```

---

### Task 3: Resolve Runtime Environment For Routing

**Files:**
- Modify: `api-center/src/registry/registry.service.ts`
- Modify: `api-center/src/shared/proxy-handler.ts`
- Test: `api-center/src/shared/proxy-handler.spec.ts`

- [ ] **Step 1: Write the failing routing test**

In `api-center/src/shared/proxy-handler.spec.ts`, add:

```ts
it("routes to the requested service environment URL", async () => {
  registry.get.mockReturnValue({
    serviceId: "trinithrive",
    name: "TriniThrive",
    baseUrl: "https://trinithrive-test.example.com",
    requiredScopes: ["service:read"],
    exposes: ["/health"],
    consumes: [],
    ownerTribeId: "trinithrive",
    serviceType: "tribe",
    status: "active",
    registeredAt: "2026-06-18T00:00:00.000Z",
    updatedAt: "2026-06-18T00:00:00.000Z",
    environments: [
      {
        environment: "test",
        baseUrl: "https://trinithrive-test.example.com",
        status: "active",
      },
      {
        environment: "staging",
        baseUrl: "https://trinithrive-staging.example.com",
        status: "active",
      },
    ],
  });

  const target = handler.resolveTargetUrlForTest({
    serviceId: "trinithrive",
    path: "/health",
    requestedEnvironment: "staging",
  });

  expect(target.toString()).toBe("https://trinithrive-staging.example.com/health");
});
```

- [ ] **Step 2: Run the routing test and verify it fails**

Run:

```powershell
cd C:\Codes\apic\api-center
npm test -- src/shared/proxy-handler.spec.ts
```

Expected: FAIL because proxy routing uses `entry.baseUrl` only.

- [ ] **Step 3: Add environment resolution in registry service**

In `api-center/src/registry/registry.service.ts`, add:

```ts
resolveEnvironment(serviceId: string, environment = "test") {
  const entry = this.get(serviceId);
  if (!entry) return null;

  const environments = entry.environments?.length
    ? entry.environments
    : [
        {
          environment: "test" as const,
          baseUrl: entry.baseUrl,
          healthCheck: entry.healthCheck,
          status: entry.status,
        },
      ];

  return (
    environments.find((candidate) => candidate.environment === environment) ??
    environments.find((candidate) => candidate.environment === "test") ??
    environments[0] ??
    null
  );
}
```

- [ ] **Step 4: Use requested environment in proxy routing**

In `api-center/src/shared/proxy-handler.ts`, introduce:

```ts
function getRequestedServiceEnvironment(req: { headers?: Record<string, unknown> }) {
  const header = req.headers?.["x-apicenter-service-environment"];
  return Array.isArray(header) ? header[0] : typeof header === "string" ? header : "test";
}
```

Where target URL is built from `entry.baseUrl`, replace that lookup with:

```ts
const requestedEnvironment = getRequestedServiceEnvironment(req);
const environmentEntry = this.deps.registry.resolveEnvironment(
  targetServiceId,
  requestedEnvironment,
);
if (!environmentEntry) {
  throw new ServiceUnavailableError(
    `Service '${targetServiceId}' has no routable environment '${requestedEnvironment}'`,
  );
}
const targetBaseUrl = environmentEntry.baseUrl;
```

- [ ] **Step 5: Run the routing test and verify it passes**

Run:

```powershell
cd C:\Codes\apic\api-center
npm test -- src/shared/proxy-handler.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```powershell
git add src/registry/registry.service.ts src/shared/proxy-handler.ts src/shared/proxy-handler.spec.ts
git commit -m "feat: route services by environment"
```

---

### Task 4: Expose Environment Records In Registry API

**Files:**
- Modify: `api-center/src/registry/registry.controller.ts`
- Test: `api-center/src/registry/registry.controller.spec.ts`
- Modify: `apicenter-management/src/lib/schemas.ts`

- [ ] **Step 1: Write the failing API shape test**

In `api-center/src/registry/registry.controller.spec.ts`, add:

```ts
it("lists environment records with each service", () => {
  registry.getAll.mockReturnValue({
    trinithrive: {
      serviceId: "trinithrive",
      name: "TriniThrive",
      baseUrl: "https://trinithrive-test.example.com",
      status: "active",
      serviceType: "tribe",
      exposes: ["/health"],
      requiredScopes: ["service:read"],
      consumes: [],
      ownerTribeId: "trinithrive",
      environments: [
        {
          environment: "test",
          baseUrl: "https://trinithrive-test.example.com",
          healthCheck: "/health",
          status: "active",
        },
      ],
      registeredAt: "2026-06-18T00:00:00.000Z",
      updatedAt: "2026-06-18T00:00:00.000Z",
    },
  });

  const response = controller.listServices();

  expect(response.data[0]).toEqual(
    expect.objectContaining({
      serviceId: "trinithrive",
      environments: [
        expect.objectContaining({
          environment: "test",
          baseUrl: "https://trinithrive-test.example.com",
        }),
      ],
    }),
  );
});
```

- [ ] **Step 2: Run the API test and verify it fails**

Run:

```powershell
cd C:\Codes\apic\api-center
npm test -- src/registry/registry.controller.spec.ts
```

Expected: FAIL because list output omits `environments`.

- [ ] **Step 3: Include environments in registry list/detail output**

In `api-center/src/registry/registry.controller.ts`, add to the list mapper:

```ts
        environments: svc.environments,
```

The detail endpoint returns the full entry already after Task 1.

- [ ] **Step 4: Update management Zod schemas**

In `apicenter-management/src/lib/schemas.ts`, add:

```ts
export const serviceEnvironmentKeySchema = z.enum([
  "test",
  "staging",
  "uat",
  "demo",
  "live",
]);

export const serviceEnvironmentSchema = z.object({
  environment: serviceEnvironmentKeySchema,
  baseUrl: z.string().url("Environment URL must be valid"),
  healthCheck: z.string().optional(),
  status: serviceStatusSchema.default("active"),
  healthy: z.boolean().optional(),
  lastHealthCheckAt: z.string().optional(),
});
```

Extend `serviceManifestBaseSchema`:

```ts
  environments: z.array(serviceEnvironmentSchema).optional(),
```

Extend `serviceRegistryEntrySchema`:

```ts
    environments: z.array(serviceEnvironmentSchema).default([]),
```

- [ ] **Step 5: Run backend and management schema tests**

Run:

```powershell
cd C:\Codes\apic\api-center
npm test -- src/registry/registry.controller.spec.ts
cd C:\Codes\apic\apicenter-management
npm test -- src/lib/schemas.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```powershell
git add C:\Codes\apic\api-center\src\registry\registry.controller.ts C:\Codes\apic\api-center\src\registry\registry.controller.spec.ts C:\Codes\apic\apicenter-management\src\lib\schemas.ts C:\Codes\apic\apicenter-management\src\lib\schemas.test.ts
git commit -m "feat: expose registry environments"
```

---

### Task 5: Add Management Environment Repeater

**Files:**
- Modify: `apicenter-management/src/components/tribe-form.tsx`
- Test: `apicenter-management/src/components/tribe-form.test.tsx`

- [ ] **Step 1: Write the failing UI test**

In `apicenter-management/src/components/tribe-form.test.tsx`, add:

```tsx
it("lets operators add multiple service environments", async () => {
  render(<TribeForm />);

  fireEvent.change(screen.getByLabelText("Service ID"), {
    target: { value: "trinithrive" },
  });
  fireEvent.change(screen.getByLabelText("Service name"), {
    target: { value: "TriniThrive" },
  });
  fireEvent.change(screen.getByLabelText("Environment URL for test"), {
    target: { value: "https://trinithrive-test.example.com" },
  });

  fireEvent.click(screen.getByRole("button", { name: "Add environment" }));
  fireEvent.change(screen.getByLabelText("Environment key for row 2"), {
    target: { value: "staging" },
  });
  fireEvent.change(screen.getByLabelText("Environment URL for staging"), {
    target: { value: "https://trinithrive-staging.example.com" },
  });

  fireEvent.click(screen.getByRole("button", { name: "Register service" }));

  await waitFor(() =>
    expect(registerService).toHaveBeenCalledWith(
      expect.objectContaining({
        environments: [
          expect.objectContaining({
            environment: "test",
            baseUrl: "https://trinithrive-test.example.com",
          }),
          expect.objectContaining({
            environment: "staging",
            baseUrl: "https://trinithrive-staging.example.com",
          }),
        ],
      }),
    ),
  );
});
```

- [ ] **Step 2: Run the UI test and verify it fails**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/components/tribe-form.test.tsx
```

Expected: FAIL because the form has only one `baseUrl` field.

- [ ] **Step 3: Add form state for environment rows**

In `apicenter-management/src/components/tribe-form.tsx`, extend `formSchema`:

```ts
    environments: z
      .array(
        z.object({
          environment: z.enum(["test", "staging", "uat", "demo", "live"]),
          baseUrl: z.string().url("Environment URL must be valid"),
          healthCheck: z.string().optional(),
        }),
      )
      .min(1, "At least one environment is required"),
```

In the transform, replace the single `baseUrl` source with:

```ts
      baseUrl: values.environments[0]?.baseUrl ?? values.baseUrl,
      healthCheck:
        values.environments[0]?.healthCheck ??
        emptyToUndefined(values.healthCheck),
      environments: values.environments.map((environment) => ({
        environment: environment.environment,
        baseUrl: environment.baseUrl,
        healthCheck: emptyToUndefined(environment.healthCheck),
      })),
```

Keep `baseUrl` temporarily for existing form wiring until the UI is fully moved.

- [ ] **Step 4: Render an environment row editor**

Add a section below the service identity fields:

```tsx
<FieldSet>
  <FieldTitle>Environments</FieldTitle>
  <FieldDescription>
    Add the runtime URLs this service should expose through API Center.
  </FieldDescription>
  {environmentRows.map((row, index) => (
    <div key={row.id} className="grid gap-3 md:grid-cols-[160px_1fr_180px_auto]">
      <Field>
        <FieldLabel htmlFor={`environment-${index}`}>
          Environment key for row {index + 1}
        </FieldLabel>
        <select
          id={`environment-${index}`}
          {...form.register(`environments.${index}.environment`)}
        >
          <option value="test">test</option>
          <option value="staging">staging</option>
          <option value="uat">uat</option>
          <option value="demo">demo</option>
          <option value="live">live</option>
        </select>
      </Field>
      <Field>
        <FieldLabel htmlFor={`environment-url-${row.environment}`}>
          Environment URL for {row.environment}
        </FieldLabel>
        <Input
          id={`environment-url-${row.environment}`}
          {...form.register(`environments.${index}.baseUrl`)}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`environment-health-${row.environment}`}>
          Health check
        </FieldLabel>
        <Input
          id={`environment-health-${row.environment}`}
          {...form.register(`environments.${index}.healthCheck`)}
        />
      </Field>
      <Button type="button" variant="outline" onClick={() => removeEnvironment(index)}>
        Remove
      </Button>
    </div>
  ))}
  <Button type="button" variant="outline" onClick={addEnvironment}>
    Add environment
  </Button>
</FieldSet>
```

Use `useFieldArray` from `react-hook-form` to implement `environmentRows`, `addEnvironment`, and `removeEnvironment`.

- [ ] **Step 5: Run the UI test and verify it passes**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/components/tribe-form.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```powershell
git add src/components/tribe-form.tsx src/components/tribe-form.test.tsx
git commit -m "feat: add tribe environment registration UI"
```

---

### Task 6: Make Secrets And Topics Environment-Aware

**Files:**
- Modify: `apicenter-management/src/lib/event-topics.ts`
- Modify: `apicenter-management/src/components/tribe-deprovisioning-card.tsx`
- Modify: `apicenter-management/src/lib/api-center-client.ts`
- Test: `apicenter-management/src/lib/event-topics.test.ts`
- Test: `apicenter-management/src/components/tribe-deprovisioning-card.test.tsx`

- [ ] **Step 1: Write the failing topic test**

In `apicenter-management/src/lib/event-topics.test.ts`, add:

```ts
it("builds tribe topics from explicit environment keys", () => {
  expect(
    getServiceEventTopics({
      serviceId: "trinithrive",
      ownerTribeId: "trinithrive",
      serviceType: "tribe",
      environment: "staging",
    }).tribeEvents,
  ).toBe("staging.tribe.trinithrive.events");
});
```

- [ ] **Step 2: Run the topic test and verify it fails**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/lib/event-topics.test.ts
```

Expected: FAIL because `getServiceEventTopics` only reads `NEXT_PUBLIC_KAFKA_TOPIC_PREFIX`.

- [ ] **Step 3: Add explicit environment support**

In `apicenter-management/src/lib/event-topics.ts`, extend input:

```ts
export type ServiceTopicInput = {
  serviceId: string;
  ownerTribeId?: string;
  serviceType?: ServiceTopicType;
  environment?: "test" | "staging" | "uat" | "demo" | "live";
};
```

Replace `withTopicPrefix` usage in `getTribeEventTopic` calls with:

```ts
const topicPrefix = normalized.environment ?? getDefaultTopicPrefix();
const tribeEvents = withTopicPrefix(`tribe.${tribeTopicOwnerId}.events`, topicPrefix);
```

Update helper:

```ts
export function withTopicPrefix(topic: string, explicitPrefix?: string) {
  const prefix = (explicitPrefix ?? process.env.NEXT_PUBLIC_KAFKA_TOPIC_PREFIX ?? "")
    .trim()
    .replace(/\.+$/, "");

  if (!prefix) return topic;
  if (topic === prefix || topic.startsWith(`${prefix}.`)) return topic;

  return `${prefix}.${topic}`;
}

function getDefaultTopicPrefix() {
  return (process.env.NEXT_PUBLIC_KAFKA_TOPIC_PREFIX ?? "").trim();
}
```

- [ ] **Step 4: Make deprovisioning iterate environments**

In `apicenter-management/src/components/tribe-deprovisioning-card.tsx`, when a service has `environments`, render a checklist by environment. For each selected environment:

```ts
const topicName = getServiceEventTopics({
  serviceId,
  ownerTribeId: tribePrincipalId,
  serviceType: "tribe",
  environment: selectedEnvironment,
}).tribeEvents;
```

For Secret Manager cleanup, derive:

```ts
const secretPrincipalId =
  selectedEnvironment === "test"
    ? tribePrincipalId
    : `${selectedEnvironment}-${tribePrincipalId}`;
```

Do not delete a live secret unless the operation confirmation phrase is `APPLY LIVE CHANGE` and a non-empty reason is present.

- [ ] **Step 5: Run topic and deprovisioning tests**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/lib/event-topics.test.ts src/components/tribe-deprovisioning-card.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

```powershell
git add src/lib/event-topics.ts src/lib/event-topics.test.ts src/components/tribe-deprovisioning-card.tsx src/components/tribe-deprovisioning-card.test.tsx src/lib/api-center-client.ts
git commit -m "feat: make service resource cleanup environment-aware"
```

---

### Task 7: Add Service Detail Environment Tabs

**Files:**
- Modify: `apicenter-management/src/components/service-detail-client.tsx`
- Test: `apicenter-management/src/components/service-detail-client.test.tsx`

- [ ] **Step 1: Write the failing detail test**

In `apicenter-management/src/components/service-detail-client.test.tsx`, add:

```tsx
it("shows environment-specific endpoints on service detail", async () => {
  render(
    <ServiceDetailClient
      serviceId="trinithrive"
      initialService={{
        serviceId: "trinithrive",
        name: "TriniThrive",
        baseUrl: "https://trinithrive-test.example.com",
        status: "active",
        serviceType: "tribe",
        exposes: ["/health"],
        requiredScopes: ["service:read"],
        consumes: [],
        ownerTribeId: "trinithrive",
        environments: [
          {
            environment: "test",
            baseUrl: "https://trinithrive-test.example.com",
            status: "active",
          },
          {
            environment: "staging",
            baseUrl: "https://trinithrive-staging.example.com",
            status: "active",
          },
        ],
        registeredAt: "2026-06-18T00:00:00.000Z",
        updatedAt: "2026-06-18T00:00:00.000Z",
      }}
    />,
  );

  expect(await screen.findByText("test")).toBeTruthy();
  expect(screen.getByText("https://trinithrive-test.example.com")).toBeTruthy();
  expect(screen.getByText("staging")).toBeTruthy();
  expect(screen.getByText("https://trinithrive-staging.example.com")).toBeTruthy();
});
```

- [ ] **Step 2: Run the detail test and verify it fails**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/components/service-detail-client.test.tsx
```

Expected: FAIL because the detail page renders only one `baseUrl`.

- [ ] **Step 3: Render environment tabs or table**

In `apicenter-management/src/components/service-detail-client.tsx`, compute:

```ts
const environments =
  service.environments.length > 0
    ? service.environments
    : [
        {
          environment: "test" as const,
          baseUrl: service.baseUrl,
          healthCheck: service.healthCheck,
          status: service.status,
        },
      ];
```

Render a section:

```tsx
<section aria-label="Service environments">
  <h2>Environments</h2>
  <div className="grid gap-3">
    {environments.map((environment) => (
      <div key={environment.environment}>
        <Badge>{environment.environment}</Badge>
        <p>{environment.baseUrl}</p>
        <p>{environment.healthCheck ?? "/health"}</p>
      </div>
    ))}
  </div>
</section>
```

- [ ] **Step 4: Run the detail test and verify it passes**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/components/service-detail-client.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit Task 7**

```powershell
git add src/components/service-detail-client.tsx src/components/service-detail-client.test.tsx
git commit -m "feat: show service environments on detail pages"
```

---

### Task 8: Update Docs And Plan Index

**Files:**
- Modify: `api-center/docs/developer/tribe-onboarding.md`
- Modify: `apicenter-management/docs/operations/apicenter-management-runbook.md`
- Modify: `api-center/docs/superpowers/plans/README.md`

- [ ] **Step 1: Update tribe onboarding docs**

Add a section to `api-center/docs/developer/tribe-onboarding.md`:

````md
## Multi-Environment Service Registration

Register one stable service identity and attach one or more environment records.
The service identity owns governance, contacts, scopes, and dependencies. Each
environment owns the runtime URL, health check, tribe secret, event topic, and
promotion evidence.

Supported environment keys are `test`, `staging`, `uat`, `demo`, and `live`.
Custom keys are not accepted in the first release.

Example:

```json
{
  "serviceId": "trinithrive",
  "name": "TriniThrive",
  "ownerTribeId": "trinithrive",
  "baseUrl": "https://trinithrive-test.example.com",
  "requiredScopes": ["service:read"],
  "exposes": ["/health"],
  "environments": [
    {
      "environment": "test",
      "baseUrl": "https://trinithrive-test.example.com",
      "healthCheck": "/health"
    },
    {
      "environment": "staging",
      "baseUrl": "https://trinithrive-staging.example.com",
      "healthCheck": "/health"
    }
  ]
}
```
````

- [ ] **Step 2: Update the management runbook**

Add to `apicenter-management/docs/operations/apicenter-management-runbook.md`:

```md
## Environment-Scoped Tribe Operations

The tribe form can register several runtime environments for one service ID.
Operators should keep the environment key platform-controlled and let tribes
customize only the URL and health path.

Cleanup must be done per environment:

- deregister service environment or service identity
- remove the environment topic from the managed S3 sink
- delete or rotate the environment tribe secret
- disable environment quota policies
- check plan assignments for the owner tribe and environment
```

- [ ] **Step 3: Update plan index**

Add a row in `api-center/docs/superpowers/plans/README.md` under Current And Follow-Up Plans:

```md
| active     | `2026-06-18-tribe-multi-environment-registry.md`                   | Multi-environment tribe registration plan covering registry identity, environment-scoped routing, management UI, secrets, topics, quotas, and cleanup.                                  |
```

- [ ] **Step 4: Commit Task 8**

```powershell
git add api-center/docs/developer/tribe-onboarding.md apicenter-management/docs/operations/apicenter-management-runbook.md api-center/docs/superpowers/plans/README.md
git commit -m "docs: document multi-environment tribe registration"
```

---

### Task 9: Full Verification

**Files:**
- No source edits expected.

- [ ] **Step 1: Run backend focused tests**

Run:

```powershell
cd C:\Codes\apic\api-center
npm test -- src/registry/registry.controller.spec.ts src/registry/postgres-registry-store.service.spec.ts src/shared/proxy-handler.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run backend typecheck/build**

Run:

```powershell
cd C:\Codes\apic\api-center
npm run build
```

Expected: PASS.

- [ ] **Step 3: Run management focused tests**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/lib/schemas.test.ts src/lib/event-topics.test.ts src/components/tribe-form.test.tsx src/components/service-detail-client.test.tsx src/components/tribe-deprovisioning-card.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Run management typecheck/build**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm run typecheck
npm run build
```

Expected: PASS.

- [ ] **Step 5: Run local browser smoke**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Open `http://localhost:3000/tribes/new` and verify:

- one `test` environment row appears by default
- `Add environment` adds a second row
- duplicate environment keys are rejected
- valid `test` plus `staging` submission sends `environments[]`
- service detail shows environment rows after registration

- [ ] **Step 6: Commit verification notes if docs changed**

If verification reveals doc changes, commit them:

```powershell
git add api-center/docs apicenter-management/docs
git commit -m "docs: record multi-environment verification notes"
```

---

## Caveats And Non-Goals

- This plan does not remove old `baseUrl` from `Service`; it keeps it as a compatibility mirror for the first/default environment.
- This plan does not allow arbitrary environment keys.
- This plan does not introduce a UI environment switch for live writes.
- This plan does not delete historical S3 data during service cleanup.
- This plan does not change the current tribe secret plaintext constraint: lost plaintext secrets still require rotation/reissue.
- This plan does not make Confluent part of request-time routing; Confluent remains async event/data infrastructure.

## Self-Review

- Spec coverage: Covers backend identity, environment records, routing, management registration UI, detail UI, secrets/topics, cleanup, docs, and verification.
- Placeholder scan: No placeholder markers or deferred instructions remain.
- Type consistency: Uses `ServiceEnvironmentManifest`, `ServiceEnvironmentKey`, `environment`, `baseUrl`, `healthCheck`, `status`, `healthy`, and `lastHealthCheckAt` consistently across backend and management tasks.
