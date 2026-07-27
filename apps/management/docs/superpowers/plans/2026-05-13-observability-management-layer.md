# API Center Observability Management Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add observability and management features that show which tribes use which shared services, what is declared in the registry, and what is actually happening at runtime.

**Architecture:** Start with registry-derived analytics inside `apicenter-management`, because the current app can already list services and their `consumes` relationships. Then add API Center runtime counters for shared-service proxy traffic, expose those counters through protected admin endpoints, and render them in the management UI. Later phases can add audit-log search, Kafka/S3 pipeline visibility, alerting, and cost signals.

**Tech Stack:** Next.js 16, React 19, TanStack Query, shadcn/base-ui components, API Center protected admin routes, Redis or existing API Center runtime storage for short-window counters, Confluent/Kafka audit events for longer-term analytics.

---

## Scope

This plan is for the local/private `apicenter-management` console and the API Center admin/runtime endpoints needed to power it.

Auth is intentionally out of scope for now. Keep the management app local/private until admin auth exists.

## Current Starting Point

The management UI already has:

- Registry list/detail pages.
- Shared-service setup for `gauth`, `geo`, `paymongo`, `email`, `sms`, `otp`.
- Dependency map derived from `ServiceRegistryEntry.consumes`.
- Dashboard summary cards.
- Readiness checks.
- Contract tester.
- Server-side local proxy routes under `/api/local/*`.

The registry data can answer:

- Which tribe declares that it consumes which shared service.
- Which shared service has registered consumers.
- Which dependencies are broken because the target service does not exist.

The registry data cannot answer:

- How many times a tribe actually called a shared service.
- Latency, error rate, last-used timestamp, or cost-driving usage.
- Route-level usage volume.

Those require API Center runtime instrumentation.

## Data Model

### Declared Usage

Declared usage is derived from registry manifests:

```ts
type DeclaredSharedServiceUsage = {
  tribeServiceId: string;
  tribeName: string;
  sharedServiceId: string;
  sharedServiceName: string;
  declared: boolean;
  sharedServiceRegistered: boolean;
};
```

Source:

```ts
ServiceRegistryEntry.consumes.includes(sharedService.serviceId)
```

### Runtime Usage

Runtime usage is counted by API Center when it proxies shared-service traffic:

```ts
type SharedServiceRuntimeUsage = {
  tribeServiceId: string;
  sharedServiceId: string;
  route: string;
  window: "1h" | "24h" | "7d" | "30d";
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  errorRate: number;
  avgLatencyMs: number;
  p95LatencyMs?: number;
  lastUsedAt?: string;
};
```

Suggested Redis key shape for short-window counters:

```text
api-center:usage:shared:{windowStart}:{tribeServiceId}:{sharedServiceId}
api-center:usage:shared-route:{windowStart}:{tribeServiceId}:{sharedServiceId}:{routeHash}
```

Keep Redis usage bounded with TTL:

```text
1h buckets: TTL 48 hours
24h buckets: TTL 45 days
```

Long-term analytics should come from Kafka/S3/PowerBI, not Redis.

---

## Phase 1: Declared Shared-Service Usage

**Outcome:** The app shows which tribes are configured to use which shared services, without backend changes.

**Files:**

- Create: `src/lib/shared-service-usage.ts`
- Create: `src/components/shared-service-usage-matrix.tsx`
- Create: `src/app/shared-services/usage/page.tsx`
- Modify: `src/components/app-shell.tsx`
- Modify: `src/app/shared-services/page.tsx`
- Test manually with: `http://localhost:3002/shared-services/usage`

### Tasks

- [x] Add `getDeclaredSharedServiceUsage` helper.

Implementation shape:

```ts
import type { ServiceRegistryEntry } from "@/lib/schemas";

export function getDeclaredSharedServiceUsage(
  services: ServiceRegistryEntry[],
) {
  const tribes = services.filter(
    (service) => (service.serviceType ?? "tribe") === "tribe",
  );
  const sharedServices = services.filter(
    (service) => service.serviceType === "shared",
  );
  const sharedIds = new Set(sharedServices.map((service) => service.serviceId));

  return tribes.map((tribe) => ({
    tribe,
    declaredSharedServices: tribe.consumes.filter((serviceId) =>
      sharedIds.has(serviceId),
    ),
    missingSharedServices: tribe.consumes.filter((serviceId) =>
      ["gauth", "geo", "paymongo", "email", "sms", "otp"].includes(serviceId),
    ).filter((serviceId) => !sharedIds.has(serviceId)),
  }));
}
```

- [x] Add a matrix component.

The matrix should show:

- tribe name and service ID
- columns for `gauth`, `geo`, `paymongo`, `email`, `sms`, `otp`
- green check when declared and registered
- amber warning when declared but shared service is missing from registry
- muted dash when not declared

- [x] Add `/shared-services/usage` page.

The page should:

- call `listServices()` using TanStack Query
- render the matrix
- show summary cards:
  - total tribes
  - total declared shared-service links
  - most consumed shared service
  - missing shared-service registrations

- [x] Add navigation entry.

Place under the existing Shared services area:

```text
Shared usage
```

- [x] Link from `/shared-services`.

Add a secondary action:

```text
View usage matrix
```

- [x] Verify.

Run:

```powershell
npm run lint
npm run build
```

Open:

```text
http://localhost:3002/shared-services/usage
```

Expected:

- The page loads with no console overlay.
- Tribes and shared-service declarations are visible.
- No runtime usage columns are shown yet.

- [x] Commit.

```powershell
git add src/lib/shared-service-usage.ts src/components/shared-service-usage-matrix.tsx src/app/shared-services/usage/page.tsx src/components/app-shell.tsx src/app/shared-services/page.tsx
git commit -m "Add declared shared-service usage matrix"
```

---

## Phase 2: API Center Runtime Usage Counters

**Implementation Status:** Implemented in `api-center` on 2026-05-14. The
deployment step still needs to be run against the target GKE environment before
the live management UI can show runtime rows from production traffic.

**Outcome:** API Center counts actual shared-service calls by tribe and shared service.

**Files in `api-center`:**

- Modify proxy route handling for `/api/v1/shared/:serviceId/*`
- Create or modify a usage metrics service, for example `src/analytics/shared-service-usage.service.ts`
- Create admin endpoint, for example `GET /api/v1/analytics/shared-service-usage`
- Add tests beside the API Center analytics/proxy modules

### Tasks

- [x] Identify where API Center resolves the calling tribe.

Runtime usage counts need a stable `tribeServiceId`. Prefer the authenticated token/client metadata already used by API Center. Do not trust a browser-provided tribe ID header unless API Center signs or validates it.

- [x] Add usage recording after every shared-service proxy attempt.

Record:

```ts
{
  tribeServiceId,
  sharedServiceId,
  route,
  method,
  status,
  ok,
  latencyMs,
  timestamp
}
```

Record both success and failure. Failed attempts are observability data.

- [x] Store short-window counters.

For Redis:

```text
HINCRBY api-center:usage:shared:2026-05-13T14:00:00Z:campusone:paymongo totalRequests 1
HINCRBY api-center:usage:shared:2026-05-13T14:00:00Z:campusone:paymongo successRequests 1
HSET api-center:usage:shared:2026-05-13T14:00:00Z:campusone:paymongo lastUsedAt 2026-05-13T14:03:22.000Z
EXPIRE api-center:usage:shared:2026-05-13T14:00:00Z:campusone:paymongo 3888000
```

If Redis is not appropriate for this in API Center, use the same storage mechanism already used for registry/runtime state.

- [ ] Publish audit event.

Keep emitting events to Kafka:

```text
api-center.tribe.request
api-center.tribe.response
api-center.gateway.error
api-center.audit.log
```

Add or reuse an event type:

```json
{
  "type": "shared_service.call",
  "tribeServiceId": "campusone",
  "sharedServiceId": "paymongo",
  "route": "/payments",
  "status": 200,
  "latencyMs": 123,
  "timestamp": "2026-05-13T14:03:22.000Z"
}
```

- [x] Add protected admin endpoint.

Endpoint:

```text
GET /api/v1/analytics/shared-service-usage?window=24h
```

Response:

```json
{
  "success": true,
  "data": [
    {
      "tribeServiceId": "campusone",
      "sharedServiceId": "paymongo",
      "window": "24h",
      "totalRequests": 428,
      "successRequests": 421,
      "failedRequests": 7,
      "errorRate": 0.016,
      "avgLatencyMs": 146,
      "lastUsedAt": "2026-05-13T14:03:22.000Z"
    }
  ],
  "meta": {
    "window": "24h",
    "timestamp": "2026-05-13T14:05:00.000Z"
  }
}
```

- [x] Add API Center tests.

Minimum test cases:

- successful shared-service proxy increments total and success
- failed shared-service proxy increments total and failed
- endpoint rejects missing platform admin secret
- endpoint returns zero rows when no usage exists

- [ ] Deploy API Center.

After tests pass:

```powershell
npm run lint
npm test
npm run build
```

Then use the existing API Center deployment flow.

- [x] Commit API Center changes.

```powershell
git add .
git commit -m "Add shared-service runtime usage analytics"
```

---

## Phase 3: Runtime Usage In Management UI

**Implementation Status:** Implemented in `apicenter-management` on
2026-05-14. The UI gracefully falls back to registry-only usage if the live API
Center deployment does not expose `/api/v1/analytics/shared-service-usage` yet.

**Outcome:** The management app shows actual call counts beside declared usage.

**Files:**

- Modify: `src/lib/schemas.ts`
- Modify: `src/lib/api-center-client.ts`
- Create: `src/app/api/local/analytics/shared-service-usage/route.ts`
- Modify: `src/lib/query-keys.ts`
- Modify: `src/components/shared-service-usage-matrix.tsx`
- Modify: `src/app/shared-services/usage/page.tsx`

### Tasks

- [x] Add schema.

Add:

```ts
export const sharedServiceUsageWindowSchema = z.enum([
  "1h",
  "24h",
  "7d",
  "30d",
]);

export const sharedServiceRuntimeUsageSchema = z.object({
  tribeServiceId: z.string(),
  sharedServiceId: z.string(),
  window: sharedServiceUsageWindowSchema,
  totalRequests: z.number(),
  successRequests: z.number(),
  failedRequests: z.number(),
  errorRate: z.number(),
  avgLatencyMs: z.number(),
  p95LatencyMs: z.number().optional(),
  lastUsedAt: z.string().optional(),
});

export const sharedServiceRuntimeUsageResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(sharedServiceRuntimeUsageSchema),
  meta: z
    .object({
      window: sharedServiceUsageWindowSchema.optional(),
      timestamp: z.string().optional(),
    })
    .optional(),
});
```

- [x] Add local proxy route.

Route:

```text
src/app/api/local/analytics/shared-service-usage/route.ts
```

Implementation:

```ts
import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const window = url.searchParams.get("window") ?? "24h";

  return apiCenterAdminRequest(
    `/api/v1/analytics/shared-service-usage?window=${encodeURIComponent(window)}`,
  );
}
```

- [x] Add client fetcher.

Add:

```ts
export async function getSharedServiceRuntimeUsage(window = "24h") {
  const data = await request<unknown>(
    `/api/local/analytics/shared-service-usage?window=${encodeURIComponent(window)}`,
  );

  return sharedServiceRuntimeUsageResponseSchema.parse(data).data;
}
```

- [x] Add query key.

```ts
sharedServiceUsage: (window: string) =>
  ["shared-services", "usage", window] as const,
```

- [x] Extend matrix component.

Matrix cell should show:

```text
428 calls
1.6% errors
146ms avg
```

State rules:

- green: declared and used successfully
- amber: declared but zero calls
- red: runtime calls but not declared in `consumes`
- red: high error rate
- muted: not declared and no runtime usage

- [x] Add window selector.

Options:

```text
1h
24h
7d
30d
```

Default: `24h`.

- [x] Verify.

Run:

```powershell
npm run lint
npm run build
```

Open:

```text
http://localhost:3002/shared-services/usage
```

Expected:

- Declared matrix still works if runtime endpoint returns empty data.
- Runtime metrics appear when API Center returns them.
- Endpoint errors show an actionable warning, not a blank page.

- [x] Commit.

```powershell
git add src/lib/schemas.ts src/lib/api-center-client.ts src/lib/query-keys.ts src/app/api/local/analytics/shared-service-usage/route.ts src/components/shared-service-usage-matrix.tsx src/app/shared-services/usage/page.tsx
git commit -m "Show shared-service runtime usage"
```

---

## Phase 4: Tribe Observability Page

**Implementation Status:** Implemented in `apicenter-management` on
2026-05-14. The panel uses service-level runtime usage from API Center; route
breakdown can be added later if API Center starts returning per-route buckets.

**Outcome:** Each tribe detail page becomes an observability surface, not only a registry manifest page.

**Files:**

- Modify: `src/components/service-detail-client.tsx`
- Create: `src/components/tribe-observability-panel.tsx`
- Reuse: shared-service runtime usage fetcher from Phase 3

### Tasks

- [x] Add `TribeObservabilityPanel`.

The panel should show:

- shared services declared by this tribe
- shared services actually used in selected window
- undeclared runtime usage
- failed calls
- last used timestamps

- [x] Add service-level runtime table.

Columns:

```text
Shared service
Route
Calls
Errors
Avg latency
Last used
Declared?
```

- [x] Add panel to service detail page only for tribe services.

Do not show this panel for shared services.

- [x] Verify.

Open a tribe detail page:

```text
http://localhost:3002/tribes/{tribeId}
```

Expected:

- Observability panel appears for tribe services.
- Shared-service detail pages do not show tribe-only panels.

- [x] Commit.

```powershell
git add src/components/tribe-observability-panel.tsx src/components/service-detail-client.tsx
git commit -m "Add tribe observability panel"
```

---

## Phase 5: Shared Service Detail Analytics

**Implementation Status:** Implemented in `apicenter-management` on
2026-05-14.

**Outcome:** Each shared service page shows consumers, usage, failures, and operational risk.

**Files:**

- Modify: `src/components/service-detail-client.tsx`
- Create: `src/components/shared-service-observability-panel.tsx`

### Tasks

- [x] Add `SharedServiceObservabilityPanel`.

The panel should show:

- consuming tribes
- runtime callers
- total calls by window
- error rate
- avg latency
- last used
- undeclared callers

- [x] Add risk cards.

Risk cards:

- `Declared but unused`
- `Used but not declared`
- `High error rate`
- `No health path`
- `No owner`

- [x] Add to service detail page only for shared services.

- [x] Verify with known services:

```text
/tribes/gauth
/tribes/geo
/tribes/paymongo
/tribes/email
/tribes/sms
/tribes/otp
```

Expected:

- Shared services show analytics.
- Tribe services continue showing tribe observability.

- [x] Commit.

```powershell
git add src/components/shared-service-observability-panel.tsx src/components/service-detail-client.tsx
git commit -m "Add shared-service observability panel"
```

---

## Phase 6: Gateway Traffic Dashboard

**Implementation Status:** Implemented across `api-center` and
`apicenter-management` on 2026-05-14.

**Outcome:** Dashboard shows API Center traffic health, not only registry health.

**API Center Endpoint:**

```text
GET /api/v1/analytics/gateway-traffic?window=24h
```

**Management UI Files:**

- Create: `src/app/api/local/analytics/gateway-traffic/route.ts`
- Create: `src/components/gateway-traffic-summary.tsx`
- Modify: `src/components/dashboard-client.tsx`

### Metrics

Show:

- total proxy requests
- tribe-to-tribe requests
- tribe-to-shared requests
- 4xx responses
- 5xx responses
- Kafka publish failures
- readiness failures
- p95 latency

### Tasks

- [x] Add API Center gateway analytics endpoint.
- [x] Add local proxy route.
- [x] Add schema and client fetcher.
- [x] Add dashboard cards.
- [x] Add warning state when Kafka publish failures > 0.
- [x] Add warning state when readiness failures > 0.
- [x] Verify lint/build.
- [x] Commit.

```powershell
git commit -m "Add gateway traffic summary"
```

---

## Phase 7: Audit Log Viewer

**Implementation Status:** Implemented across `api-center` and
`apicenter-management` on 2026-05-14. The API Center route is
`/api/v1/analytics/audit/events`.

**Outcome:** Operators can inspect recent registry and runtime events without going directly to logs.

**API Center Endpoint:**

```text
GET /api/v1/analytics/audit/events?limit=100&serviceId=&type=
```

**Management UI Files:**

- Create: `src/app/audit/page.tsx`
- Create: `src/components/audit-log-client.tsx`
- Create: `src/app/api/local/audit/events/route.ts`
- Modify: `src/components/app-shell.tsx`

### Events

Display:

- service registered
- service activated
- service deprecated
- service retired
- service deregistered
- shared service called
- shared service failed
- Kafka publish failed
- readiness failed

### Tasks

- [x] Add audit nav item.
- [x] Add filterable audit table.
- [x] Add event type badges.
- [x] Link service IDs to detail pages.
- [x] Keep event payload collapsed by default.
- [x] Verify lint/build.
- [x] Commit.

```powershell
git commit -m "Add audit log viewer"
```

---

## Phase 8: Cost And Provider Usage

**Implementation Status:** Baseline provider usage implemented across
`api-center` and `apicenter-management` on 2026-05-14. The current endpoint
groups shared-service runtime counters by provider/service. Exact provider
operation counters, such as OTP issue versus verify or PayMongo webhook versus
checkout, still require provider runtimes to emit those event names.

**Outcome:** The console highlights usage that can drive cloud/provider cost.

**Data Sources:**

- Runtime shared-service usage counters.
- Optional provider-specific counters emitted by shared services.
- Cloud billing stays outside this app unless an authenticated billing integration is later approved.

### Provider Signals

Track:

- `geo`: Google Maps calls
- `email`: Resend sends
- `sms`: SMS sends
- `paymongo`: checkout/payment calls and webhook volume
- `otp`: OTP issue/verify counts and rate-limit hits
- `gauth`: OAuth starts/callbacks/failures

### UI

Create:

```text
/cost
```

Show:

- top cost-driving shared services
- calls by provider
- tribes with high usage
- rate-limit hits
- failed provider calls

### Tasks

- [ ] Add provider usage event names in shared-service runtimes.
- [x] Add API Center admin endpoint for provider usage summary.
- [x] Add management UI cost page.
- [ ] Add dashboard warning card for spikes after provider runtimes emit richer counters.
- [x] Verify lint/build.
- [x] Commit.

```powershell
git commit -m "Add provider usage insights"
```

---

## Phase 9: Alerting And Operational Readiness

**Implementation Status:** Implemented across `api-center` and
`apicenter-management` on 2026-05-14. Alerts are read-only until admin auth and
acknowledgement ownership are added.

**Outcome:** The management layer can show actionable alerts and later forward them to email/Slack/Teams.

### Alert Rules

Initial rules:

- shared-service error rate > 5% over 1h
- Kafka publish failures > 0 over 1h
- readiness failures > 0 over 1h
- undeclared shared-service runtime usage detected
- shared service has consumers but no health path
- tribe has no owner/contact
- PayMongo webhook failures > 0
- OTP rate-limit hits exceed threshold

### UI

Add:

```text
/alerts
```

Show:

- active alerts
- severity
- affected service
- recommended fix
- first seen / last seen
- acknowledgement state if backend supports it

### Tasks

- [x] Add alert summary endpoint in API Center.
- [x] Add local proxy route.
- [x] Add alerts page.
- [x] Add dashboard alert strip.
- [x] Keep alerts read-only until auth exists.
- [x] Verify lint/build.
- [x] Commit.

```powershell
git commit -m "Add operational alerts view"
```

---

## Recommended Execution Order

1. Phase 1: declared shared-service usage matrix.
2. Phase 2: API Center runtime usage counters.
3. Phase 3: runtime usage in management UI.
4. Phase 4 and Phase 5: tribe/shared-service observability detail panels.
5. Phase 6: gateway traffic dashboard.
6. Phase 7: audit log viewer.
7. Phase 8: provider usage/cost signals.
8. Phase 9: alerts.

## Deployment Notes

- Phase 1 can ship immediately because it only uses registry data.
- Phase 2 must be deployed in API Center before Phase 3 can show real runtime counts.
- Phase 3 should gracefully handle a missing analytics endpoint.
- Do not expose this app publicly until admin auth is implemented.
- Keep `API_CENTER_PLATFORM_ADMIN_SECRET` server-only.

## Verification Checklist

Every phase must pass:

```powershell
npm run lint
npm run build
```

For UI phases, capture desktop and mobile screenshots:

```powershell
& 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' --headless=new --disable-gpu --disable-crash-reporter --no-first-run --user-data-dir='C:\tmp\edge-apic-check' --window-size=1440,1000 --screenshot='C:\tmp\apicenter-check.png' 'http://localhost:3002/'
```

Manual checks:

- no horizontal overflow on mobile
- no Next.js dev error overlay
- errors show actionable messages
- runtime analytics missing state is clear
- registry-only analytics still works without backend metrics
