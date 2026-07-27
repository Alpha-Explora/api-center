# API Center Management Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Turn the local-only `apicenter-management` console into a useful operations tool for registry management, service health, lifecycle safety, SDK onboarding, and event/data-pipeline visibility without adding auth or a database yet.

**Architecture:** API Center remains the source of truth. The Next.js app stays local-only and calls its own `/api/local/*` route handlers; those route handlers call protected API Center endpoints with server-only `API_CENTER_PLATFORM_ADMIN_SECRET`. No production auth, no management database, no public deployment, and no frontend-exposed secrets in this plan.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, shadcn/ui, zod, TanStack Query, existing API Center `/api/v1/registry/*`, local Next.js route handlers, API Center Redis registry.

**Implementation Status:** Implemented in the local `apicenter-management` app on 2026-05-13. The app now includes live registry summary, registry filtering, edit manifest flow, server-side health checks, typed lifecycle confirmations, dependency view, SDK onboarding panel, Confluent/S3 event mapping, and manifest import/export. Final validation should still be rerun after `.env.local` is pointed at the intended API Center environment.

---

## Scope Rules

In scope:

- Better registry dashboard.
- Search, filtering, grouping, and service detail UX.
- Edit existing service manifests.
- Health checks from the local server side.
- Safer lifecycle actions.
- Dependency and consumer views.
- SDK onboarding generator.
- Kafka topic and Confluent/S3 visibility.
- Import/export manifest workflow.
- Local-only documentation and verification.

Out of scope:

- Descope login.
- Admin users or roles.
- Management database.
- Public deployment.
- Credential issuance or secret reveal workflows.

## Phase 1: Data Layer And Types

### Task 1.1: Add Registry View Models

**Files:**
- Modify: `C:\Codes\apic\apicenter-management\src\lib\schemas.ts`
- Create: `C:\Codes\apic\apicenter-management\src\lib\registry-view.ts`

- [x] **Step 1: Add derived registry types**

Add these exports to `src\lib\schemas.ts`:

```ts
export const serviceHealthResultSchema = z.object({
  serviceId: z.string(),
  checkedAt: z.string(),
  ok: z.boolean(),
  status: z.number().optional(),
  url: z.string(),
  error: z.string().optional(),
});

export const serviceConsumerResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    serviceId: z.string(),
    consumers: z.array(z.string()),
  }),
  meta: z.object({ total: z.number().optional() }).optional(),
});

export type ServiceHealthResult = z.infer<typeof serviceHealthResultSchema>;
```

- [x] **Step 2: Create registry view helpers**

Create `src\lib\registry-view.ts`:

```ts
import type { ServiceRegistryEntry } from "@/lib/schemas";

export function groupServicesByOwner(services: ServiceRegistryEntry[]) {
  return services.reduce<Record<string, ServiceRegistryEntry[]>>((groups, service) => {
    const owner = service.ownerTeam || "Unassigned";
    groups[owner] = groups[owner] ?? [];
    groups[owner].push(service);
    return groups;
  }, {});
}

export function getRegistrySummary(services: ServiceRegistryEntry[]) {
  return {
    total: services.length,
    tribe: services.filter((service) => (service.serviceType ?? "tribe") === "tribe").length,
    shared: services.filter((service) => service.serviceType === "shared").length,
    active: services.filter((service) => service.status === "active").length,
    deprecated: services.filter((service) => service.status === "deprecated").length,
    retired: services.filter((service) => service.status === "retired").length,
    unhealthy: services.filter((service) => service.healthy === false).length,
    missingOwner: services.filter((service) => !service.ownerTeam || !service.contact).length,
    missingHealthPath: services.filter((service) => !service.healthCheck).length,
  };
}

export function getConsumersForService(
  services: ServiceRegistryEntry[],
  targetServiceId: string,
) {
  return services
    .filter((service) => service.consumes.includes(targetServiceId))
    .map((service) => service.serviceId);
}

export function getBrokenDependencies(services: ServiceRegistryEntry[]) {
  const serviceIds = new Set(services.map((service) => service.serviceId));
  return services.flatMap((service) =>
    service.consumes
      .filter((targetServiceId) => !serviceIds.has(targetServiceId))
      .map((targetServiceId) => ({
        sourceServiceId: service.serviceId,
        targetServiceId,
      })),
  );
}
```

- [x] **Step 3: Verify types**

Run:

```powershell
npm run build
```

Expected: TypeScript passes.

## Phase 2: Operations Dashboard

### Task 2.1: Replace Static Dashboard With Live Registry Summary

**Files:**
- Modify: `C:\Codes\apic\apicenter-management\src\app\page.tsx`
- Create: `C:\Codes\apic\apicenter-management\src\components\dashboard-client.tsx`
- Create: `C:\Codes\apic\apicenter-management\src\components\registry-summary-table.tsx`

- [x] **Step 1: Create dashboard client**

Create `src\components\dashboard-client.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { listServices } from "@/lib/api-center-client";
import { queryKeys } from "@/lib/query-keys";
import { getBrokenDependencies, getRegistrySummary } from "@/lib/registry-view";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function DashboardClient() {
  const servicesQuery = useQuery({
    queryKey: queryKeys.services,
    queryFn: listServices,
  });

  if (servicesQuery.isLoading) {
    return (
      <div className="grid gap-3 md:grid-cols-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
    );
  }

  if (servicesQuery.isError || !servicesQuery.data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Registry unavailable</AlertTitle>
        <AlertDescription>
          Check `.env.local` and confirm API Center is reachable.
        </AlertDescription>
      </Alert>
    );
  }

  const summary = getRegistrySummary(servicesQuery.data);
  const brokenDependencies = getBrokenDependencies(servicesQuery.data);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-4">
        <SummaryCard title="Total services" value={summary.total} description={`${summary.tribe} tribe, ${summary.shared} shared`} />
        <SummaryCard title="Unhealthy" value={summary.unhealthy} description="Marked unhealthy by API Center" />
        <SummaryCard title="Missing owners" value={summary.missingOwner} description="No owner team or contact" />
        <SummaryCard title="Broken deps" value={brokenDependencies.length} description="Consumes unknown services" />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Recommended actions</CardTitle>
          <CardDescription>Local checks before publishing this console.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button render={<Link href="/tribes" />}>Open registry</Button>
          <Button variant="outline" render={<Link href="/tribes/new" />}>Register service</Button>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({
  title,
  value,
  description,
}: {
  title: string;
  value: number;
  description: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}
```

- [x] **Step 2: Use dashboard client on home page**

Modify `src\app\page.tsx` so the static card grid is replaced with:

```tsx
import { DashboardClient } from "@/components/dashboard-client";

export default function Home() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          API Center Management
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Local registry management for API Center service manifests.
        </p>
      </div>
      <DashboardClient />
    </div>
  );
}
```

- [x] **Step 3: Verify**

Run:

```powershell
npm run lint
npm run build
```

Expected: lint and build pass.

## Phase 3: Registry UX

### Task 3.1: Add Search And Filters

**Files:**
- Modify: `C:\Codes\apic\apicenter-management\src\components\tribe-list-client.tsx`
- Create: `C:\Codes\apic\apicenter-management\src\components\registry-filters.tsx`

- [x] **Step 1: Create filter component**

Create `src\components\registry-filters.tsx`:

```tsx
"use client";

import { Input } from "@/components/ui/input";

export type RegistryFilters = {
  query: string;
  ownerTeam: string;
  status: string;
  serviceType: string;
};

export function RegistryFiltersPanel({
  value,
  onChange,
}: {
  value: RegistryFilters;
  onChange: (value: RegistryFilters) => void;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-4">
      <Input
        value={value.query}
        onChange={(event) => onChange({ ...value, query: event.target.value })}
        placeholder="Search service, URL, contact"
      />
      <Input
        value={value.ownerTeam}
        onChange={(event) => onChange({ ...value, ownerTeam: event.target.value })}
        placeholder="Owner team"
      />
      <select
        className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
        value={value.serviceType}
        onChange={(event) => onChange({ ...value, serviceType: event.target.value })}
      >
        <option value="">All types</option>
        <option value="tribe">tribe</option>
        <option value="shared">shared</option>
      </select>
      <select
        className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
        value={value.status}
        onChange={(event) => onChange({ ...value, status: event.target.value })}
      >
        <option value="">All statuses</option>
        <option value="active">active</option>
        <option value="deprecated">deprecated</option>
        <option value="retired">retired</option>
      </select>
    </div>
  );
}
```

- [x] **Step 2: Apply filters in list client**

Add local state in `tribe-list-client.tsx`:

```tsx
const [filters, setFilters] = useState<RegistryFilters>({
  query: "",
  ownerTeam: "",
  status: "",
  serviceType: "",
});
```

Filter services before grouping:

```ts
function matchesFilters(service: ServiceRegistryEntry, filters: RegistryFilters) {
  const query = filters.query.toLowerCase().trim();
  const owner = filters.ownerTeam.toLowerCase().trim();

  if (query) {
    const haystack = [
      service.serviceId,
      service.name,
      service.baseUrl,
      service.ownerTeam,
      service.contact,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(query)) return false;
  }

  if (owner && !(service.ownerTeam ?? "").toLowerCase().includes(owner)) return false;
  if (filters.status && service.status !== filters.status) return false;
  if (filters.serviceType && (service.serviceType ?? "tribe") !== filters.serviceType) return false;

  return true;
}
```

- [x] **Step 3: Verify**

Run:

```powershell
npm run build
```

Expected: build passes and `/tribes` filters without a page reload.

## Phase 4: Edit Existing Service

### Task 4.1: Add Edit Page

**Files:**
- Create: `C:\Codes\apic\apicenter-management\src\app\tribes\[tribeId]\edit\page.tsx`
- Modify: `C:\Codes\apic\apicenter-management\src\components\tribe-form.tsx`
- Modify: `C:\Codes\apic\apicenter-management\src\components\service-detail-client.tsx`

- [x] **Step 1: Make form reusable**

Change `TribeForm` props:

```ts
export function TribeForm({
  initialValue,
  mode = "create",
}: {
  initialValue?: ServiceRegistryEntry;
  mode?: "create" | "edit";
}) {
```

Map `initialValue` into form defaults:

```ts
function toFormDefaults(service?: ServiceRegistryEntry): FormInput {
  if (!service) return defaultValues;

  return {
    serviceId: service.serviceId,
    name: service.name,
    baseUrl: service.baseUrl,
    serviceType: service.serviceType ?? "tribe",
    ownerTeam: service.ownerTeam ?? "",
    contact: service.contact ?? "",
    version: service.version ?? "1.0.0",
    serviceTier: service.serviceTier ?? "standard",
    costCenter: service.costCenter ?? "",
    healthCheck: service.healthCheck ?? "/health",
    description: service.description ?? "",
    exposesText: service.exposes.join(","),
    requiredScopesText: service.requiredScopes.join(","),
    consumesText: service.consumes.join(","),
    tagsText: service.tags?.join(",") ?? "",
  };
}
```

- [x] **Step 2: Lock service ID in edit mode**

When `mode === "edit"`, disable the service ID input:

```tsx
<Input disabled={mode === "edit"} ... />
```

- [x] **Step 3: Add edit page**

Create the page:

```tsx
import { EditServiceClient } from "@/components/edit-service-client";

export default async function EditServicePage({
  params,
}: {
  params: Promise<{ tribeId: string }>;
}) {
  const { tribeId } = await params;
  return <EditServiceClient serviceId={tribeId} />;
}
```

- [x] **Step 4: Add edit client**

Create `src\components\edit-service-client.tsx` that loads `getService(serviceId)`, passes it into `TribeForm`, and renders loading/error states.

- [x] **Step 5: Add detail page button**

In `service-detail-client.tsx`, add:

```tsx
<Button variant="outline" render={<Link href={`/tribes/${serviceId}/edit`} />}>
  Edit manifest
</Button>
```

- [x] **Step 6: Verify**

Run:

```powershell
npm run lint
npm run build
```

Expected: edit page builds and form submits through existing `registerService`.

## Phase 5: Health Checks

### Task 5.1: Add Server-Side Health Check Route

**Files:**
- Create: `C:\Codes\apic\apicenter-management\src\app\api\local\registry\services\[serviceId]\health\route.ts`
- Modify: `C:\Codes\apic\apicenter-management\src\lib\api-center-client.ts`
- Modify: `C:\Codes\apic\apicenter-management\src\components\service-detail-client.tsx`

- [x] **Step 1: Add health route**

The route should:

1. Load service detail through `apiCenterAdminRequest`.
2. Parse returned `data.baseUrl` and `data.healthCheck`.
3. Call `${baseUrl}${healthCheck ?? "/health"}` from the server.
4. Return a `ServiceHealthResult`.

Return body shape:

```json
{
  "serviceId": "campusone-students",
  "checkedAt": "2026-05-13T00:00:00.000Z",
  "ok": true,
  "status": 200,
  "url": "https://api.campusone.itsandbox.site/health"
}
```

- [x] **Step 2: Add client helper**

In `api-center-client.ts`:

```ts
export async function checkServiceHealth(serviceId: string): Promise<ServiceHealthResult> {
  const data = await request<unknown>(
    `/api/local/registry/services/${encodeURIComponent(serviceId)}/health`,
    { method: "POST" },
  );
  return serviceHealthResultSchema.parse(data);
}
```

- [x] **Step 3: Add detail button**

Add a "Check health" button on the service detail page. Show:

- checked URL
- status code
- checked time
- error message if failed

- [x] **Step 4: Verify**

Run:

```powershell
npm run build
```

Expected: build passes. Manual health check returns either a status or readable error.

## Phase 6: Safer Lifecycle Actions

### Task 6.1: Require Typed Confirmation

**Files:**
- Modify: `C:\Codes\apic\apicenter-management\src\components\service-detail-client.tsx`

- [x] **Step 1: Replace basic confirmation dialog**

Change `ConfirmAction` to require typing the service ID before retire or deregister.

Dialog must show:

```text
Type <serviceId> to confirm.
```

Disable action until typed value equals `serviceId`.

- [x] **Step 2: Show consumers before destructive actions**

Use all services from `listServices()` and `getConsumersForService()` to show:

```text
Consumed by: billing-api, campusone-portal
```

If consumers exist, show warning copy inside the dialog.

- [x] **Step 3: Verify**

Run:

```powershell
npm run lint
npm run build
```

Expected: build passes and destructive buttons cannot execute without typed confirmation.

## Phase 7: Dependency Graph

### Task 7.1: Add Dependency Page

**Files:**
- Create: `C:\Codes\apic\apicenter-management\src\app\dependencies\page.tsx`
- Create: `C:\Codes\apic\apicenter-management\src\components\dependency-map-client.tsx`
- Modify: `C:\Codes\apic\apicenter-management\src\components\app-shell.tsx`

- [x] **Step 1: Add navigation item**

Add:

```ts
{ href: "/dependencies", label: "Dependencies", icon: NetworkIcon }
```

- [x] **Step 2: Create dependency map client**

Show table columns:

- source service
- consumes
- dependency status
- target type

Use `getBrokenDependencies()` for missing targets and `getConsumersForService()` for reverse dependencies.

- [x] **Step 3: Add service detail dependency section**

In detail page, add:

- "Consumes"
- "Consumed by"
- "Broken dependencies"

- [x] **Step 4: Verify**

Run:

```powershell
npm run build
```

Expected: dependency page builds and shows data from the registry list.

## Phase 8: SDK Onboarding Generator

### Task 8.1: Expand SDK Panel

**Files:**
- Modify: `C:\Codes\apic\apicenter-management\src\components\sdk-config-panel.tsx`
- Modify: `C:\Codes\apic\apicenter-management\src\components\service-detail-client.tsx`

- [x] **Step 1: Accept full service**

Change props:

```ts
export function SdkConfigPanel({ service }: { service: ServiceRegistryEntry })
```

- [x] **Step 2: Show install and env**

Display:

```bash
npm install @apicenter/sdk
```

Display:

```env
API_CENTER_BASE_URL=https://api-center.itsandbox.site
TRIBE_ID=<serviceId>
API_CENTER_CLIENT_ID=<issued-client-id>
API_CENTER_CLIENT_SECRET=<issued-client-secret>
```

- [x] **Step 3: Show sample call**

For a service with `consumes[0]`, show:

```ts
await apiCenter.tribes.call({
  targetServiceId: "<first-consumed-service>",
  method: "GET",
  path: "/health",
});
```

If no consumed services exist, show a read-only note:

```text
Add consumed services to generate a tribe-to-tribe sample call.
```

- [x] **Step 4: Verify**

Run:

```powershell
npm run build
```

Expected: SDK panel builds and uses real service data.

## Phase 9: Kafka Topic And S3 Pipeline Visibility

### Task 9.1: Add Event Mapping Panel

**Files:**
- Create: `C:\Codes\apic\apicenter-management\src\components\event-mapping-panel.tsx`
- Modify: `C:\Codes\apic\apicenter-management\src\components\service-detail-client.tsx`

- [x] **Step 1: Add topic helper**

Create:

```ts
function getServiceEventTopics(serviceId: string) {
  return {
    tribeEvents: `tribe.${serviceId}.events`,
    request: "api-center.tribe.request",
    response: "api-center.tribe.response",
    audit: "api-center.audit.log",
  };
}
```

- [x] **Step 2: Render mapping**

Panel should show:

- service event topic
- gateway request topic
- gateway response topic
- audit topic
- note that Confluent S3 sink exports topic data only for topics included in connector configuration

- [x] **Step 3: Verify**

Run:

```powershell
npm run build
```

Expected: build passes and detail page shows topic mapping.

## Phase 10: Import And Export

### Task 10.1: Add Manifest JSON Tools

**Files:**
- Create: `C:\Codes\apic\apicenter-management\src\app\manifest-tools\page.tsx`
- Create: `C:\Codes\apic\apicenter-management\src\components\manifest-tools-client.tsx`
- Modify: `C:\Codes\apic\apicenter-management\src\components\app-shell.tsx`

- [x] **Step 1: Add export current registry**

Use `listServices()` and render JSON in a `<Textarea>`.

- [x] **Step 2: Add paste-to-register**

Text area accepts one manifest or an array of manifests.

Validation:

```ts
const single = serviceManifestSchema.safeParse(parsed);
const many = z.array(serviceManifestSchema).safeParse(parsed);
```

- [x] **Step 3: Submit manifests sequentially**

For each parsed manifest, call `registerService(manifest)`.

Show success/error count.

- [x] **Step 4: Verify**

Run:

```powershell
npm run lint
npm run build
```

Expected: build passes and invalid JSON shows a clear validation error.

## Phase 11: Documentation And Final Verification

### Task 11.1: Update Docs

**Files:**
- Modify: `C:\Codes\apic\apicenter-management\README.md`
- Modify: `C:\Codes\apic\apicenter-management\docs\superpowers\plans\2026-05-13-management-improvements-no-auth.md`

- [x] **Step 1: Document features**

README must include:

- local proxy architecture
- `.env.local` setup
- registry list
- edit flow
- health checks
- lifecycle safety
- dependency graph
- SDK panel
- event mapping
- manifest import/export

- [x] **Step 2: Document non-goals**

README must state:

```text
Authentication, admin users, management database, and public deployment are intentionally not implemented yet.
```

- [x] **Step 3: Final verification**

Run:

```powershell
npm run lint
npm run build
```

Manual local checks:

```text
http://localhost:3002
http://localhost:3002/tribes
http://localhost:3002/tribes/new
http://localhost:3002/dependencies
http://localhost:3002/manifest-tools
```

With `.env.local` configured, verify:

- service list loads
- service can be registered
- service can be edited
- service health can be checked
- dependency page shows consumes/consumed-by state
- destructive actions require typed confirmation
- SDK and event mapping panels render from live data

## Commit Plan

Use separate commits:

```powershell
git add src/lib src/app/page.tsx src/components/dashboard-client.tsx README.md
git commit -m "feat: add registry operations dashboard"

git add src/components/registry-filters.tsx src/components/tribe-list-client.tsx
git commit -m "feat: add registry search and filters"

git add src/app/tribes/[tribeId]/edit src/components/edit-service-client.tsx src/components/tribe-form.tsx
git commit -m "feat: add service manifest editing"

git add src/app/api/local/registry/services/[serviceId]/health src/components/service-detail-client.tsx src/lib
git commit -m "feat: add local service health checks"

git add src/app/dependencies src/components/dependency-map-client.tsx src/components/app-shell.tsx
git commit -m "feat: add registry dependency map"

git add src/components/sdk-config-panel.tsx src/components/event-mapping-panel.tsx
git commit -m "feat: expand sdk and event mapping panels"

git add src/app/manifest-tools src/components/manifest-tools-client.tsx README.md
git commit -m "feat: add manifest import export tools"
```

## Self-Review

Spec coverage:

- All requested UI/UX and functionality improvements are covered.
- Auth is explicitly excluded.
- Database is explicitly excluded.
- The app remains local-only.
- API Center remains the source of truth.

Risk notes:

- Health checks from the local server may fail if upstream services are private to GKE and not reachable from the developer machine. If so, keep the API route but show the network error clearly.
- Registry edit uses the existing API Center register endpoint as an upsert. This is correct for now, but a dedicated PATCH endpoint can be added later.
- Topic mapping is deterministic guidance, not proof that a Confluent connector includes every topic. Connector verification should be a later cloud-control-plane feature.
