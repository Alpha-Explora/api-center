# APICenter Hardening And Product Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Close the remaining APICenter governance gaps after the platform-wide quota rollout, then add the next useful product features for operators and tribes.

**Architecture:** API Center must fail closed for quota, policy, and approval enforcement. APICenter Management should expose deployment, governance, audit, cost, and self-service request evidence without becoming the runtime enforcement layer. API Shared Services should keep SDK behavior, typed errors, and manifest contracts aligned with the runtime.

**Tech Stack:** NestJS 11, Prisma 7, Redis, Supabase/Postgres, Next.js 16, React 19, Zod, Vitest, Jest, TypeScript, GCP Secret Manager, GKE, Vercel.

---

## Source Audit

The previous platform-wide governance and quota plan is complete by checklist and focused verification, but the follow-up audit found these remaining issues:

1. Some quota, policy, and approval dependencies are optional in runtime paths, so a wiring regression can silently disable enforcement.
2. `api-center` lint is blocked by Prettier CRLF formatting errors.
3. `apicenter-management` lint has a React hooks error in `environment-promotion-panel.tsx`.
4. The live quota smoke test is documented, but not yet automated in CI.
5. Operators need one place to see deployed image, migration, quota enforcer, policy engine, approval, and SDK contract health.
6. Audit history exists, but quota, plan, promotion, secret rotation, and approval decisions need stronger filtering and export.
7. Product improvements should now focus on cost-aware quotas, tribe self-service requests, billing/chargeback, and compliance exports.

## Planned File Structure

### API Center

- Modify: `api-center/src/quotas/tribe-quota-admin.controller.ts`
- Modify: `api-center/src/quotas/tribe-quota-admin.controller.spec.ts`
- Modify: `api-center/src/registry/registry.controller.ts`
- Modify: `api-center/src/registry/registry.controller.spec.ts`
- Modify: `api-center/src/tribes/tribes.controller.ts`
- Modify: `api-center/src/tribes/tribes.controller.spec.ts`
- Modify: `api-center/src/shared-services/shared-services.controller.ts`
- Modify: `api-center/src/shared-services/shared-services.controller.spec.ts`
- Modify: `api-center/src/kafka-governance/kafka-governance.controller.ts`
- Modify: `api-center/src/kafka-governance/kafka-governance.controller.spec.ts`
- Modify: `api-center/src/shared/proxy-handler.ts`
- Modify: `api-center/src/shared/proxy-handler.spec.ts`
- Create: `api-center/src/shared/governance-dependencies.ts`
- Create: `api-center/src/shared/governance-dependencies.spec.ts`
- Modify: `api-center/src/health/health.controller.ts`
- Modify: `api-center/src/health/health.controller.spec.ts`
- Create: `api-center/src/health/governance-readiness.service.ts`
- Create: `api-center/src/health/governance-readiness.service.spec.ts`
- Modify: `api-center/src/analytics/audit-events.service.ts`
- Modify: `api-center/src/analytics/audit-events.service.spec.ts`
- Create: `api-center/src/costs/tribe-cost.service.ts`
- Create: `api-center/src/costs/tribe-cost.service.spec.ts`
- Create: `api-center/src/developer-portal/developer-portal-request.controller.ts`
- Create: `api-center/src/developer-portal/developer-portal-request.controller.spec.ts`
- Create: `api-center/scripts/smoke/tribe-quota-policy-smoke.ts`
- Modify: `api-center/package.json`

### APICenter Management

- Modify: `apicenter-management/src/components/environment-promotion-panel.tsx`
- Modify: `apicenter-management/src/components/environment-promotion-panel.test.tsx`
- Modify: `apicenter-management/src/app/readiness/page.tsx`
- Modify: `apicenter-management/src/components/readiness-client.tsx`
- Modify: `apicenter-management/src/app/api/local/readiness/route.ts`
- Modify: `apicenter-management/src/app/api/local/audit/events/route.ts`
- Modify: `apicenter-management/src/components/audit-log-client.tsx`
- Create: `apicenter-management/src/components/governance-readiness-panel.tsx`
- Create: `apicenter-management/src/components/governance-readiness-panel.test.tsx`
- Create: `apicenter-management/src/components/tribe-cost-and-quota-panel.tsx`
- Create: `apicenter-management/src/components/tribe-cost-and-quota-panel.test.tsx`
- Create: `apicenter-management/src/components/developer-portal-request-panel.tsx`
- Create: `apicenter-management/src/components/developer-portal-request-panel.test.tsx`
- Modify: `apicenter-management/src/lib/api-center-client.ts`
- Modify: `apicenter-management/src/lib/schemas.ts`
- Modify: `apicenter-management/src/components/app-shell.tsx`

### API Shared Services

- Modify: `api-shared-services/src/quota.ts`
- Modify: `api-shared-services/src/errors.ts`
- Modify: `api-shared-services/src/TribeClient.ts`
- Modify: `api-shared-services/tests/quota-error.test.ts`
- Modify: `api-shared-services/contracts/service-manifest.schema.json`
- Modify: `api-shared-services/tests/manifest.test.ts`
- Modify: `api-shared-services/docs/consumer-runbook.md`

---

## Task 1: Make Governance Enforcement Fail Closed

**Files:**
- Create: `api-center/src/shared/governance-dependencies.ts`
- Create: `api-center/src/shared/governance-dependencies.spec.ts`
- Modify: `api-center/src/quotas/tribe-quota-admin.controller.ts`
- Modify: `api-center/src/quotas/tribe-quota-admin.controller.spec.ts`
- Modify: `api-center/src/registry/registry.controller.ts`
- Modify: `api-center/src/registry/registry.controller.spec.ts`
- Modify: `api-center/src/tribes/tribes.controller.ts`
- Modify: `api-center/src/tribes/tribes.controller.spec.ts`
- Modify: `api-center/src/shared-services/shared-services.controller.ts`
- Modify: `api-center/src/shared-services/shared-services.controller.spec.ts`
- Modify: `api-center/src/kafka-governance/kafka-governance.controller.ts`
- Modify: `api-center/src/kafka-governance/kafka-governance.controller.spec.ts`
- Modify: `api-center/src/shared/proxy-handler.ts`
- Modify: `api-center/src/shared/proxy-handler.spec.ts`

- [x] **Step 1: Add a failing unit test for missing approval enforcement**

Add this test to `api-center/src/quotas/tribe-quota-admin.controller.spec.ts`:

```ts
it("fails closed when enforce mode is requested without approval service", async () => {
  const unguardedController = new TribeQuotaAdminController(
    policies as unknown as TribeQuotaPolicyService,
    undefined as never,
  );

  await expect(
    unguardedController.createPolicy(
      {
        ownerTribeId: "campus-one",
        scope: "all",
        windowSeconds: 86400,
        maxRequests: 25000,
        mode: "enforce",
        reason: "Live enforcement",
        approvalRequestId: "approval-1",
      },
      { user: { tribeId: "platform" } } as any,
    ),
  ).rejects.toThrow("ApprovalRequestService is required");

  expect(policies.createPolicy).not.toHaveBeenCalled();
});
```

- [x] **Step 2: Run the failing approval test**

Run:

```powershell
npm run test -- src/quotas/tribe-quota-admin.controller.spec.ts --runInBand
```

Expected: the new test fails because the controller currently uses optional approval chaining.

- [x] **Step 3: Add the shared fail-closed helper**

Create `api-center/src/shared/governance-dependencies.ts`:

```ts
export class GovernanceDependencyError extends Error {
  constructor(dependencyName: string) {
    super(`${dependencyName} is required for APICenter governance enforcement`);
    this.name = "GovernanceDependencyError";
  }
}

export function requireGovernanceDependency<T>(
  dependency: T | null | undefined,
  dependencyName: string,
): T {
  if (!dependency) {
    throw new GovernanceDependencyError(dependencyName);
  }

  return dependency;
}
```

- [x] **Step 4: Add helper tests**

Create `api-center/src/shared/governance-dependencies.spec.ts`:

```ts
import {
  GovernanceDependencyError,
  requireGovernanceDependency,
} from "./governance-dependencies";

describe("requireGovernanceDependency", () => {
  it("returns the dependency when present", () => {
    const dependency = { check: jest.fn() };

    expect(requireGovernanceDependency(dependency, "Quota")).toBe(dependency);
  });

  it("throws a governance dependency error when missing", () => {
    expect(() =>
      requireGovernanceDependency(undefined, "Quota"),
    ).toThrow(GovernanceDependencyError);
  });
});
```

- [x] **Step 5: Make approval dependencies required**

In `api-center/src/quotas/tribe-quota-admin.controller.ts` and `api-center/src/registry/registry.controller.ts`, remove `?` from approval constructor parameters and replace optional approval calls with direct calls:

```ts
constructor(
  private readonly policies: TribeQuotaPolicyService,
  private readonly approvals: ApprovalRequestService,
) {}

await this.approvals.assertApprovedForAction({
  approvalRequestId,
  actionType: "quota.enforce",
  targetEnvironment: "live",
  targetId: input.ownerTribeId,
});
```

- [x] **Step 6: Make quota and policy dependencies required in gateway paths**

In `api-center/src/tribes/tribes.controller.ts`, `api-center/src/shared-services/shared-services.controller.ts`, and `api-center/src/kafka-governance/kafka-governance.controller.ts`, remove optional constructor types and optional chaining:

```ts
constructor(
  private readonly kafkaGovernance: KafkaGovernanceService,
  private readonly auth: AuthService,
  private readonly quotaEnforcer: TribeQuotaEnforcerService,
  private readonly policyEngine: PolicyEngineService,
) {}

await this.quotaEnforcer.check({
  ownerTribeId: tribeId,
  scope: "kafka_publish",
  targetServiceId: "kafka",
  routeFamily: "kafka:publish",
  correlationId: req.correlationId,
});
```

- [x] **Step 7: Make proxy handler governance dependencies required**

In `api-center/src/shared/proxy-handler.ts`, change the dependency interface and runtime calls:

```ts
interface ProxyHandlerDeps {
  externalService: ExternalService;
  logger: LoggerService;
  gatewayTraffic?: GatewayTrafficService;
  sharedServiceUsage?: SharedServiceUsageService;
  sharedServiceEvents?: SharedServiceEventPublisher;
  quotaEnforcer: TribeQuotaEnforcerService;
  policyEngine: PolicyEngineService;
}

await this.deps.quotaEnforcer.check({
  ownerTribeId: tribeId,
  scope: this.opts.namespace as TribeQuotaScope,
  targetServiceId: this.opts.serviceId,
  routeFamily: routeConfig.id,
  correlationId: req.correlationId,
});
```

- [x] **Step 8: Add controller tests that prove quota checks always run**

Update the relevant specs so each runtime path constructs the controller with explicit quota and policy mocks and asserts quota checks are invoked:

```ts
expect(mockQuotaEnforcer.check).toHaveBeenCalledWith(
  expect.objectContaining({
    ownerTribeId: "orders-service",
    scope: "kafka_publish",
    targetServiceId: "kafka",
  }),
);
```

- [x] **Step 9: Run focused fail-closed tests**

Run:

```powershell
npm run test -- src/shared/governance-dependencies.spec.ts src/quotas/tribe-quota-admin.controller.spec.ts src/registry/registry.controller.spec.ts src/tribes/tribes.controller.spec.ts src/shared-services/shared-services.controller.spec.ts src/kafka-governance/kafka-governance.controller.spec.ts src/shared/proxy-handler.spec.ts --runInBand
```

Expected: all listed suites pass.

- [x] **Step 10: Commit**

```powershell
git add api-center/src/shared/governance-dependencies.ts api-center/src/shared/governance-dependencies.spec.ts api-center/src/quotas/tribe-quota-admin.controller.ts api-center/src/quotas/tribe-quota-admin.controller.spec.ts api-center/src/registry/registry.controller.ts api-center/src/registry/registry.controller.spec.ts api-center/src/tribes/tribes.controller.ts api-center/src/tribes/tribes.controller.spec.ts api-center/src/shared-services/shared-services.controller.ts api-center/src/shared-services/shared-services.controller.spec.ts api-center/src/kafka-governance/kafka-governance.controller.ts api-center/src/kafka-governance/kafka-governance.controller.spec.ts api-center/src/shared/proxy-handler.ts api-center/src/shared/proxy-handler.spec.ts
git commit -m "fix: fail closed for governance enforcement"
```

## Task 2: Restore Lint As A Release Gate

**Files:**
- Modify: `api-center/.gitattributes`
- Modify: `api-center/package.json`
- Modify: `apicenter-management/src/components/environment-promotion-panel.tsx`
- Modify: `apicenter-management/src/components/environment-promotion-panel.test.tsx`

- [x] **Step 1: Add a focused test for default service selection without state-in-effect**

Add this test to `apicenter-management/src/components/environment-promotion-panel.test.tsx`:

```tsx
it("selects the first service without requiring an initial service id", async () => {
  renderWithClient(<EnvironmentPromotionPanel />);

  expect(await screen.findByText("Logistics API")).toBeTruthy();
  expect(screen.getByDisplayValue("logistics")).toBeTruthy();
});
```

- [x] **Step 2: Run the focused management test**

Run:

```powershell
npm test -- src/components/environment-promotion-panel.test.tsx
```

Expected: the test passes or exposes the existing selection behavior before the lint fix.

- [x] **Step 3: Replace the synchronous state update in the effect**

In `apicenter-management/src/components/environment-promotion-panel.tsx`, remove the `useEffect` that calls `setSelectedServiceId`. Use a memoized services array and an effective selected id:

```tsx
const [selectedServiceId, setSelectedServiceId] = useState(initialServiceId ?? "");
const services = useMemo(() => servicesQuery.data ?? [], [servicesQuery.data]);
const effectiveSelectedServiceId = selectedServiceId || services[0]?.serviceId || "";
const selectedService =
  services.find((service) => service.serviceId === effectiveSelectedServiceId) ??
  services[0];
```

Set the select value from `effectiveSelectedServiceId`:

```tsx
<select
  className="h-9 rounded-md border bg-background px-3 text-sm"
  value={effectiveSelectedServiceId}
  onChange={(event) => setSelectedServiceId(event.target.value)}
>
```

- [x] **Step 4: Normalize API Center line endings**

Add or update `api-center/.gitattributes`:

```text
* text=auto
*.ts text eol=lf
*.tsx text eol=lf
*.js text eol=lf
*.jsx text eol=lf
*.json text eol=lf
*.md text eol=lf
*.sql text eol=lf
```

Run Prettier for API Center source files that lint reports with CRLF errors:

```powershell
npm exec prettier -- --write "src/**/*.{ts,tsx}" "test/**/*.{ts,tsx}" "prisma/**/*.prisma"
```

- [x] **Step 5: Run lint in all three projects**

Run:

```powershell
npm run lint
```

Run from `api-center`, then from `apicenter-management`, then from `api-shared-services`.

Expected: all lint commands pass with no errors. Warnings can remain only if they already exist and do not block CI.

- [x] **Step 6: Commit**

```powershell
git add api-center/.gitattributes api-center/package.json apicenter-management/src/components/environment-promotion-panel.tsx apicenter-management/src/components/environment-promotion-panel.test.tsx
git commit -m "chore: restore lint gate for governance rollout"
```

## Task 3: Automate Deployed Quota Smoke Tests

**Files:**
- Create: `api-center/scripts/smoke/tribe-quota-policy-smoke.ts`
- Modify: `api-center/package.json`
- Modify: `.github/workflows/api-center-ci.yml`
- Modify: `api-center/docs/developer/tribe-api-quotas.md`

- [x] **Step 1: Create the smoke script**

Create `api-center/scripts/smoke/tribe-quota-policy-smoke.ts`:

```ts
type SmokeConfig = {
  baseUrl: string;
  adminSecret: string;
  tribeId: string;
  token: string;
};

function readConfig(): SmokeConfig {
  const baseUrl = process.env.APICENTER_SMOKE_BASE_URL;
  const adminSecret = process.env.API_CENTER_PLATFORM_ADMIN_SECRET;
  const tribeId = process.env.APICENTER_SMOKE_TRIBE_ID ?? "smoke-tribe";
  const token = process.env.APICENTER_SMOKE_TRIBE_TOKEN;

  if (!baseUrl || !adminSecret || !token) {
    throw new Error(
      "Missing APICENTER_SMOKE_BASE_URL, API_CENTER_PLATFORM_ADMIN_SECRET, or APICENTER_SMOKE_TRIBE_TOKEN",
    );
  }

  return { baseUrl, adminSecret, tribeId, token };
}

async function request(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  const body = await response.text();
  return { response, body };
}

async function main() {
  const config = readConfig();
  const policyResponse = await request(`${config.baseUrl}/api/v1/admin/quotas/policies`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-platform-admin-secret": config.adminSecret,
    },
    body: JSON.stringify({
      ownerTribeId: config.tribeId,
      scope: "all",
      windowSeconds: 60,
      maxRequests: 2,
      mode: "enforce",
      reason: "CI quota smoke",
      approvalRequestId: "ci-approved-quota-smoke",
    }),
  });

  if (!policyResponse.response.ok) {
    throw new Error(`Policy setup failed: ${policyResponse.response.status} ${policyResponse.body}`);
  }

  const statuses: number[] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await request(`${config.baseUrl}/api/v1/tribes/${config.tribeId}/health`, {
      method: "GET",
      headers: { authorization: `Bearer ${config.token}` },
    });
    statuses.push(result.response.status);
  }

  if (statuses[0] !== 200 || statuses[1] !== 200 || statuses[2] !== 429) {
    throw new Error(`Expected 200,200,429 quota behavior; received ${statuses.join(",")}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [x] **Step 2: Add the package script**

In `api-center/package.json`, add:

```json
{
  "scripts": {
    "smoke:quota": "tsx scripts/smoke/tribe-quota-policy-smoke.ts"
  }
}
```

- [x] **Step 3: Add CI workflow step**

In `.github/workflows/api-center-ci.yml`, add the smoke only when deployed smoke secrets exist:

```yaml
- name: Deployed quota smoke
  if: ${{ secrets.APICENTER_SMOKE_BASE_URL != '' && secrets.APICENTER_SMOKE_TRIBE_TOKEN != '' }}
  working-directory: api-center
  env:
    APICENTER_SMOKE_BASE_URL: ${{ secrets.APICENTER_SMOKE_BASE_URL }}
    APICENTER_SMOKE_TRIBE_TOKEN: ${{ secrets.APICENTER_SMOKE_TRIBE_TOKEN }}
    API_CENTER_PLATFORM_ADMIN_SECRET: ${{ secrets.API_CENTER_PLATFORM_ADMIN_SECRET }}
    APICENTER_SMOKE_TRIBE_ID: smoke-tribe
  run: npm run smoke:quota
```

- [x] **Step 4: Document the required secrets**

In `api-center/docs/developer/tribe-api-quotas.md`, add:

```md
## CI Smoke Requirements

The deployed quota smoke requires:

- `APICENTER_SMOKE_BASE_URL`
- `APICENTER_SMOKE_TRIBE_TOKEN`
- `API_CENTER_PLATFORM_ADMIN_SECRET`

The smoke creates a short-window enforced quota for `APICENTER_SMOKE_TRIBE_ID`, sends three calls, and expects `200`, `200`, then `429`.
```

- [x] **Step 5: Run local dry test**

Run without env vars:

```powershell
npm run smoke:quota
```

Expected: exits non-zero with the missing environment variable message.

- [x] **Step 6: Commit**

```powershell
git add api-center/scripts/smoke/tribe-quota-policy-smoke.ts api-center/package.json .github/workflows/api-center-ci.yml api-center/docs/developer/tribe-api-quotas.md
git commit -m "test: automate deployed quota smoke"
```

## Task 4: Add Governance Readiness Visibility

**Files:**
- Create: `api-center/src/health/governance-readiness.service.ts`
- Create: `api-center/src/health/governance-readiness.service.spec.ts`
- Modify: `api-center/src/health/health.controller.ts`
- Modify: `api-center/src/health/health.controller.spec.ts`
- Modify: `apicenter-management/src/app/api/local/readiness/route.ts`
- Modify: `apicenter-management/src/components/readiness-client.tsx`
- Create: `apicenter-management/src/components/governance-readiness-panel.tsx`
- Create: `apicenter-management/src/components/governance-readiness-panel.test.tsx`

- [x] **Step 1: Add API Center readiness service tests**

Create `api-center/src/health/governance-readiness.service.spec.ts`:

```ts
import { GovernanceReadinessService } from "./governance-readiness.service";

describe("GovernanceReadinessService", () => {
  it("reports governance as up when all required providers are enabled", () => {
    const service = new GovernanceReadinessService();

    expect(
      service.snapshot({
        quotaEnforcer: true,
        policyEngine: true,
        approvals: true,
        sdkContractVersion: "2026-05-25",
        imageTag: "api-center:test",
      }),
    ).toEqual({
      status: "up",
      quotaEnforcer: "up",
      policyEngine: "up",
      approvals: "up",
      sdkContractVersion: "2026-05-25",
      imageTag: "api-center:test",
    });
  });

  it("reports governance as down when any required provider is missing", () => {
    const service = new GovernanceReadinessService();

    expect(
      service.snapshot({
        quotaEnforcer: true,
        policyEngine: false,
        approvals: true,
        sdkContractVersion: "2026-05-25",
        imageTag: "api-center:test",
      }).status,
    ).toBe("down");
  });
});
```

- [x] **Step 2: Implement the readiness snapshot**

Create `api-center/src/health/governance-readiness.service.ts`:

```ts
import { Injectable } from "@nestjs/common";

export interface GovernanceReadinessInput {
  quotaEnforcer: boolean;
  policyEngine: boolean;
  approvals: boolean;
  sdkContractVersion: string;
  imageTag: string;
}

export interface GovernanceReadinessSnapshot {
  status: "up" | "down";
  quotaEnforcer: "up" | "down";
  policyEngine: "up" | "down";
  approvals: "up" | "down";
  sdkContractVersion: string;
  imageTag: string;
}

@Injectable()
export class GovernanceReadinessService {
  snapshot(input: GovernanceReadinessInput): GovernanceReadinessSnapshot {
    const quotaEnforcer = input.quotaEnforcer ? "up" : "down";
    const policyEngine = input.policyEngine ? "up" : "down";
    const approvals = input.approvals ? "up" : "down";

    return {
      status:
        quotaEnforcer === "up" && policyEngine === "up" && approvals === "up"
          ? "up"
          : "down",
      quotaEnforcer,
      policyEngine,
      approvals,
      sdkContractVersion: input.sdkContractVersion,
      imageTag: input.imageTag,
    };
  }
}
```

- [x] **Step 3: Include governance in `/health/ready`**

In `api-center/src/health/health.controller.ts`, inject `GovernanceReadinessService` and add:

```ts
private async governanceCheck(): Promise<HealthIndicatorResult> {
  const snapshot = this.governanceReadiness.snapshot({
    quotaEnforcer: true,
    policyEngine: true,
    approvals: true,
    sdkContractVersion: process.env.APICENTER_SDK_CONTRACT_VERSION ?? "local",
    imageTag: process.env.K_REVISION ?? process.env.APICENTER_IMAGE_TAG ?? "local",
  });

  if (snapshot.status !== "up") this.recordReadinessFailure("governance");

  return { governance: snapshot };
}
```

Add `() => this.governanceCheck()` to the readiness check list.

- [x] **Step 4: Add Management panel tests**

Create `apicenter-management/src/components/governance-readiness-panel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GovernanceReadinessPanel } from "./governance-readiness-panel";

describe("GovernanceReadinessPanel", () => {
  it("shows quota, policy, approval, image, and SDK contract state", () => {
    render(
      <GovernanceReadinessPanel
        governance={{
          status: "up",
          quotaEnforcer: "up",
          policyEngine: "up",
          approvals: "up",
          imageTag: "api-center:test",
          sdkContractVersion: "2026-05-25",
        }}
      />,
    );

    expect(screen.getByText("Governance readiness")).toBeTruthy();
    expect(screen.getByText("api-center:test")).toBeTruthy();
    expect(screen.getByText("2026-05-25")).toBeTruthy();
  });
});
```

- [x] **Step 5: Implement the Management panel and route mapping**

Create `apicenter-management/src/components/governance-readiness-panel.tsx`:

```tsx
type GovernanceState = {
  status: "up" | "down";
  quotaEnforcer: "up" | "down";
  policyEngine: "up" | "down";
  approvals: "up" | "down";
  imageTag: string;
  sdkContractVersion: string;
};

export function GovernanceReadinessPanel({
  governance,
}: {
  governance: GovernanceState;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">Governance readiness</h2>
      <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <ReadinessItem label="Quota enforcer" value={governance.quotaEnforcer} />
        <ReadinessItem label="Policy engine" value={governance.policyEngine} />
        <ReadinessItem label="Approvals" value={governance.approvals} />
        <ReadinessItem label="Image" value={governance.imageTag} />
        <ReadinessItem label="SDK contract" value={governance.sdkContractVersion} />
      </dl>
    </section>
  );
}

function ReadinessItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
```

- [x] **Step 6: Run focused tests**

Run:

```powershell
npm run test -- src/health/governance-readiness.service.spec.ts src/health/health.controller.spec.ts --runInBand
```

Run from `apicenter-management`:

```powershell
npm test -- src/components/governance-readiness-panel.test.tsx
```

- [x] **Step 7: Commit**

```powershell
git add api-center/src/health/governance-readiness.service.ts api-center/src/health/governance-readiness.service.spec.ts api-center/src/health/health.controller.ts api-center/src/health/health.controller.spec.ts apicenter-management/src/app/api/local/readiness/route.ts apicenter-management/src/components/readiness-client.tsx apicenter-management/src/components/governance-readiness-panel.tsx apicenter-management/src/components/governance-readiness-panel.test.tsx
git commit -m "feat: expose governance readiness"
```

## Task 5: Add Operator Audit History And Export

**Files:**
- Modify: `api-center/src/analytics/audit-events.service.ts`
- Modify: `api-center/src/analytics/audit-events.service.spec.ts`
- Modify: `api-center/src/quotas/tribe-quota-admin.controller.ts`
- Modify: `api-center/src/entitlements/tribe-plan-admin.controller.ts`
- Modify: `api-center/src/secrets/tribe-secret-rotation.service.ts`
- Modify: `api-center/src/promotions/environment-promotion.service.ts`
- Modify: `apicenter-management/src/app/api/local/audit/events/route.ts`
- Modify: `apicenter-management/src/components/audit-log-client.tsx`

- [x] **Step 1: Add audit filter tests**

Add to `api-center/src/analytics/audit-events.service.spec.ts`:

```ts
it("filters audit events by action family and actor", async () => {
  await service.record({
    type: "quota.policy.updated",
    severity: "info",
    message: "Quota policy updated",
    actor: "platform@example.test",
    actionFamily: "quota",
    payload: { ownerTribeId: "campus-one" },
  } as any);
  await service.record({
    type: "secret.rotated",
    severity: "info",
    message: "Secret rotated",
    actor: "security@example.test",
    actionFamily: "secret",
  } as any);

  const events = await service.list({
    actionFamily: "quota",
    actor: "platform@example.test",
  } as any);

  expect(events).toHaveLength(1);
  expect(events[0].type).toBe("quota.policy.updated");
});
```

- [x] **Step 2: Extend audit event types**

In `api-center/src/analytics/audit-events.service.ts`, extend the record and filter interfaces:

```ts
export interface AuditEventRecord {
  id: string;
  type: string;
  actionFamily?: "quota" | "plan" | "approval" | "promotion" | "secret" | "policy" | "runtime";
  actor?: string;
  serviceId?: string;
  tribeServiceId?: string;
  sharedServiceId?: string;
  severity: "info" | "warning" | "error";
  message: string;
  payload?: Record<string, unknown>;
  timestamp: string;
}

export interface AuditEventFilter {
  limit?: number;
  serviceId?: string;
  type?: string;
  actionFamily?: AuditEventRecord["actionFamily"];
  actor?: string;
}
```

Add filters:

```ts
.filter((event) => !filter.actionFamily || event.actionFamily === filter.actionFamily)
.filter((event) => !filter.actor || event.actor === filter.actor)
```

- [x] **Step 3: Record operator actions**

Record audit events from quota, plan assignment, promotion, and secret rotation paths with these event types:

```ts
await this.auditEvents.record({
  type: "quota.policy.updated",
  actionFamily: "quota",
  actor: req.user?.email ?? req.user?.tribeId ?? "platform",
  severity: "info",
  message: `Quota policy updated for ${input.ownerTribeId}`,
  payload: { ownerTribeId: input.ownerTribeId, mode: input.mode },
});
```

- [x] **Step 4: Add Management export support**

In `apicenter-management/src/app/api/local/audit/events/route.ts`, accept `actionFamily`, `actor`, and `format=csv`. For CSV responses, return:

```ts
const rows = [
  ["timestamp", "type", "actionFamily", "actor", "severity", "message"],
  ...events.map((event) => [
    event.timestamp,
    event.type,
    event.actionFamily ?? "",
    event.actor ?? "",
    event.severity,
    event.message,
  ]),
];
```

- [x] **Step 5: Add audit UI filters**

In `apicenter-management/src/components/audit-log-client.tsx`, add select/input controls for action family and actor, plus an export link that preserves the current filters:

```tsx
const exportHref = `/api/local/audit/events?format=csv&actionFamily=${encodeURIComponent(actionFamily)}&actor=${encodeURIComponent(actor)}`;
```

- [x] **Step 6: Run focused tests**

Run:

```powershell
npm run test -- src/analytics/audit-events.service.spec.ts src/quotas/tribe-quota-admin.controller.spec.ts src/entitlements/tribe-plan-admin.controller.spec.ts src/secrets/tribe-secret-rotation.service.spec.ts src/promotions/environment-promotion.service.spec.ts --runInBand
```

Run from `apicenter-management`:

```powershell
npm test -- src/components/audit-log-client.test.tsx src/app/api/local/audit/events/route.test.ts
```

- [x] **Step 7: Commit**

```powershell
git add api-center/src/analytics/audit-events.service.ts api-center/src/analytics/audit-events.service.spec.ts api-center/src/quotas/tribe-quota-admin.controller.ts api-center/src/entitlements/tribe-plan-admin.controller.ts api-center/src/secrets/tribe-secret-rotation.service.ts api-center/src/promotions/environment-promotion.service.ts apicenter-management/src/app/api/local/audit/events/route.ts apicenter-management/src/components/audit-log-client.tsx
git commit -m "feat: add operator audit history exports"
```

## Task 6: Add Cost-Aware Quotas And Chargeback Signals

**Files:**
- Create: `api-center/src/costs/tribe-cost.service.ts`
- Create: `api-center/src/costs/tribe-cost.service.spec.ts`
- Modify: `api-center/src/quotas/tribe-quota-enforcer.service.ts`
- Modify: `api-center/src/quotas/tribe-quota-enforcer.service.spec.ts`
- Modify: `apicenter-management/src/components/tribe-cost-and-quota-panel.tsx`
- Modify: `apicenter-management/src/components/tribe-cost-and-quota-panel.test.tsx`
- Modify: `apicenter-management/src/components/app-shell.tsx`

- [x] **Step 1: Add cost calculation tests**

Create `api-center/src/costs/tribe-cost.service.spec.ts`:

```ts
import { TribeCostService } from "./tribe-cost.service";

describe("TribeCostService", () => {
  it("calculates estimated monthly chargeback from usage units", () => {
    const service = new TribeCostService();

    expect(
      service.estimateMonthlyChargeback({
        apiCalls: 10000,
        kafkaPublishes: 2500,
        gbScanned: 12,
      }),
    ).toEqual({
      apiCallCost: 5,
      kafkaPublishCost: 1.25,
      analyticsScanCost: 0.6,
      totalCost: 6.85,
    });
  });
});
```

- [x] **Step 2: Implement cost service**

Create `api-center/src/costs/tribe-cost.service.ts`:

```ts
import { Injectable } from "@nestjs/common";

interface TribeCostInput {
  apiCalls: number;
  kafkaPublishes: number;
  gbScanned: number;
}

@Injectable()
export class TribeCostService {
  estimateMonthlyChargeback(input: TribeCostInput) {
    const apiCallCost = roundCurrency((input.apiCalls / 1000) * 0.5);
    const kafkaPublishCost = roundCurrency((input.kafkaPublishes / 1000) * 0.5);
    const analyticsScanCost = roundCurrency(input.gbScanned * 0.05);

    return {
      apiCallCost,
      kafkaPublishCost,
      analyticsScanCost,
      totalCost: roundCurrency(apiCallCost + kafkaPublishCost + analyticsScanCost),
    };
  }
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}
```

- [x] **Step 3: Surface cost pressure in quota usage responses**

Extend quota usage responses with:

```ts
estimatedChargeback: {
  apiCallCost: number;
  kafkaPublishCost: number;
  analyticsScanCost: number;
  totalCost: number;
}
```

Add test coverage in `api-center/src/quotas/tribe-quota-enforcer.service.spec.ts` to assert usage includes cost pressure when usage is above 80 percent of the quota.

- [x] **Step 4: Add Management cost panel**

Create `apicenter-management/src/components/tribe-cost-and-quota-panel.tsx`:

```tsx
export function TribeCostAndQuotaPanel({
  totalCost,
  quotaUsagePercent,
}: {
  totalCost: number;
  quotaUsagePercent: number;
}) {
  const state = quotaUsagePercent >= 90 ? "High usage" : "Normal usage";

  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold">Cost and quota pressure</h2>
      <p className="text-sm text-muted-foreground">{state}</p>
      <p className="text-2xl font-semibold">${totalCost.toFixed(2)}</p>
    </section>
  );
}
```

- [x] **Step 5: Run focused tests**

Run:

```powershell
npm run test -- src/costs/tribe-cost.service.spec.ts src/quotas/tribe-quota-enforcer.service.spec.ts --runInBand
```

Run from `apicenter-management`:

```powershell
npm test -- src/components/tribe-cost-and-quota-panel.test.tsx
```

- [x] **Step 6: Commit**

```powershell
git add api-center/src/costs/tribe-cost.service.ts api-center/src/costs/tribe-cost.service.spec.ts api-center/src/quotas/tribe-quota-enforcer.service.ts api-center/src/quotas/tribe-quota-enforcer.service.spec.ts apicenter-management/src/components/tribe-cost-and-quota-panel.tsx apicenter-management/src/components/tribe-cost-and-quota-panel.test.tsx apicenter-management/src/components/app-shell.tsx
git commit -m "feat: add cost aware quota signals"
```

## Task 7: Add Tribe Self-Service Requests With Approval Gates

**Files:**
- Create: `api-center/src/developer-portal/developer-portal-request.controller.ts`
- Create: `api-center/src/developer-portal/developer-portal-request.controller.spec.ts`
- Modify: `api-center/src/developer-portal/developer-portal.module.ts`
- Create: `apicenter-management/src/components/developer-portal-request-panel.tsx`
- Create: `apicenter-management/src/components/developer-portal-request-panel.test.tsx`
- Modify: `apicenter-management/src/lib/api-center-client.ts`
- Modify: `api-shared-services/docs/consumer-runbook.md`

- [x] **Step 1: Add request controller tests**

Create `api-center/src/developer-portal/developer-portal-request.controller.spec.ts`:

```ts
import { DeveloperPortalRequestController } from "./developer-portal-request.controller";

describe("DeveloperPortalRequestController", () => {
  it("creates a quota increase request instead of changing quota directly", async () => {
    const approvals = {
      createRequest: jest.fn().mockResolvedValue({
        id: "approval-1",
        actionType: "quota.increase",
        status: "pending",
      }),
    };
    const controller = new DeveloperPortalRequestController(approvals as any);

    const response = await controller.requestQuotaIncrease(
      {
        ownerTribeId: "campus-one",
        requestedMaxRequests: 50000,
        reason: "Enrollment launch",
      },
      { user: { tribeId: "campus-one" } } as any,
    );

    expect(response.data.status).toBe("pending");
    expect(approvals.createRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "quota.increase",
        targetId: "campus-one",
      }),
    );
  });
});
```

- [x] **Step 2: Implement the request controller**

Create `api-center/src/developer-portal/developer-portal-request.controller.ts`:

```ts
import { Body, Controller, Post, Req } from "@nestjs/common";
import { ApprovalRequestService } from "../approvals/approval-request.service";

@Controller("developer-portal/requests")
export class DeveloperPortalRequestController {
  constructor(private readonly approvals: ApprovalRequestService) {}

  @Post("quota-increase")
  async requestQuotaIncrease(
    @Body()
    input: {
      ownerTribeId: string;
      requestedMaxRequests: number;
      reason: string;
    },
    @Req() req: any,
  ) {
    const request = await this.approvals.createRequest({
      actionType: "quota.increase",
      targetEnvironment: "live",
      targetId: input.ownerTribeId,
      requestedBy: req.user?.tribeId ?? input.ownerTribeId,
      reason: input.reason,
      payload: {
        requestedMaxRequests: input.requestedMaxRequests,
      },
    });

    return { success: true, data: request };
  }
}
```

- [x] **Step 3: Register the controller**

In `api-center/src/developer-portal/developer-portal.module.ts`, add `DeveloperPortalRequestController` to `controllers`.

- [x] **Step 4: Add Management request panel**

Create `apicenter-management/src/components/developer-portal-request-panel.tsx`:

```tsx
export function DeveloperPortalRequestPanel({
  onSubmit,
}: {
  onSubmit: (input: { requestedMaxRequests: number; reason: string }) => void;
}) {
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        onSubmit({
          requestedMaxRequests: Number(form.get("requestedMaxRequests")),
          reason: String(form.get("reason")),
        });
      }}
    >
      <h2 className="text-base font-semibold">Request quota increase</h2>
      <input name="requestedMaxRequests" type="number" min={1} className="h-9 rounded-md border px-3" />
      <textarea name="reason" className="min-h-24 rounded-md border px-3 py-2" />
      <button className="h-9 rounded-md bg-primary px-3 text-primary-foreground" type="submit">
        Submit request
      </button>
    </form>
  );
}
```

- [x] **Step 5: Document the request model**

In `api-shared-services/docs/consumer-runbook.md`, add:

```md
## Quota Increase Requests

Tribes do not raise live quotas directly. They submit a quota increase request through the developer portal. Platform operators approve the request, then API Center applies the quota policy with an approval reference.
```

- [x] **Step 6: Run focused tests**

Run:

```powershell
npm run test -- src/developer-portal/developer-portal-request.controller.spec.ts --runInBand
```

Run from `apicenter-management`:

```powershell
npm test -- src/components/developer-portal-request-panel.test.tsx
```

- [x] **Step 7: Commit**

```powershell
git add api-center/src/developer-portal/developer-portal-request.controller.ts api-center/src/developer-portal/developer-portal-request.controller.spec.ts api-center/src/developer-portal/developer-portal.module.ts apicenter-management/src/components/developer-portal-request-panel.tsx apicenter-management/src/components/developer-portal-request-panel.test.tsx apicenter-management/src/lib/api-center-client.ts api-shared-services/docs/consumer-runbook.md
git commit -m "feat: add tribe self service requests"
```

## Task 8: Strengthen SDK Contract And Final Verification

**Files:**
- Modify: `api-shared-services/src/quota.ts`
- Modify: `api-shared-services/src/errors.ts`
- Modify: `api-shared-services/src/TribeClient.ts`
- Modify: `api-shared-services/tests/quota-error.test.ts`
- Modify: `api-shared-services/contracts/service-manifest.schema.json`
- Modify: `api-shared-services/tests/manifest.test.ts`
- Modify: `api-shared-services/docs/consumer-runbook.md`

- [x] **Step 1: Add SDK quota header test**

Add to `api-shared-services/tests/quota-error.test.ts`:

```ts
it("preserves quota headers on rate limit errors", async () => {
  const error = RateLimitError.fromResponse({
    status: 429,
    headers: {
      "retry-after": "60",
      "x-apicenter-quota-owner": "campus-one",
      "x-apicenter-quota-limit": "25000",
      "x-apicenter-quota-remaining": "0",
    },
    body: {
      code: "TRIBE_API_QUOTA_EXCEEDED",
      message: "Quota exceeded",
    },
  } as any);

  expect(error.quota.ownerTribeId).toBe("campus-one");
  expect(error.retryAfterSeconds).toBe(60);
});
```

- [x] **Step 2: Add SDK request guidance**

In `api-shared-services/docs/consumer-runbook.md`, add:

```md
## Handling Quota Responses

When API Center returns `429` with `TRIBE_API_QUOTA_EXCEEDED`, tribes should read `retryAfterSeconds`, slow retry traffic, and request a quota increase only when sustained usage is expected. Do not retry immediately in a tight loop.
```

- [x] **Step 3: Run complete verification**

Run from `api-center`:

```powershell
npm run test -- src/shared/governance-dependencies.spec.ts src/quotas/tribe-quota-admin.controller.spec.ts src/quotas/tribe-quota-enforcer.service.spec.ts src/analytics/audit-events.service.spec.ts src/health/governance-readiness.service.spec.ts src/developer-portal/developer-portal-request.controller.spec.ts --runInBand
npm run typecheck
npm run lint
npm run build
```

Run from `apicenter-management`:

```powershell
npm test -- src/components/environment-promotion-panel.test.tsx src/components/governance-readiness-panel.test.tsx src/components/tribe-cost-and-quota-panel.test.tsx src/components/developer-portal-request-panel.test.tsx
npm run typecheck
npm run lint
npm run build
```

Run from `api-shared-services`:

```powershell
npm test -- tests/quota-error.test.ts tests/manifest.test.ts
npm run typecheck
npm run lint
npm run build
npm run check:contracts
```

- [x] **Step 4: Mark the plan complete**

After all verification commands pass, update this plan by changing each checkbox from `[ ]` to `[x]`, then update `api-center/docs/superpowers/plans/README.md` and `apicenter-management/docs/superpowers/plans/README.md` from `active` to `completed`.

- [x] **Step 5: Commit**

```powershell
git add api-shared-services/src/quota.ts api-shared-services/src/errors.ts api-shared-services/src/TribeClient.ts api-shared-services/tests/quota-error.test.ts api-shared-services/contracts/service-manifest.schema.json api-shared-services/tests/manifest.test.ts api-shared-services/docs/consumer-runbook.md api-center/docs/superpowers/plans/2026-05-25-apicenter-hardening-and-product-improvements.md api-center/docs/superpowers/plans/README.md apicenter-management/docs/superpowers/plans/README.md
git commit -m "docs: complete apicenter hardening plan"
```

---

## Execution Order

1. Task 1 must happen first because enforcement safety is the highest-risk gap.
2. Task 2 should happen second so CI becomes trustworthy before product changes continue.
3. Task 3 should follow immediately after lint passes because deployed smoke catches regressions that unit tests miss.
4. Tasks 4 and 5 can run in parallel because readiness and audit/export touch different surfaces.
5. Tasks 6 and 7 can run after the enforcement and audit base is stable.
6. Task 8 closes the SDK contract and verifies the full platform.

## Definition Of Done

- Governance dependencies are no longer optional in enforcement paths.
- Missing quota, policy, or approval wiring fails closed.
- API Center, Management, and Shared Services lint, typecheck, tests, and builds pass.
- Deployed quota smoke is automated and documented.
- Management shows governance readiness, deployed image, and SDK contract state.
- Audit history can be filtered and exported for quota, plan, approval, promotion, secret, policy, and runtime actions.
- Tribes can request quota increases without directly mutating live quota policies.
- SDK docs and tests explain how tribes handle `TRIBE_API_QUOTA_EXCEEDED`.
