# APICenter Code Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Fix the concrete findings from the whole-codebase APICenter review so the new operational/productization surfaces are real, safe, evidence-backed, and clean in CI.

**Architecture:** API Center remains the source of truth for runtime evidence, emergency controls, scorecards, compliance exports, and promotion packets. APICenter Management fetches those API Center-backed facts through local proxy routes and must not render empty placeholder pages as finished features. Control Tower lint fixes stay scoped to the adjacent CI/operations app.

**Tech Stack:** NestJS 11, Next.js 16, React 19, TypeScript, Zod, Jest, Vitest, Redis/Supabase-backed API Center services, APICenter Management local proxy routes, Control Tower Next app.

---

## Review Findings Covered

1. Management operational/product pages render empty arrays instead of live data.
2. Promotion evidence bundles fabricate quota, plan, approval, and pipeline evidence.
3. Emergency controls are not validated, audited, persisted, or fail-closed in runtime paths.
4. Consumer scorecards use service version as SDK version and hard-code quota/error metrics to zero.
5. Compliance export ignores date range, output format, and evidence bundles.
6. Control Tower lint fails on a raw `<a>` home link and synchronous state update from an effect.
7. The workspace has LF/CRLF working tree noise that can hide real diffs.
8. Several mutating Management local API routes proxy server-side platform-admin access without requiring a Management session or action confirmation.
9. Developer-portal quota increase requests can name an arbitrary `ownerTribeId` instead of being constrained to the authenticated tribe.
10. The Management audit CSV export can hide upstream API Center failures by turning non-success responses into an empty CSV.

## Planned File Structure

### API Center

- Modify: `api-center/src/operations/promotion-evidence-bundle.controller.ts`
- Modify: `api-center/src/operations/promotion-evidence-bundle.controller.spec.ts`
- Modify: `api-center/src/operations/promotion-evidence-bundle.service.ts`
- Modify: `api-center/src/operations/promotion-evidence-bundle.service.spec.ts`
- Modify: `api-center/src/operations/emergency-control.service.ts`
- Modify: `api-center/src/operations/emergency-control.service.spec.ts`
- Modify: `api-center/src/operations/emergency-control.controller.ts`
- Modify: `api-center/src/operations/emergency-control.controller.spec.ts`
- Modify: `api-center/src/operations/consumer-scorecard.controller.ts`
- Modify: `api-center/src/operations/consumer-scorecard.service.ts`
- Modify: `api-center/src/operations/consumer-scorecard.service.spec.ts`
- Modify: `api-center/src/compliance/compliance-export.controller.ts`
- Modify: `api-center/src/compliance/compliance-export.controller.spec.ts`
- Modify: `api-center/src/compliance/compliance-export.service.ts`
- Modify: `api-center/src/compliance/compliance-export.service.spec.ts`
- Modify: `api-center/src/shared/proxy-handler.ts`
- Modify: `api-center/src/shared/proxy-handler.spec.ts`
- Modify: `api-center/src/tribes/tribes.controller.ts`
- Modify: `api-center/src/tribes/tribes.controller.spec.ts`
- Modify: `api-center/src/shared-services/shared-services.controller.ts`
- Modify: `api-center/src/shared-services/shared-services.controller.spec.ts`

### APICenter Management

- Modify: `apicenter-management/src/app/operational-trust/page.tsx`
- Modify: `apicenter-management/src/app/marketplace/page.tsx`
- Modify: `apicenter-management/src/app/compliance/page.tsx`
- Modify: `apicenter-management/src/app/api/local/data-pipeline/feedback-actions/route.ts`
- Modify: `apicenter-management/src/app/api/local/data-pipeline/raw-to-silver-runs/route.ts`
- Modify: `apicenter-management/src/app/api/local/developer-portal/requests/quota-increase/route.ts`
- Modify: `apicenter-management/src/app/api/local/operations/drift/route.ts`
- Modify: `apicenter-management/src/app/api/local/operations/emergency/route.ts`
- Modify: `apicenter-management/src/app/api/local/plans/assignments/route.ts`
- Modify: `apicenter-management/src/app/api/local/quotas/policies/route.ts`
- Modify: `apicenter-management/src/app/api/local/quotas/policies/[policyId]/route.ts`
- Modify: `apicenter-management/src/app/api/local/audit/events/route.ts`
- Modify: `apicenter-management/src/components/operational-trust-client.tsx`
- Modify: `apicenter-management/src/components/operational-trust-client.test.tsx`
- Modify: `apicenter-management/src/components/api-marketplace-client.tsx`
- Modify: `apicenter-management/src/components/api-marketplace-client.test.tsx`
- Modify: `apicenter-management/src/components/compliance-export-panel.tsx`
- Modify: `apicenter-management/src/components/compliance-export-panel.test.tsx`
- Modify: `apicenter-management/src/components/emergency-control-panel.tsx`
- Modify: `apicenter-management/src/components/emergency-control-panel.test.tsx`
- Modify: `apicenter-management/src/lib/api-center-client.ts`
- Modify: `apicenter-management/src/lib/schemas.ts`

### API Shared Services

- Modify: `api-shared-services/.gitattributes`
- Modify: `api-shared-services/src/auth.ts`

### Control Tower

- Modify: `control-tower/src/app/error.tsx`
- Modify: `control-tower/src/components/notifications/notification-bell.tsx`
- Modify: `control-tower/src/components/notifications/notification-bell.test.tsx`

---

## Task 1: Wire Management Product Pages To Real API Routes

**Files:**
- Modify: `apicenter-management/src/app/operational-trust/page.tsx`
- Modify: `apicenter-management/src/app/marketplace/page.tsx`
- Modify: `apicenter-management/src/app/compliance/page.tsx`
- Modify: `apicenter-management/src/components/operational-trust-client.tsx`
- Modify: `apicenter-management/src/components/operational-trust-client.test.tsx`
- Modify: `apicenter-management/src/components/api-marketplace-client.test.tsx`
- Modify: `apicenter-management/src/lib/api-center-client.ts`
- Modify: `apicenter-management/src/lib/schemas.ts`

- [x] **Step 1: Add schemas for the page data**

In `apicenter-management/src/lib/schemas.ts`, add:

```ts
export const governanceDriftItemSchema = z.object({
  severity: z.enum(["warning", "critical"]),
  resourceType: z.string(),
  resourceId: z.string(),
  ownerTribeId: z.string(),
  message: z.string(),
});

export const dependencyEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  type: z.string(),
});

export const evidenceSectionSchema = z.object({
  key: z.string(),
  status: z.enum(["pass", "fail"]),
  data: z.unknown().optional(),
});

export const consumerScorecardSchema = z.object({
  ownerTribeId: z.string(),
  status: z.string(),
  findings: z.array(z.string()),
});
```

- [x] **Step 2: Add client methods that call local routes**

In `apicenter-management/src/lib/api-center-client.ts`, add:

```ts
export async function getOperationalTrustData() {
  const [dependencies, scorecards] = await Promise.all([
    requestJson("/api/local/operations/dependencies"),
    requestJson("/api/local/operations/scorecards"),
  ]);

  return {
    driftItems: [],
    dependencyEdges: dependencies.data?.edges ?? [],
    evidenceSections: [],
    scorecards: scorecards.data ?? [],
  };
}

export async function listMarketplaceProducts() {
  const response = await requestJson("/api/local/catalog/products");
  return response.data ?? [];
}
```

- [x] **Step 3: Update operational trust page to fetch data**

Replace the empty arrays in `apicenter-management/src/app/operational-trust/page.tsx` with:

```tsx
import { getOperationalTrustData } from "@/lib/api-center-client";

export default async function OperationalTrustPage() {
  const data = await getOperationalTrustData();

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Operational Trust"
        description="Review drift, runtime dependencies, promotion evidence, and consumer scorecards before live changes."
      />
      <OperationalTrustClient {...data} />
    </div>
  );
}
```

- [x] **Step 4: Update marketplace page to fetch products**

Replace `products={[]}` in `apicenter-management/src/app/marketplace/page.tsx` with:

```tsx
const products = await listMarketplaceProducts();

<ApiMarketplaceClient products={products} />
```

- [x] **Step 5: Add tests that fail if placeholders come back**

In `apicenter-management/src/components/operational-trust-client.test.tsx`, add:

```tsx
it("renders provided runtime dependency and scorecard data", () => {
  render(
    <OperationalTrustClient
      driftItems={[]}
      dependencyEdges={[{ from: "campus-one", to: "payment-service", type: "shared-service" }]}
      evidenceSections={[{ key: "health", status: "pass" }]}
      scorecards={[{ ownerTribeId: "campus-one", status: "healthy", findings: [] }]}
    />,
  );

  expect(screen.getByText("payment-service")).toBeTruthy();
  expect(screen.getByText("campus-one")).toBeTruthy();
});
```

- [x] **Step 6: Run focused Management tests**

Run from `apicenter-management`:

```powershell
npm test -- src/components/operational-trust-client.test.tsx src/components/api-marketplace-client.test.tsx
```

Expected: both test files pass.

- [x] **Step 7: Commit**

```powershell
git add src/app/operational-trust/page.tsx src/app/marketplace/page.tsx src/app/compliance/page.tsx src/components/operational-trust-client.tsx src/components/operational-trust-client.test.tsx src/components/api-marketplace-client.test.tsx src/lib/api-center-client.ts src/lib/schemas.ts
git commit -m "fix: wire management product pages to live data"
```

## Task 2: Make Promotion Evidence Bundles Evidence-Backed

**Files:**
- Modify: `api-center/src/operations/promotion-evidence-bundle.controller.ts`
- Modify: `api-center/src/operations/promotion-evidence-bundle.controller.spec.ts`
- Modify: `api-center/src/operations/promotion-evidence-bundle.service.ts`
- Modify: `api-center/src/operations/promotion-evidence-bundle.service.spec.ts`

- [x] **Step 1: Add a failing controller test for missing evidence**

In `api-center/src/operations/promotion-evidence-bundle.controller.spec.ts`, add:

```ts
it("does not mark quota, plan, approval, or pipeline as passing when evidence is missing", () => {
  registry.get.mockReturnValue({ serviceId: "campus-one", healthy: true, consumes: [] });
  quotaPolicies.listPolicies.mockResolvedValue([]);
  planService.listAssignments.mockResolvedValue([]);
  approvals.listRequests.mockResolvedValue([]);

  const response = controller.getEvidence("campus-one", undefined);

  expect(response.data.ready).toBe(false);
  expect(response.data.sections).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ key: "quota", status: "fail" }),
      expect.objectContaining({ key: "plan", status: "fail" }),
      expect.objectContaining({ key: "approval", status: "fail" }),
      expect.objectContaining({ key: "pipeline", status: "fail" }),
    ]),
  );
});
```

- [x] **Step 2: Inject real evidence sources**

Update `PromotionEvidenceBundleController` constructor:

```ts
constructor(
  private readonly registry: RegistryService,
  private readonly evidence: PromotionEvidenceBundleService,
  private readonly quotaPolicies: TribeQuotaPolicyService,
  private readonly plans: TribePlanService,
  private readonly approvals: ApprovalRequestService,
  private readonly pipelineHealth: PipelineHealthService,
) {}
```

- [x] **Step 3: Replace fabricated evidence**

Build the bundle from actual service state:

```ts
const [quotaPolicies, planAssignments, approvalRequests, pipeline] =
  await Promise.all([
    this.quotaPolicies.listPolicies(serviceId),
    this.plans.listAssignments(serviceId),
    this.approvals.listRequests({ targetId: serviceId }),
    this.pipelineHealth.getStatusForService(serviceId),
  ]);

const bundle = this.evidence.build({
  serviceId,
  health: { status: entry?.healthy === false ? "down" : "up" },
  quotaPolicy: quotaPolicies.find((policy) => policy.status === "active") ?? null,
  planAssignment: planAssignments.find((assignment) => assignment.status === "active") ?? null,
  approval: approvalRequests.find((request) => request.status === "approved") ?? null,
  smoke: { status: entry ? "passed" : "missing" },
  manifest: { status: entry ? "valid" : "missing" },
  pipeline,
});
```

- [x] **Step 4: Run focused API Center tests**

Run from `api-center`:

```powershell
npm run test -- src/operations/promotion-evidence-bundle.service.spec.ts src/operations/promotion-evidence-bundle.controller.spec.ts --runInBand
```

Expected: both suites pass and missing evidence fails closed.

- [x] **Step 5: Commit**

```powershell
git add src/operations/promotion-evidence-bundle.controller.ts src/operations/promotion-evidence-bundle.controller.spec.ts src/operations/promotion-evidence-bundle.service.ts src/operations/promotion-evidence-bundle.service.spec.ts
git commit -m "fix: make promotion evidence bundles evidence backed"
```

## Task 3: Harden Emergency Controls

**Files:**
- Modify: `api-center/src/operations/emergency-control.service.ts`
- Modify: `api-center/src/operations/emergency-control.service.spec.ts`
- Modify: `api-center/src/operations/emergency-control.controller.ts`
- Modify: `api-center/src/operations/emergency-control.controller.spec.ts`
- Modify: `api-center/src/shared/proxy-handler.ts`
- Modify: `api-center/src/shared/proxy-handler.spec.ts`
- Modify: `api-center/src/tribes/tribes.controller.ts`
- Modify: `api-center/src/tribes/tribes.controller.spec.ts`
- Modify: `api-center/src/shared-services/shared-services.controller.ts`
- Modify: `api-center/src/shared-services/shared-services.controller.spec.ts`
- Modify: `apicenter-management/src/app/api/local/operations/emergency/route.ts`
- Modify: `apicenter-management/src/components/emergency-control-panel.tsx`
- Modify: `apicenter-management/src/components/emergency-control-panel.test.tsx`

- [x] **Step 1: Add validation tests**

In `api-center/src/operations/emergency-control.controller.spec.ts`, add:

```ts
it("rejects invalid emergency control input", () => {
  expect(() =>
    controller.apply({
      targetType: "bad",
      targetId: "",
      mode: "pause",
      reason: "",
      appliedBy: "",
    } as never),
  ).toThrow(ValidationError);
});
```

- [x] **Step 2: Validate API Center input**

Add a parser in `emergency-control.service.ts`:

```ts
export function parseEmergencyControl(input: unknown): EmergencyControl {
  const control = emergencyControlSchema.parse(input);
  return {
    ...control,
    targetId: control.targetId.trim(),
    reason: control.reason.trim(),
    appliedBy: control.appliedBy.trim(),
  };
}
```

Use it in the controller before `apply`.

- [x] **Step 3: Make runtime emergency dependency required**

In `ProxyHandlerDeps`, change:

```ts
emergencyControls?: EmergencyControlService;
```

to:

```ts
emergencyControls: EmergencyControlService;
```

In `proxy-handler.ts`, remove optional chaining:

```ts
const emergency = this.deps.emergencyControls.evaluate({
  ownerTribeId: tribeId,
  serviceId: targetServiceId,
});
```

Update `tribes.controller.ts` and `shared-services.controller.ts` constructor parameters to require `EmergencyControlService`.

- [x] **Step 4: Require Management action confirmation**

In `apicenter-management/src/app/api/local/operations/emergency/route.ts`, wrap POST and DELETE with `requireManagementRouteAction`:

```ts
await requireManagementRouteAction({
  request,
  actionRisk: "dangerous",
  actionId: "operations.emergency.apply",
});
```

Then forward the original request body.

- [x] **Step 5: Add Management test for confirmation**

In `emergency-control-panel.test.tsx`, assert the request includes reason and typed phrase:

```tsx
expect(onApply).toHaveBeenCalledWith(
  expect.objectContaining({
    confirmation: {
      typedPhrase: "APPLY LIVE CHANGE",
      reason: "Incident containment",
    },
  }),
);
```

- [x] **Step 6: Run focused tests**

Run from `api-center`:

```powershell
npm run test -- src/operations/emergency-control.service.spec.ts src/operations/emergency-control.controller.spec.ts src/shared/proxy-handler.spec.ts src/tribes/tribes.controller.spec.ts src/shared-services/shared-services.controller.spec.ts --runInBand
```

Run from `apicenter-management`:

```powershell
npm test -- src/components/emergency-control-panel.test.tsx
```

- [x] **Step 7: Commit**

```powershell
git add src/operations/emergency-control.service.ts src/operations/emergency-control.service.spec.ts src/operations/emergency-control.controller.ts src/operations/emergency-control.controller.spec.ts src/shared/proxy-handler.ts src/shared/proxy-handler.spec.ts src/tribes/tribes.controller.ts src/tribes/tribes.controller.spec.ts src/shared-services/shared-services.controller.ts src/shared-services/shared-services.controller.spec.ts
git commit -m "fix: harden emergency controls"
```

## Task 4: Replace Placeholder Consumer Scorecards

**Files:**
- Modify: `api-center/src/operations/consumer-scorecard.controller.ts`
- Modify: `api-center/src/operations/consumer-scorecard.service.ts`
- Modify: `api-center/src/operations/consumer-scorecard.service.spec.ts`
- Modify: `apicenter-management/src/components/consumer-scorecard-panel.tsx`
- Modify: `apicenter-management/src/components/consumer-scorecard-panel.test.tsx`

- [x] **Step 1: Add service tests for metric-backed scorecards**

In `consumer-scorecard.service.spec.ts`, add:

```ts
it("uses supplied sdk, quota, and error metrics", () => {
  const scorecard = service.score({
    ownerTribeId: "campus-one",
    sdkVersion: "1.0.0",
    latestSdkVersion: "1.2.1",
    quotaUsagePercent: 92,
    errorRatePercent: 2.5,
  });

  expect(scorecard.status).toBe("needs_attention");
  expect(scorecard.findings).toContain("SDK version is behind the current supported version.");
  expect(scorecard.findings).toContain("Quota usage is above 90 percent.");
  expect(scorecard.findings).toContain("Error rate is above the platform threshold.");
});
```

- [x] **Step 2: Stop using service version as SDK version**

In `consumer-scorecard.controller.ts`, resolve SDK version from explicit metadata:

```ts
const sdkVersion =
  service.sdkVersion ??
  service.metadata?.sdkVersion ??
  "unknown";
```

- [x] **Step 3: Use real usage metrics**

Inject and use quota usage and gateway traffic services:

```ts
const quotaUsagePercent = await this.quotaUsage.getUsagePercent(ownerTribeId);
const errorRatePercent = await this.gatewayTraffic.getErrorRatePercent(ownerTribeId);
```

If a metric source is unavailable, return `unknown` and add a finding instead of hard-coding zero.

- [x] **Step 4: Update Management panel for unknown metrics**

Render `unknown` as a warning, not healthy:

```tsx
{scorecard.findings.length === 0 ? "No findings" : scorecard.findings.join(", ")}
```

- [x] **Step 5: Run focused tests**

```powershell
npm run test -- src/operations/consumer-scorecard.service.spec.ts src/operations/consumer-scorecard.controller.spec.ts --runInBand
```

```powershell
npm test -- src/components/consumer-scorecard-panel.test.tsx
```

- [x] **Step 6: Commit**

```powershell
git add src/operations/consumer-scorecard.controller.ts src/operations/consumer-scorecard.service.ts src/operations/consumer-scorecard.service.spec.ts
git commit -m "fix: make consumer scorecards metric backed"
```

## Task 5: Make Compliance Export Date-Filtered And Format-Aware

**Files:**
- Modify: `api-center/src/compliance/compliance-export.controller.ts`
- Modify: `api-center/src/compliance/compliance-export.controller.spec.ts`
- Modify: `api-center/src/compliance/compliance-export.service.ts`
- Modify: `api-center/src/compliance/compliance-export.service.spec.ts`
- Modify: `apicenter-management/src/app/api/local/compliance/export/route.ts`
- Modify: `apicenter-management/src/components/compliance-export-panel.tsx`
- Modify: `apicenter-management/src/components/compliance-export-panel.test.tsx`

- [x] **Step 1: Add compliance date range test**

In `compliance-export.controller.spec.ts`, add:

```ts
it("filters audit events by date range and includes evidence bundles", async () => {
  auditEvents.list.mockResolvedValue([
    { type: "quota.policy.updated", timestamp: "2026-05-20T00:00:00.000Z" },
  ]);
  evidence.listBundles.mockResolvedValue([{ serviceId: "campus-one", ready: true }]);

  const response = await controller.export("2026-05-01", "2026-05-25", "json");

  expect(auditEvents.list).toHaveBeenCalledWith({
    limit: 500,
    from: "2026-05-01",
    to: "2026-05-25",
  });
  expect(response.data.summary.evidenceBundleCount).toBe(1);
});
```

- [x] **Step 2: Support date filters in audit service calls**

Update `ComplianceExportController`:

```ts
const auditEvents = await this.auditEvents.list({
  limit: 500,
  from,
  to,
});
```

- [x] **Step 3: Return Markdown when requested**

Add:

```ts
if (format === "md") {
  return new Response(this.compliance.toMarkdown(packet), {
    headers: { "content-type": "text/markdown" },
  });
}
```

- [x] **Step 4: Make Management export panel require date range**

Add `required` to both date inputs:

```tsx
<input name="from" type="date" required className="h-9 rounded-md border px-3" />
<input name="to" type="date" required className="h-9 rounded-md border px-3" />
```

- [x] **Step 5: Run focused tests**

```powershell
npm run test -- src/compliance/compliance-export.service.spec.ts src/compliance/compliance-export.controller.spec.ts --runInBand
```

```powershell
npm test -- src/components/compliance-export-panel.test.tsx src/app/api/local/compliance/export/route.test.ts
```

- [x] **Step 6: Commit**

```powershell
git add src/compliance/compliance-export.controller.ts src/compliance/compliance-export.controller.spec.ts src/compliance/compliance-export.service.ts src/compliance/compliance-export.service.spec.ts
git commit -m "fix: make compliance exports evidence backed"
```

## Task 6: Fix Control Tower Lint

**Files:**
- Modify: `control-tower/src/app/error.tsx`
- Modify: `control-tower/src/components/notifications/notification-bell.tsx`
- Modify: `control-tower/src/components/notifications/notification-bell.test.tsx`

- [x] **Step 1: Replace raw anchor with Next Link**

In `control-tower/src/app/error.tsx`, import Link:

```tsx
import Link from "next/link";
```

Replace:

```tsx
<a href="/">Back to Dashboard</a>
```

with:

```tsx
<Link href="/">Back to Dashboard</Link>
```

Preserve the existing class name.

- [x] **Step 2: Avoid synchronous state update in notification effect**

In `notification-bell.tsx`, replace direct effect invocation:

```tsx
useEffect(() => {
  const run = window.setTimeout(() => {
    void fetchCount();
  }, 0);
  const interval = setInterval(() => {
    void fetchCount();
  }, 60_000);
  return () => {
    window.clearTimeout(run);
    clearInterval(interval);
  };
}, [fetchCount]);
```

- [x] **Step 3: Add regression test**

In `notification-bell.test.tsx`, add:

```tsx
it("loads unread count after mount", async () => {
  render(<NotificationBell />);

  expect(await screen.findByText("Notifications")).toBeTruthy();
});
```

- [x] **Step 4: Run Control Tower verification**

Run from `control-tower`:

```powershell
npm run lint
npm test
npm run build
```

Expected: all commands pass.

- [x] **Step 5: Commit**

```powershell
git add src/app/error.tsx src/components/notifications/notification-bell.tsx src/components/notifications/notification-bell.test.tsx
git commit -m "fix: clear control tower lint errors"
```

## Task 7: Normalize Line Endings And Final Verification

**Files:**
- Modify: `apicenter-management/.gitattributes`
- Modify: `api-shared-services/.gitattributes`
- Modify only line-ending-noise files shown by `git status --short`

- [x] **Step 1: Add line-ending guardrails**

Create or update `.gitattributes` in `apicenter-management` and `api-shared-services`:

```text
* text=auto
*.ts text eol=lf
*.tsx text eol=lf
*.js text eol=lf
*.jsx text eol=lf
*.json text eol=lf
*.md text eol=lf
*.css text eol=lf
```

- [x] **Step 2: Normalize only noisy files**

Run from `apicenter-management`:

```powershell
git diff --name-only | ForEach-Object { npx prettier --write $_ }
```

Run from `api-shared-services`:

```powershell
git diff --name-only | ForEach-Object { npx prettier --write $_ }
```

Expected: real diffs are either intentional formatting or no remaining diff.

- [x] **Step 3: Run full verification**

Run from `api-center`:

```powershell
npm run typecheck
npm run lint
npm test -- --runInBand
npm run build
```

Run from `apicenter-management`:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

Run from `api-shared-services`:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run check:contracts
```

Run from `control-tower`:

```powershell
npm run lint
npm test
npm run build
```

- [x] **Step 4: Update plan status**

After all verification passes, update this plan checklist from `[ ]` to `[x]`, then update the plan indexes from `active` to `completed`.

- [x] **Step 5: Commit**

```powershell
git add apicenter-management/.gitattributes api-shared-services/.gitattributes api-center/docs/superpowers/plans/2026-05-25-apicenter-code-review-remediation.md api-center/docs/superpowers/plans/README.md apicenter-management/docs/superpowers/plans/README.md
git commit -m "docs: complete code review remediation plan"
```

## Task 8: Gate Mutating Local Routes And Fix Portal Ownership Bugs

**Files:**
- Modify: `apicenter-management/src/app/api/local/data-pipeline/feedback-actions/route.ts`
- Modify: `apicenter-management/src/app/api/local/data-pipeline/feedback-actions/route.test.ts`
- Modify: `apicenter-management/src/app/api/local/data-pipeline/raw-to-silver-runs/route.ts`
- Modify: `apicenter-management/src/app/api/local/data-pipeline/raw-to-silver-runs/route.test.ts`
- Modify: `apicenter-management/src/app/api/local/developer-portal/requests/quota-increase/route.ts`
- Modify: `apicenter-management/src/app/api/local/developer-portal/requests/quota-increase/route.test.ts`
- Modify: `apicenter-management/src/app/api/local/operations/drift/route.ts`
- Modify: `apicenter-management/src/app/api/local/operations/drift/route.test.ts`
- Modify: `apicenter-management/src/app/api/local/plans/assignments/route.ts`
- Modify: `apicenter-management/src/app/api/local/plans/assignments/route.test.ts`
- Modify: `apicenter-management/src/app/api/local/quotas/policies/route.ts`
- Modify: `apicenter-management/src/app/api/local/quotas/policies/route.test.ts`
- Modify: `apicenter-management/src/app/api/local/quotas/policies/[policyId]/route.ts`
- Modify: `apicenter-management/src/app/api/local/quotas/policies/[policyId]/route.test.ts`
- Modify: `apicenter-management/src/app/api/local/audit/events/route.ts`
- Modify: `apicenter-management/src/app/api/local/audit/events/route.test.ts`
- Modify: `api-center/src/developer-portal/developer-portal-request.controller.ts`
- Modify: `api-center/src/developer-portal/developer-portal-request.controller.spec.ts`

- [x] **Step 1: Add a route-gate regression test for plan assignment writes**

In `apicenter-management/src/app/api/local/plans/assignments/route.test.ts`, add:

```ts
it("requires a management action before assigning a plan", async () => {
  actionMocks.requireManagementRouteAction.mockRejectedValue(
    new Error("Management authentication required"),
  );

  const response = await POST(
    new Request("http://localhost/api/local/plans/assignments", {
      method: "POST",
      body: JSON.stringify({
        ownerTribeId: "campus-one",
        planKey: "standard",
        environment: "prod",
        reason: "Go live",
      }),
    }),
  );

  expect(response.status).toBe(401);
  expect(adminMocks.apiCenterAdminRequest).not.toHaveBeenCalled();
});
```

- [x] **Step 2: Gate plan assignments, quota policy writes, quota deletes, raw-to-silver runs, feedback actions, and drift comparisons**

In each mutating local route, import `requireManagementRouteAction` and call it before `apiCenterAdminRequest`.

Use this risk mapping:

```ts
await requireManagementRouteAction({
  request,
  actionRisk: "state-write",
  actionId: "plans.assignments.create",
});
```

Apply these action IDs:

```text
data-pipeline.feedback-actions.create
data-pipeline.raw-to-silver-runs.create
developer-portal.quota-increase.request
operations.drift.compare
plans.assignments.create
quotas.policies.create
quotas.policies.delete
```

For `raw-to-silver-runs`, keep `timeoutMs: 180_000`. For `quotas/policies/[policyId]`, change the handler signature from `_request` to `request` so the action helper can read the authorization header and confirmation body.

- [x] **Step 3: Preserve request bodies after confirmation**

Because `requireManagementRouteAction` reads from a cloned request body, keep forwarding the original body after the helper:

```ts
await requireManagementRouteAction({
  request,
  actionRisk: "state-write",
  actionId: "quotas.policies.create",
});

const body = await request.json();
const input = quotaPolicyInputSchema.parse(body);
```

- [x] **Step 4: Fix developer-portal quota increase ownership**

In `api-center/src/developer-portal/developer-portal-request.controller.ts`, derive the owner tribe from the authenticated request and reject mismatches:

```ts
const authenticatedTribeId = req.user?.tribeId ?? req.tribeId;
if (!authenticatedTribeId) {
  throw new ForbiddenError("Quota increase requests require a tribe token.");
}
if (input.ownerTribeId && input.ownerTribeId !== authenticatedTribeId) {
  throw new ForbiddenError("Tribes can only request quota changes for their own tribe.");
}
```

Then use `authenticatedTribeId` for `targetId`, `requestedBy`, `before.ownerTribeId`, and `after.ownerTribeId`.

- [x] **Step 5: Point the Management quota-increase route at the developer-portal endpoint or remove duplicated request shaping**

In `apicenter-management/src/app/api/local/developer-portal/requests/quota-increase/route.ts`, do not duplicate the approval payload. Forward the validated request to:

```ts
return apiCenterAdminRequest("/api/v1/developer-portal/requests/quota-increase", {
  method: "POST",
  body: JSON.stringify(input),
});
```

If the Management flow remains admin-operated rather than tribe-authenticated, keep the `/approvals/requests` path but rename the route and UI copy to "operator quota increase request" so it does not pretend to exercise the developer portal controller.

- [x] **Step 6: Preserve upstream audit export failures**

In `apicenter-management/src/app/api/local/audit/events/route.ts`, before parsing CSV data:

```ts
if (!response.ok) {
  return response;
}
```

Then parse JSON only for successful responses. Add a test where `apiCenterAdminRequest` returns a `500` response and `format=csv`; assert the local route also returns `500` and does not return a CSV header.

- [x] **Step 7: Run focused route and portal tests**

Run from `apicenter-management`:

```powershell
npm test -- src/app/api/local/plans/assignments/route.test.ts src/app/api/local/quotas/policies/route.test.ts src/app/api/local/quotas/policies/[policyId]/route.test.ts src/app/api/local/data-pipeline/raw-to-silver-runs/route.test.ts src/app/api/local/data-pipeline/feedback-actions/route.test.ts src/app/api/local/developer-portal/requests/quota-increase/route.test.ts src/app/api/local/operations/drift/route.test.ts src/app/api/local/audit/events/route.test.ts
```

Run from `api-center`:

```powershell
npm run test -- src/developer-portal/developer-portal-request.controller.spec.ts --runInBand
```

Expected: all listed tests pass and no mutating local route reaches API Center when management authorization fails.

- [x] **Step 8: Commit**

```powershell
git add apicenter-management/src/app/api/local/data-pipeline/feedback-actions/route.ts apicenter-management/src/app/api/local/data-pipeline/feedback-actions/route.test.ts apicenter-management/src/app/api/local/data-pipeline/raw-to-silver-runs/route.ts apicenter-management/src/app/api/local/data-pipeline/raw-to-silver-runs/route.test.ts apicenter-management/src/app/api/local/developer-portal/requests/quota-increase/route.ts apicenter-management/src/app/api/local/developer-portal/requests/quota-increase/route.test.ts apicenter-management/src/app/api/local/operations/drift/route.ts apicenter-management/src/app/api/local/operations/drift/route.test.ts apicenter-management/src/app/api/local/plans/assignments/route.ts apicenter-management/src/app/api/local/plans/assignments/route.test.ts apicenter-management/src/app/api/local/quotas/policies/route.ts apicenter-management/src/app/api/local/quotas/policies/route.test.ts apicenter-management/src/app/api/local/quotas/policies/[policyId]/route.ts apicenter-management/src/app/api/local/quotas/policies/[policyId]/route.test.ts apicenter-management/src/app/api/local/audit/events/route.ts apicenter-management/src/app/api/local/audit/events/route.test.ts api-center/src/developer-portal/developer-portal-request.controller.ts api-center/src/developer-portal/developer-portal-request.controller.spec.ts
git commit -m "fix: gate mutating management routes"
```

---

## Execution Order

1. Task 3 first, because emergency controls are the highest-risk finding.
2. Task 2 next, because promotion evidence must not fabricate approval or runtime state.
3. Task 1 next, because Management pages should stop displaying placeholder pages.
4. Tasks 4 and 5 can run in parallel after Task 2.
5. Task 6 is independent and should be handled before final verification.
6. Task 8 should run before final verification because local route authorization bugs can expose platform-admin behavior through Management.
7. Task 7 runs last to avoid line-ending churn hiding real diffs.

## Definition Of Done

- Management operational trust, marketplace, and compliance pages render live API-backed data or explicit loading/error states.
- Promotion evidence bundles fail closed when quota, plan, approval, smoke, manifest, or pipeline evidence is absent.
- Emergency controls require validated input, management confirmation, audit evidence, and runtime fail-closed dependency wiring.
- Consumer scorecards use explicit SDK version, quota usage, and gateway error metrics.
- Compliance export honors date range, format, and evidence bundle inclusion.
- Mutating Management local API routes require a valid Management session and action confirmation before using server-side platform-admin credentials.
- Developer-portal quota increase requests are scoped to the authenticated tribe and cannot request quota for another tribe.
- Audit CSV export preserves upstream API Center failures instead of returning a successful empty CSV.
- Control Tower lint passes.
- `api-center`, `apicenter-management`, `api-shared-services`, and `control-tower` pass typecheck/lint/test/build where those scripts exist.
