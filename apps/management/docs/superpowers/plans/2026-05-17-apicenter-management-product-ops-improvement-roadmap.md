# API Center Management Product Ops Improvement Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `apicenter-management` from a capable local operator console into a safer, clearer, production-ready control plane for API Center operations.

**Architecture:** Keep API Center as the source of truth for registry, policy, analytics, and admin operations. Keep `apicenter-management` as a Next.js operator console that calls server-side `/api/local/*` route handlers so platform secrets stay server-only. Add auth, environment safety, guided workflows, deeper operational visibility, and release-quality validation in phases.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, TanStack Query, shadcn-style local UI components, Zod, Vitest/jsdom, API Center protected admin endpoints, Google Secret Manager, Confluent Cloud, GKE/Secret Manager readiness, optional Descope or Vercel-protected deployment.

---

## Current Surface

The current console already includes:

- Dashboard: `/`
- Registry: `/tribes`, `/tribes/new`, `/tribes/[tribeId]`, `/tribes/[tribeId]/edit`
- Readiness: `/readiness`
- Shared services: `/shared-services`, `/shared-services/setup`, `/shared-services/usage`
- Smoke tests: `/smoke-tests`
- Dependencies: `/dependencies`
- Manifest import/export: `/manifest-tools`
- Audit: `/audit`
- Cost signals: `/cost`
- Alerts: `/alerts`
- Settings: `/settings`

Current important implementation files:

- `C:\Codes\apic\apicenter-management\src\components\app-shell.tsx`
- `C:\Codes\apic\apicenter-management\src\components\dashboard-client.tsx`
- `C:\Codes\apic\apicenter-management\src\components\readiness-client.tsx`
- `C:\Codes\apic\apicenter-management\src\components\tribe-list-client.tsx`
- `C:\Codes\apic\apicenter-management\src\components\service-detail-client.tsx`
- `C:\Codes\apic\apicenter-management\src\components\shared-service-smoke-tests.tsx`
- `C:\Codes\apic\apicenter-management\src\components\shared-service-usage-matrix.tsx`
- `C:\Codes\apic\apicenter-management\src\components\alerts-client.tsx`
- `C:\Codes\apic\apicenter-management\src\lib\api-center-client.ts`
- `C:\Codes\apic\apicenter-management\src\lib\schemas.ts`
- `C:\Codes\apic\apicenter-management\src\app\api\local\**\route.ts`
- `C:\Codes\apic\apicenter-management\docs\operations\apicenter-management-runbook.md`

---

## Executive Recommendation

Recommended next direction:

1. Ship **operator safety and public-deploy readiness** first.
2. Then improve **workflow guidance** so operators do not jump between pages manually.
3. Then add **deeper diagnostics and event timelines**.
4. Then add **automation with approvals**, not fully autonomous destructive changes.
5. Then add **role-based collaboration and audit annotations**.

This order reduces the biggest risk first: the console can already mutate registry, secrets, Confluent topics, and smoke-test providers. Before making it more powerful, make it safer and clearer.

---

## Decision Matrix

| Decision | Option A | Option B | Recommendation |
| --- | --- | --- | --- |
| Hosting | Local-only operator app | Private deployed app with auth | Start local/private, move to deployed only after auth/RBAC |
| Auth | No auth, private machine only | Descope/admin RBAC | Add auth before any public deployment |
| Workflows | Keep page-based tools | Add guided operation flows | Add guided flows for onboarding, payment smoke, and S3 export |
| Automation | Manual operator steps | One-click guarded operations | Use guarded operations with dry-run, review, and confirmation |
| Observability | Separate usage/audit/alerts pages | Unified service timeline | Add service timeline while keeping expert pages |
| Secrets | Provision only | Secret status, rotation history, drift checks | Add non-secret status and drift checks; never show plaintext |
| Live operations | Same UI as test | Strong live-mode friction | Add live banners, typed confirmations, and action summaries |
| Tribe developer experience | Docs and SDK panel | Downloadable onboarding package | Add SDK env package and Postman/HTTP examples |

---

## Improvement Areas With Pros And Cons

### 1. Authentication And Authorization

**What:** Add login, role checks, and action-level authorization.

**Pros:**

- Required before public or wider internal deployment.
- Protects registry writes, secret provisioning, Confluent topic changes, and deployment restart actions.
- Makes audit logs meaningful because actions can be tied to a real operator.

**Cons:**

- Adds identity configuration and account-management overhead.
- Can slow local iteration if not designed with a development bypass.
- Needs role mapping decisions before it can be trusted.

**Decision point:** Use Descope/admin role now, or keep private/local only?

**Recommendation:** Add auth and RBAC before deploying publicly. Keep a local-only dev bypass controlled by `MANAGEMENT_AUTH_MODE=local-dev`.

### 2. Environment And Live-Mode Safety

**What:** Make test/live state impossible to miss and add stronger guards for live changes.

**Pros:**

- Reduces accidental production changes.
- Aligns with current test/live `.cmd` switch and readiness metadata.
- Makes live payment and subscription actions safer.

**Cons:**

- Adds more confirmation steps.
- Operators may find it slower for routine safe actions.

**Decision point:** Should live mode block all writes by default, or only high-risk writes?

**Recommendation:** Allow read-only live access by default. Require typed confirmation and reason for write actions in live.

### 3. Guided Operations

**What:** Add guided flows for common operator work instead of forcing manual navigation.

High-value flows:

- New tribe onboarding
- Shared-service setup
- Tribe secret rotation
- Payment subscription test rollout
- SDK-to-S3 export validation
- Service retirement/deprovisioning

**Pros:**

- Reduces missed steps.
- Turns existing runbook knowledge into UI.
- Improves handoff to another operator or developer.

**Cons:**

- Adds state management and branching UI.
- Flows can become stale if backend contracts change.

**Decision point:** Build one generic workflow engine or several explicit flow components?

**Recommendation:** Build explicit flow components first. Add a generic workflow engine only after three or more flows share the same state model.

### 4. Unified Service Timeline

**What:** Add a service detail timeline combining registry changes, smoke tests, gateway traffic, shared-service usage, audit events, alerts, secret status, and Confluent/S3 status.

**Pros:**

- Gives operators one place to answer "what happened to this service?"
- Reduces context switching between `/audit`, `/alerts`, `/shared-services/usage`, and detail pages.
- Helps debug failures faster.

**Cons:**

- Needs consistent event shapes.
- Can be noisy without filtering and severity grouping.

**Decision point:** Timeline per tribe only, per shared service only, or both?

**Recommendation:** Build a generic timeline component that accepts `serviceId` plus optional `sharedServiceId`, then use it on both tribe and shared-service detail surfaces.

### 5. Better Smoke Test UX

**What:** Turn smoke tests into repeatable suites with saved run results, correlations, and pass/fail summaries.

**Pros:**

- Makes smoke evidence durable.
- Supports release gates and handoffs.
- Helps compare safe vs provider-impacting runs.

**Cons:**

- Requires storing results somewhere or relying on API Center audit/analytics.
- Could accidentally encourage provider-impacting tests unless warnings remain strong.

**Decision point:** Store smoke results in management app, API Center, or not at all?

**Recommendation:** Store summarized smoke results in API Center audit/events or a management-specific admin endpoint later. For now, show a durable local result panel and copyable evidence block.

### 6. Secret And Config Drift Checks

**What:** Add non-secret checks that show whether expected Secret Manager records and runtime config exist.

**Pros:**

- Prevents "it works locally but not in GKE" confusion.
- Helps payment, SMS, email, gauth, geo, and OTP setup.
- Does not require exposing plaintext secrets.

**Cons:**

- Needs careful IAM permissions.
- Cannot verify value correctness without provider-level tests.

**Decision point:** Should the console read Secret Manager metadata only, or also secret payload keys?

**Recommendation:** Read metadata and JSON key names only. Never display values. Show `exists`, `latest enabled version`, `rotatedAt` when available, and required/missing key names.

### 7. Release And Deployment Visibility

**What:** Show deployed image tags, rollout status, and release verification for API Center and shared services.

**Pros:**

- Operators can see what is actually live.
- Reduces reliance on manual `kubectl` commands.
- Useful after Cloud Build and GKE rollouts.

**Cons:**

- Needs Kubernetes access from the environment running management.
- More dangerous if restart/rollback actions are added without auth.

**Decision point:** Read-only deployment visibility first, or restart/rollback controls too?

**Recommendation:** Add read-only visibility first. Keep restart controls guarded and admin-only.

### 8. Tribe Developer Handoff

**What:** Generate a tribe onboarding packet from the registered manifest.

Packet contents:

- SDK install command
- `.npmrc` snippet
- runtime env list
- allowed `consumes`
- required scopes
- smoke-test token instructions
- sample code for shared service calls
- sample governed Kafka publish
- S3 export validation checklist

**Pros:**

- Reduces repetitive explanation.
- Makes SDK adoption easier.
- Keeps platform/tribe responsibility split clear.

**Cons:**

- Must avoid including plaintext tribe secrets.
- Needs versioned docs if SDK changes.

**Decision point:** Generate Markdown only, or downloadable zip with `.env.example` and sample files?

**Recommendation:** Start with copyable Markdown and `.env.example`; add zip export later.

### 9. Quality Gates And Visual QA

**What:** Add repeatable route smoke, accessibility, and key UI tests.

**Pros:**

- Catches broken pages before deployment.
- Important because this app is a high-trust control plane.
- Helps prevent regressions across route-heavy UI.

**Cons:**

- Adds test maintenance.
- Browser tests can be brittle unless selectors are stable.

**Decision point:** Unit/component tests only, or Playwright route smoke too?

**Recommendation:** Keep Vitest for components and add a small Playwright route smoke once auth mode supports local bypass.

---

## Phase 1: Safety And Public-Deploy Readiness

**Goal:** Make the console safe enough to share beyond one trusted local operator.

### Task 1: Add Auth Mode Config

**Files:**

- Modify: `C:\Codes\apic\apicenter-management\.env.example`
- Modify: `C:\Codes\apic\apicenter-management\src\lib\schemas.ts`
- Create: `C:\Codes\apic\apicenter-management\src\lib\server\management-auth.ts`
- Modify: `C:\Codes\apic\apicenter-management\src\app\layout.tsx`
- Test: `C:\Codes\apic\apicenter-management\src\lib\server\management-auth.test.ts`

**Decision point:** Which auth provider should be used?

- Option A: Descope.
  - Pros: Already referenced in env and deployment gate docs.
  - Cons: Requires project/role setup.
- Option B: Vercel protected deployment plus server-side allowlist.
  - Pros: Faster private deployment.
  - Cons: Less app-native RBAC.

**Recommendation:** Use Descope for app-native admin roles. Keep Vercel/team protection as an outer layer if deployed on Vercel.

- [ ] **Step 1: Add env contract**

Add to `.env.example`:

```env
MANAGEMENT_AUTH_MODE=local-dev
MANAGEMENT_ALLOWED_EMAILS=
NEXT_PUBLIC_DESCOPE_PROJECT_ID=
```

- [ ] **Step 2: Create auth mode parser**

Create `src/lib/server/management-auth.ts`:

```ts
import "server-only";

export type ManagementAuthMode = "local-dev" | "descope";

export interface ManagementAuthConfig {
  mode: ManagementAuthMode;
  allowedEmails: string[];
  descopeProjectId?: string;
}

export function getManagementAuthConfig(): ManagementAuthConfig {
  const mode = parseAuthMode(process.env.MANAGEMENT_AUTH_MODE);
  return {
    mode,
    allowedEmails: parseEmailList(process.env.MANAGEMENT_ALLOWED_EMAILS),
    descopeProjectId: process.env.NEXT_PUBLIC_DESCOPE_PROJECT_ID,
  };
}

export function parseAuthMode(value: string | undefined): ManagementAuthMode {
  if (!value || value === "local-dev") return "local-dev";
  if (value === "descope") return "descope";
  throw new Error("MANAGEMENT_AUTH_MODE must be local-dev or descope.");
}

export function parseEmailList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}
```

- [ ] **Step 3: Add unit tests**

Create `src/lib/server/management-auth.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseAuthMode, parseEmailList } from "./management-auth";

describe("management auth config", () => {
  it("defaults to local-dev", () => {
    expect(parseAuthMode(undefined)).toBe("local-dev");
  });

  it("accepts descope", () => {
    expect(parseAuthMode("descope")).toBe("descope");
  });

  it("rejects unknown modes", () => {
    expect(() => parseAuthMode("none")).toThrow("MANAGEMENT_AUTH_MODE");
  });

  it("normalizes allowed emails", () => {
    expect(parseEmailList("A@Example.com, b@example.com ")).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
  });
});
```

- [ ] **Step 4: Run tests**

Run:

```powershell
Set-Location C:\Codes\apic\apicenter-management
npm run test -- src/lib/server/management-auth.test.ts
npx tsc --noEmit
npm run build
```

Expected:

```text
Auth config tests pass.
TypeScript passes.
Next build passes.
```

### Task 2: Add Action Risk Classification

**Files:**

- Create: `C:\Codes\apic\apicenter-management\src\lib\action-risk.ts`
- Modify: `C:\Codes\apic\apicenter-management\src\components\shared-service-smoke-tests.tsx`
- Modify: `C:\Codes\apic\apicenter-management\src\components\tribe-deprovisioning-card.tsx`
- Modify: `C:\Codes\apic\apicenter-management\src\components\deployment-restart-card.tsx`
- Test: `C:\Codes\apic\apicenter-management\src\lib\action-risk.test.ts`

**Decision point:** How much friction should live mode have?

- Option A: Typed service ID only.
- Option B: Typed service ID plus reason.
- Option C: Two-person approval.

**Recommendation:** Use Option B now. Add two-person approval only after user accounts and action history exist.

- [ ] **Step 1: Create risk model**

Create `src/lib/action-risk.ts`:

```ts
export type ActionRiskLevel = "safe" | "provider-impacting" | "destructive" | "live-write";

export interface ActionRisk {
  level: ActionRiskLevel;
  requiresConfirmation: boolean;
  requiresReason: boolean;
  confirmationText?: string;
}

export function getActionRisk(input: {
  live: boolean;
  providerImpacting?: boolean;
  destructive?: boolean;
  serviceId?: string;
}): ActionRisk {
  if (input.live) {
    return {
      level: "live-write",
      requiresConfirmation: true,
      requiresReason: true,
      confirmationText: input.serviceId,
    };
  }

  if (input.destructive) {
    return {
      level: "destructive",
      requiresConfirmation: true,
      requiresReason: true,
      confirmationText: input.serviceId,
    };
  }

  if (input.providerImpacting) {
    return {
      level: "provider-impacting",
      requiresConfirmation: true,
      requiresReason: false,
    };
  }

  return {
    level: "safe",
    requiresConfirmation: false,
    requiresReason: false,
  };
}
```

- [ ] **Step 2: Add tests**

Create `src/lib/action-risk.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getActionRisk } from "./action-risk";

describe("getActionRisk", () => {
  it("marks safe actions without confirmation", () => {
    expect(getActionRisk({ live: false })).toMatchObject({
      level: "safe",
      requiresConfirmation: false,
    });
  });

  it("requires confirmation for provider-impacting actions", () => {
    expect(getActionRisk({ live: false, providerImpacting: true })).toMatchObject({
      level: "provider-impacting",
      requiresConfirmation: true,
      requiresReason: false,
    });
  });

  it("requires reason and service id confirmation for live writes", () => {
    expect(getActionRisk({ live: true, serviceId: "payment" })).toEqual({
      level: "live-write",
      requiresConfirmation: true,
      requiresReason: true,
      confirmationText: "payment",
    });
  });
});
```

- [ ] **Step 3: Use the model in high-risk components**

Start with:

```text
shared-service-smoke-tests.tsx
tribe-deprovisioning-card.tsx
deployment-restart-card.tsx
```

Expected behavior:

```text
Safe reads remain one click.
Provider-impacting smoke requires explicit confirmation.
Live writes require a reason and typed confirmation.
```

---

## Phase 2: Guided Operator Workflows

**Goal:** Convert the runbook’s highest-value flows into guided UI.

### Task 3: New Tribe Onboarding Wizard

**Files:**

- Create: `C:\Codes\apic\apicenter-management\src\components\flows\new-tribe-onboarding-flow.tsx`
- Modify: `C:\Codes\apic\apicenter-management\src\app\tribes\new\page.tsx`
- Modify: `C:\Codes\apic\apicenter-management\src\components\tribe-onboarding-flow.tsx`
- Test: `C:\Codes\apic\apicenter-management\src\components\flows\new-tribe-onboarding-flow.test.tsx`

**Decision point:** Should the wizard replace the form or wrap around it?

- Option A: Replace `/tribes/new`.
  - Pros: Single guided path.
  - Cons: Slower for expert operators.
- Option B: Keep expert form and add guided mode.
  - Pros: Flexible.
  - Cons: Two surfaces to maintain.

**Recommendation:** Keep expert form and add guided mode.

- [ ] **Step 1: Add flow steps**

Flow steps:

```text
1. Check readiness.
2. Create or edit manifest.
3. Register service.
4. Provision tribe secret.
5. Grant shared-service access.
6. Request temporary token.
7. Run safe smoke checks.
8. Review usage/audit evidence.
```

- [ ] **Step 2: Add component skeleton**

Create:

```tsx
export function NewTribeOnboardingFlow() {
  const steps = [
    "Readiness",
    "Manifest",
    "Register",
    "Secret",
    "Access",
    "Token",
    "Smoke",
    "Evidence",
  ];

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Guided onboarding</h2>
      <ol className="grid gap-2 md:grid-cols-4">
        {steps.map((step, index) => (
          <li key={step} className="rounded-lg border p-3 text-sm">
            <div className="text-xs text-muted-foreground">Step {index + 1}</div>
            <div className="font-medium">{step}</div>
          </li>
        ))}
      </ol>
    </section>
  );
}
```

- [ ] **Step 3: Wire into `/tribes/new`**

Add the guided flow above or beside the existing form. Do not remove the existing expert form.

- [ ] **Step 4: Verify**

Run:

```powershell
npm run test -- src/components/flows/new-tribe-onboarding-flow.test.tsx
npx tsc --noEmit
npm run build
```

Expected:

```text
Guided flow renders.
Existing new-tribe form still works.
```

### Task 4: Payment Subscription Rollout Wizard

**Files:**

- Create: `C:\Codes\apic\apicenter-management\src\components\flows\payment-subscription-rollout-flow.tsx`
- Modify: `C:\Codes\apic\apicenter-management\src\app\shared-services\page.tsx`
- Modify: `C:\Codes\apic\apicenter-management\src\components\shared-service-smoke-tests.tsx`
- Test: `C:\Codes\apic\apicenter-management\src\components\flows\payment-subscription-rollout-flow.test.tsx`

**Decision point:** Should payment rollout be a payment-specific flow or a generic shared-service rollout flow?

- Option A: Payment-specific.
  - Pros: Captures PayMongo/webhook/subscription details.
  - Cons: Less reusable.
- Option B: Generic shared-service rollout.
  - Pros: Reusable for SMS/email/geo.
  - Cons: Too generic for payment risk.

**Recommendation:** Start payment-specific because recurring billing has higher financial risk.

- [ ] **Step 1: Define rollout checklist**

Use these steps:

```text
1. Confirm test environment.
2. Confirm payment service health.
3. Confirm subscriptions enabled in test.
4. Run SDK smoke.
5. Run management lifecycle smoke.
6. Confirm webhook reachability.
7. Confirm usage analytics.
8. Confirm event export.
9. Record handoff evidence.
10. Block live until explicit approval.
```

- [ ] **Step 2: Create component**

Create a checklist component that renders each step, owner, status, and evidence input.

Expected minimum shape:

```tsx
type RolloutStep = {
  id: string;
  label: string;
  owner: "platform" | "shared-service" | "operator";
  requiredEvidence: string;
};
```

- [ ] **Step 3: Link from shared-services payment card**

On `/shared-services`, add a payment action:

```text
Open subscription rollout
```

- [ ] **Step 4: Verify**

Run:

```powershell
npm run test -- src/components/flows/payment-subscription-rollout-flow.test.tsx
npx tsc --noEmit
npm run build
```

Expected:

```text
Payment rollout flow renders and links from shared-services.
```

---

## Phase 3: Unified Timeline And Diagnostics

**Goal:** Give operators a single narrative for each service.

### Task 5: Service Timeline Model

**Files:**

- Create: `C:\Codes\apic\apicenter-management\src\lib\service-timeline.ts`
- Create: `C:\Codes\apic\apicenter-management\src\components\service-timeline.tsx`
- Modify: `C:\Codes\apic\apicenter-management\src\components\service-detail-client.tsx`
- Modify: `C:\Codes\apic\apicenter-management\src\components\shared-services-catalog-client.tsx`
- Test: `C:\Codes\apic\apicenter-management\src\lib\service-timeline.test.ts`

**Decision point:** Should timeline data be assembled in the frontend or an API Center endpoint?

- Option A: Frontend composition from existing endpoints.
  - Pros: Fast, no API Center change.
  - Cons: More browser requests and duplicated logic.
- Option B: API Center timeline endpoint.
  - Pros: Consistent and cacheable.
  - Cons: Requires backend work.

**Recommendation:** Start frontend composition using existing endpoints; graduate to API Center endpoint when the event model stabilizes.

- [ ] **Step 1: Define timeline item type**

Create:

```ts
export type ServiceTimelineKind =
  | "registry"
  | "health"
  | "smoke"
  | "usage"
  | "alert"
  | "audit"
  | "confluent"
  | "secret";

export interface ServiceTimelineItem {
  id: string;
  kind: ServiceTimelineKind;
  severity: "info" | "warning" | "error" | "success";
  title: string;
  detail: string;
  timestamp?: string;
  href?: string;
}
```

- [ ] **Step 2: Add merge helper**

Create:

```ts
export function sortTimelineItems(items: ServiceTimelineItem[]): ServiceTimelineItem[] {
  return [...items].sort((a, b) => {
    const left = a.timestamp ?? "";
    const right = b.timestamp ?? "";
    return right.localeCompare(left);
  });
}
```

- [ ] **Step 3: Test ordering**

Create test:

```ts
import { describe, expect, it } from "vitest";
import { sortTimelineItems } from "./service-timeline";

describe("sortTimelineItems", () => {
  it("sorts newest timestamp first", () => {
    expect(
      sortTimelineItems([
        { id: "old", kind: "audit", severity: "info", title: "Old", detail: "Old", timestamp: "2026-05-01T00:00:00.000Z" },
        { id: "new", kind: "alert", severity: "warning", title: "New", detail: "New", timestamp: "2026-05-02T00:00:00.000Z" },
      ]).map((item) => item.id),
    ).toEqual(["new", "old"]);
  });
});
```

- [ ] **Step 4: Add timeline component**

Render item kind, severity, title, detail, timestamp, and optional link.

- [ ] **Step 5: Wire into service detail**

Add a new section:

```text
Operational timeline
```

Use registry metadata, current usage row, active alerts, and audit links first.

- [ ] **Step 6: Verify**

Run:

```powershell
npm run test -- src/lib/service-timeline.test.ts
npx tsc --noEmit
npm run build
```

---

## Phase 4: Secret And Config Drift

**Goal:** Show whether required platform configuration exists without exposing secrets.

### Task 6: Shared-Service Secret Status Panel

**Files:**

- Create: `C:\Codes\apic\apicenter-management\src\app\api\local\secret-status\route.ts`
- Create: `C:\Codes\apic\apicenter-management\src\lib\server\secret-status.ts`
- Modify: `C:\Codes\apic\apicenter-management\src\components\shared-services-catalog-client.tsx`
- Modify: `C:\Codes\apic\apicenter-management\src\lib\schemas.ts`
- Test: `C:\Codes\apic\apicenter-management\src\lib\server\secret-status.test.ts`

**Decision point:** How much secret metadata should be visible?

- Option A: Existence only.
  - Pros: Lowest risk.
  - Cons: Does not catch missing JSON keys.
- Option B: Existence plus non-secret JSON key names.
  - Pros: Catches drift.
  - Cons: Requires reading payload.

**Recommendation:** For shared-service runtime secrets, read JSON key names but never values. For tribe secrets, show existence and version only.

- [ ] **Step 1: Add status type**

Add to `src/lib/schemas.ts`:

```ts
export const secretStatusSchema = z.object({
  secretId: z.string(),
  exists: z.boolean(),
  latestVersion: z.string().optional(),
  requiredKeys: z.array(z.string()).default([]),
  presentKeys: z.array(z.string()).default([]),
  missingKeys: z.array(z.string()).default([]),
});

export type SecretStatus = z.infer<typeof secretStatusSchema>;
```

- [ ] **Step 2: Create metadata reader**

Create a helper that returns:

```ts
{
  secretId: "api-shared-services-test",
  exists: true,
  latestVersion: "3",
  requiredKeys: ["PAYMONGO_TEST_SECRET_KEY", "PAYMONGO_TEST_WEBHOOK_SECRET"],
  presentKeys: ["PAYMONGO_TEST_SECRET_KEY", "PAYMONGO_TEST_WEBHOOK_SECRET"],
  missingKeys: []
}
```

- [ ] **Step 3: Add UI panel**

For each shared service, show:

```text
Secret exists
Latest enabled version
Required keys present/missing
Last checked timestamp
```

- [ ] **Step 4: Verify**

Run:

```powershell
npm run test -- src/lib/server/secret-status.test.ts
npx tsc --noEmit
npm run build
```

---

## Phase 5: Release And Deployment Visibility

**Goal:** Make deployed state visible without requiring every operator to run `kubectl`.

### Task 7: Deployment Inventory Panel

**Files:**

- Create: `C:\Codes\apic\apicenter-management\src\app\api\local\deployments\status\route.ts`
- Create: `C:\Codes\apic\apicenter-management\src\components\deployment-status-panel.tsx`
- Modify: `C:\Codes\apic\apicenter-management\src\app\settings\page.tsx`
- Modify: `C:\Codes\apic\apicenter-management\src\lib\schemas.ts`

**Decision point:** Source deployment state from Kubernetes, API Center readiness, or Cloud Build?

- Option A: Kubernetes live query.
  - Pros: Actual deployed image and rollout state.
  - Cons: Needs cluster access.
- Option B: API Center readiness plus configured version.
  - Pros: Easier and safer.
  - Cons: Less complete.
- Option C: Cloud Build history.
  - Pros: Good release trace.
  - Cons: Not proof of deployed state.

**Recommendation:** Start with API Center readiness plus image tag env if available; add Kubernetes query only in private deployed mode with proper IAM.

- [ ] **Step 1: Add deployment status schema**

Add:

```ts
export const deploymentStatusSchema = z.object({
  serviceId: z.string(),
  environment: z.enum(["test", "live", "local"]),
  image: z.string().optional(),
  ready: z.boolean(),
  checkedAt: z.string(),
  source: z.enum(["api-center-readiness", "kubernetes", "configured"]),
});
```

- [ ] **Step 2: Add status route**

Return API Center readiness and configured deployment hints first.

- [ ] **Step 3: Render in settings**

Show rows for:

```text
api-center
payment-service
email-service
sms-service
otp-service
geo-service
gauth-service
apicenter-management
```

- [ ] **Step 4: Verify**

Run:

```powershell
npx tsc --noEmit
npm run build
```

---

## Phase 6: Tribe Developer Handoff Packet

**Goal:** Let the platform generate a clean handoff for a tribe without leaking secrets.

### Task 8: Add Handoff Packet Generator

**Files:**

- Create: `C:\Codes\apic\apicenter-management\src\lib\tribe-handoff.ts`
- Create: `C:\Codes\apic\apicenter-management\src\components\tribe-handoff-panel.tsx`
- Modify: `C:\Codes\apic\apicenter-management\src\components\service-detail-client.tsx`
- Test: `C:\Codes\apic\apicenter-management\src\lib\tribe-handoff.test.ts`

**Decision point:** Should generated handoff include the tribe secret?

- Option A: Include plaintext secret.
  - Pros: One document contains everything.
  - Cons: Unsafe; easy to leak.
- Option B: Include secret delivery instructions only.
  - Pros: Safe.
  - Cons: Requires a separate secure channel.

**Recommendation:** Never include plaintext secret. Include Secret Manager status and delivery instructions.

- [ ] **Step 1: Generate Markdown**

Create function:

```ts
export function buildTribeHandoffMarkdown(input: {
  serviceId: string;
  apiCenterUrl: string;
  consumes: string[];
  requiredScopes: string[];
}) {
  return `# ${input.serviceId} API Center Handoff

## Runtime Environment

\`\`\`env
APICENTER_URL=${input.apiCenterUrl}
APICENTER_TRIBE_ID=${input.serviceId}
APICENTER_TRIBE_SECRET=<delivered-securely>
\`\`\`

## SDK Install

\`\`\`powershell
npm install @implementsprint/sdk
\`\`\`

## Allowed Services

${input.consumes.map((service) => `- ${service}`).join("\n")}

## Required Scopes

${input.requiredScopes.map((scope) => `- ${scope}`).join("\n")}
`;
}
```

- [ ] **Step 2: Add tests**

Assert that generated Markdown includes env names but not any plaintext secret value.

- [ ] **Step 3: Add panel on service detail**

Add:

```text
Developer handoff
Copy Markdown
Copy .env.example
```

- [ ] **Step 4: Verify**

Run:

```powershell
npm run test -- src/lib/tribe-handoff.test.ts
npx tsc --noEmit
npm run build
```

---

## Phase 7: Route Smoke And Visual QA

**Goal:** Make the console safer to change by adding route-level checks.

### Task 9: Add Local Route Smoke Script

**Files:**

- Create: `C:\Codes\apic\apicenter-management\scripts\smoke-routes.mjs`
- Modify: `C:\Codes\apic\apicenter-management\package.json`
- Create: `C:\Codes\apic\apicenter-management\docs\operations\route-smoke-testing.md`

**Decision point:** Use Playwright or simple HTTP smoke?

- Option A: HTTP smoke only.
  - Pros: Fast and stable.
  - Cons: Does not catch client render issues.
- Option B: Browser smoke.
  - Pros: Catches rendered UI issues.
  - Cons: More dependencies and flakiness.

**Recommendation:** Start with HTTP smoke for all routes and add browser smoke for the top five workflows later.

- [ ] **Step 1: Add smoke script**

Create:

```js
const routes = [
  "/",
  "/readiness",
  "/tribes",
  "/shared-services",
  "/shared-services/usage",
  "/smoke-tests",
  "/audit",
  "/cost",
  "/alerts",
  "/manifest-tools",
  "/settings",
];

const baseUrl = process.env.MANAGEMENT_SMOKE_BASE_URL ?? "http://127.0.0.1:3000";

for (const route of routes) {
  const response = await fetch(`${baseUrl}${route}`);
  if (!response.ok) {
    throw new Error(`${route} returned HTTP ${response.status}`);
  }
  console.log(`${route} ${response.status}`);
}
```

- [ ] **Step 2: Add package script**

Add:

```json
"smoke:routes": "node scripts/smoke-routes.mjs"
```

- [ ] **Step 3: Verify**

Run with dev server active:

```powershell
npm run smoke:routes
```

Expected:

```text
Every route returns HTTP 200.
```

---

## Prioritized Roadmap

### Must Do Before Public Deployment

- Auth mode and admin-role enforcement.
- Live-mode write confirmations.
- Read-only deployment/environment visibility.
- Route smoke checks.
- Clear audit trail for write actions.

### Should Do For Operator Efficiency

- New tribe onboarding wizard.
- Payment subscription rollout wizard.
- Unified service timeline.
- Secret/config drift panel.
- Tribe developer handoff packet.

### Later Enhancements

- Browser visual QA.
- Persisted smoke-run history.
- Two-person approval for live destructive actions.
- Slack/email alert delivery.
- Role-specific dashboards for platform admin, observer, and developer support.
- API Center backend timeline endpoint.

---

## Decision Checklist

Before implementation, answer these:

- [ ] Is the console staying local-only for the next milestone?
- [ ] If deployed, is the target Vercel, private GKE, or both?
- [ ] Should auth be Descope, Vercel protection, or another provider?
- [ ] Which users are `admin`, `operator`, and `observer`?
- [ ] Are live writes allowed from the console, or should live remain read-only?
- [ ] Should smoke test results be persisted in API Center?
- [ ] Should Secret Manager payload key names be readable, or metadata only?
- [ ] Should deployment status query Kubernetes directly?
- [ ] Should route smoke be enough for now, or do we need Playwright visual checks?

---

## Recommended First Implementation Bundle

Build this first:

1. Auth mode config and local-dev bypass.
2. Action risk model for live/provider-impacting/destructive actions.
3. Payment subscription rollout wizard.
4. Tribe handoff packet generator.
5. Route smoke script.

Why this bundle:

- It improves safety and usability without requiring a new API Center backend endpoint.
- It can be tested locally.
- It does not require exposing secrets.
- It makes the console more useful even before public deployment.

Verification for first bundle:

```powershell
Set-Location C:\Codes\apic\apicenter-management
npm run test
npx tsc --noEmit
npm run build
npm run smoke:routes
```

---

## Done Criteria

- Operators cannot confuse test and live environments.
- Provider-impacting and destructive actions have explicit friction.
- Auth/RBAC decision is implemented before public deployment.
- New-tribe and payment-subscription operations have guided flows.
- Service detail pages show a useful operational timeline.
- Secret/config drift can be checked without exposing secret values.
- Tribe handoff material can be generated without leaking credentials.
- Route smoke catches broken top-level pages.
- The runbook and UI agree on the same operator flow.
