# API Center Management Deployment Safety Workflows Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `apicenter-management` safe to deploy as the real API Center operator console, with Descope authentication, action-level write safety, guided operations, and operator-grade observability.

**Architecture:** Keep the browser UI thin and keep all privileged reads/writes behind server-side Next.js route handlers in `src/app/api/local/*`. Add Descope-backed identity, a local development bypass, role-based action authorization, typed confirmation for live writes, secret metadata inspection without plaintext exposure, guided workflow screens, and timeline-style observability. Ship in gates so deployment and read-only operations land before live mutation controls.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, TanStack Query, Zod, Vitest/jsdom, Descope, API Center protected admin endpoints, Google Secret Manager metadata access, existing shared-service smoke/test/live modes, optional private Vercel or private internal deployment target.

---

## Accepted Decisions And Why

These decisions are now part of the implementation contract.

| Area | Decision | Why this decision |
| --- | --- | --- |
| Deployment | Build for real deployed use, not local-only operation. | The console manages platform state, shared services, registry data, and provider-impacting actions. A deployed console is useful, but only after identity, write controls, and audit evidence exist. |
| Authentication | Use Descope. | Descope gives the app an identity layer that can be enforced inside route handlers. Vercel-only protection is useful at the edge, but it does not give enough action-level authorization for API Center operations. |
| Live operations | Read access is allowed by role. Live write actions require typed confirmation, an operator reason, preview/dry-run output when available, and audit capture. | Operators need to inspect production quickly, but writes are high-risk. The friction should appear at the moment of change, not while reading. |
| Creates vs changes | Creates are still write actions. In test mode, admin/operator roles can create with normal confirmation. In live mode, creates require the same typed confirmation and reason as updates. | Creating a tribe, topic, secret, or shared-service config changes production state. Treating creates as safer than updates would create an accidental bypass. |
| First priority | Safety, then workflows, then observability. | The current console already has many powerful pages. Safety reduces blast radius first, workflows reduce missed steps second, and observability makes the system explain itself after that. |
| Secret visibility | Shared-service secret status can show metadata and JSON key names only. Tribe secrets show metadata only. No plaintext secret values appear in the UI or logs. | Operators need to know whether config exists and whether expected keys are present, but secret disclosure would make the management console too risky to deploy. |
| Automation | One-click actions are allowed only after preview/dry-run, typed confirmation for live writes, and audit trail. | Automation is useful for repeatable platform work, but the console should make operator intent explicit before it mutates provider or production state. |
| Plan shape | Use one master phased plan first. Split into smaller execution plans only when implementation starts and the first bundle becomes too large. | The changes affect auth, safety, workflows, observability, and deployment. A single plan keeps the control model coherent before work is parallelized. |

---

## Current Relevant Surface

Existing routes to preserve:

- `src/app/page.tsx`
- `src/app/alerts/page.tsx`
- `src/app/audit/page.tsx`
- `src/app/cost/page.tsx`
- `src/app/dependencies/page.tsx`
- `src/app/manifest-tools/page.tsx`
- `src/app/readiness/page.tsx`
- `src/app/settings/page.tsx`
- `src/app/shared-services/page.tsx`
- `src/app/shared-services/setup/page.tsx`
- `src/app/shared-services/usage/page.tsx`
- `src/app/smoke-tests/page.tsx`
- `src/app/tribes/page.tsx`
- `src/app/tribes/new/page.tsx`
- `src/app/tribes/[tribeId]/page.tsx`
- `src/app/tribes/[tribeId]/edit/page.tsx`

Existing components to extend rather than replace:

- `src/components/app-shell.tsx`
- `src/components/dashboard-client.tsx`
- `src/components/readiness-client.tsx`
- `src/components/tribe-list-client.tsx`
- `src/components/service-detail-client.tsx`
- `src/components/shared-service-smoke-tests.tsx`
- `src/components/shared-service-usage-matrix.tsx`
- `src/components/shared-services-catalog-client.tsx`
- `src/components/smoke-token-card.tsx`
- `src/components/deployment-restart-card.tsx`
- `src/components/confluent-provisioning-card.tsx`
- `src/components/tribe-deprovisioning-card.tsx`
- `src/components/tribe-onboarding-flow.tsx`

Existing verification commands:

- `npm run test`
- `npx tsc --noEmit`
- `npm run build`

---

## Phase Gates

| Gate | Required before moving forward | Verification |
| --- | --- | --- |
| Gate A: Deployable read-only console | Descope config exists, local-dev bypass is explicit, protected pages resolve a management session, server routes reject unauthenticated access outside local-dev, and no provider secret is exposed to the browser. | `npm run test`, `npx tsc --noEmit`, `npm run build` |
| Gate B: Live write safety | All write routes require an action authorization check, live writes require typed confirmation and reason, and write attempts emit audit-friendly metadata. | Focused action-authorization tests plus full test/build commands |
| Gate C: Guided operation readiness | New tribe, payment subscription rollout, and SDK-to-S3 validation flows show step state and use the shared action safety model. | Component tests for each flow and browser route smoke |
| Gate D: Observability readiness | Service detail surfaces show a unified timeline from audit, smoke, usage, readiness, and config status sources. | Timeline data tests, component tests, route smoke |
| Gate E: Automation readiness | One-click operations have preview/dry-run output, live typed confirmation, and audit capture. | Endpoint tests, UI tests, test/live safety tests |

---

## Phase 0: Baseline And Safety Inventory

### Task 0.1: Record the current write-action inventory

**Files:**
- Create: `docs/operations/apicenter-management-action-inventory.md`

- [ ] **Step 1: Add the action inventory document**

Create `docs/operations/apicenter-management-action-inventory.md` with this content:

```markdown
# API Center Management Action Inventory

This document classifies the management console operations that can read or mutate API Center state.

## Risk Levels

| Risk | Meaning | Live behavior |
| --- | --- | --- |
| read | Fetches state only | Allowed by observer, operator, and admin |
| low-write | Writes local or test-only state | Requires operator or admin |
| state-write | Creates or updates API Center platform state | Requires typed confirmation and reason in live |
| provider-write | Calls provider or infrastructure APIs | Requires preview or dry-run when available, typed confirmation, and reason in live |
| destructive | Deletes, deprovisions, rotates, restarts, or disables live state | Admin-only in live with typed confirmation and reason |

## Known Actions

| Surface | Action | Risk |
| --- | --- | --- |
| `/tribes/new` | Create tribe | state-write |
| `/tribes/[tribeId]/edit` | Update tribe manifest | state-write |
| Tribe detail | Deprovision tribe | destructive |
| Shared services setup | Provision shared-service secret or config | provider-write |
| Smoke tests | Run safe smoke test | low-write |
| Smoke tests | Run provider-impacting smoke test | provider-write |
| Confluent provisioning | Create topics or ACLs | provider-write |
| Deployment restart | Restart backend deployment | destructive |
| Manifest tools | Import manifest | state-write |
| Settings | Change environment or endpoint config | state-write |

## Implementation Rule

Every server route that performs a write must call the shared authorization guard introduced in this plan before contacting API Center, Secret Manager, Confluent, payment providers, or deployment APIs.
```

- [ ] **Step 2: Verify the document has no placeholder language**

Run: `Select-String -Path docs/operations/apicenter-management-action-inventory.md -Pattern "T[B]D|T[O]DO|FILL_ME_IN|PLACEHOLDER"`

Expected: no matches.

- [ ] **Step 3: Commit**

Run:

```bash
git add docs/operations/apicenter-management-action-inventory.md
git commit -m "docs: inventory management console actions"
```

---

## Phase 1: Descope Auth And Deployment Readiness

### Task 1.1: Add auth environment contract

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Add auth and deployment variables to `.env.example`**

Add these variables:

```dotenv
# Management console auth. Use local-dev only on developer machines.
MANAGEMENT_AUTH_MODE=local-dev
MANAGEMENT_ENVIRONMENT=test
MANAGEMENT_PUBLIC_BASE_URL=http://localhost:3000

# Required when MANAGEMENT_AUTH_MODE=descope.
DESCOPE_PROJECT_ID=
DESCOPE_MANAGEMENT_KEY=
DESCOPE_ISSUER=
DESCOPE_ALLOWED_TENANT_ID=

# Role mapping uses Descope roles or custom claims.
MANAGEMENT_ADMIN_ROLES=api-center-admin,platform-admin
MANAGEMENT_OPERATOR_ROLES=api-center-operator,platform-operator
MANAGEMENT_OBSERVER_ROLES=api-center-observer,platform-observer
```

- [ ] **Step 2: Update `README.md` deployment gate**

Add this section:

```markdown
## Deployment Safety Gate

The management console can be deployed only when:

- `MANAGEMENT_AUTH_MODE=descope` is set outside local development.
- Descope project, issuer, and management key are configured as server-only environment variables.
- Platform/provider secrets are not exposed through `NEXT_PUBLIC_*` variables.
- All server-side write routes call the shared action authorization guard.
- Live writes require typed confirmation and an operator reason.
- Route smoke, unit tests, typecheck, and production build pass.

Local development can use `MANAGEMENT_AUTH_MODE=local-dev`, but that mode must not be used in deployed test or live environments.
```

- [ ] **Step 3: Run verification**

Run: `npm run test`

Expected: existing tests pass.

- [ ] **Step 4: Commit**

Run:

```bash
git add .env.example README.md
git commit -m "docs: define management auth deployment gate"
```

### Task 1.2: Add management session model

**Files:**
- Create: `src/lib/server/management-auth.ts`
- Test: `src/lib/server/management-auth.test.ts`

- [ ] **Step 1: Write session model tests**

Create `src/lib/server/management-auth.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  getManagementAuthConfig,
  resolveManagementSessionFromClaims,
} from "./management-auth";

describe("getManagementAuthConfig", () => {
  it("defaults to local-dev for local development", () => {
    const config = getManagementAuthConfig({
      MANAGEMENT_AUTH_MODE: "local-dev",
      MANAGEMENT_ENVIRONMENT: "test",
    });

    expect(config.mode).toBe("local-dev");
    expect(config.environment).toBe("test");
  });

  it("requires Descope settings when descope mode is enabled", () => {
    expect(() =>
      getManagementAuthConfig({
        MANAGEMENT_AUTH_MODE: "descope",
        MANAGEMENT_ENVIRONMENT: "live",
        DESCOPE_PROJECT_ID: "project-id",
      }),
    ).toThrow("DESCOPE_ISSUER is required");
  });
});

describe("resolveManagementSessionFromClaims", () => {
  it("maps Descope roles into management roles", () => {
    const session = resolveManagementSessionFromClaims(
      {
        sub: "user-1",
        email: "ops@example.com",
        name: "Ops User",
        roles: ["platform-operator"],
      },
      {
        adminRoles: ["platform-admin"],
        operatorRoles: ["platform-operator"],
        observerRoles: ["platform-observer"],
      },
    );

    expect(session).toEqual({
      userId: "user-1",
      email: "ops@example.com",
      name: "Ops User",
      role: "operator",
      source: "descope",
    });
  });

  it("uses observer when only observer roles match", () => {
    const session = resolveManagementSessionFromClaims(
      {
        sub: "user-2",
        email: "viewer@example.com",
        roles: ["platform-observer"],
      },
      {
        adminRoles: ["platform-admin"],
        operatorRoles: ["platform-operator"],
        observerRoles: ["platform-observer"],
      },
    );

    expect(session.role).toBe("observer");
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `npm run test -- src/lib/server/management-auth.test.ts`

Expected: fail because `management-auth.ts` does not exist.

- [ ] **Step 3: Implement the session model**

Create `src/lib/server/management-auth.ts`:

```ts
export type ManagementAuthMode = "local-dev" | "descope";
export type ManagementEnvironment = "test" | "live";
export type ManagementRole = "admin" | "operator" | "observer";

export type ManagementSession = {
  userId: string;
  email: string;
  name?: string;
  role: ManagementRole;
  source: ManagementAuthMode;
};

export type ManagementAuthConfig = {
  mode: ManagementAuthMode;
  environment: ManagementEnvironment;
  descopeProjectId?: string;
  descopeIssuer?: string;
  descopeAllowedTenantId?: string;
  adminRoles: string[];
  operatorRoles: string[];
  observerRoles: string[];
};

type EnvLike = Record<string, string | undefined>;

type DescopeClaims = {
  sub?: string;
  email?: string;
  name?: string;
  roles?: string[];
};

type RoleMapping = {
  adminRoles: string[];
  operatorRoles: string[];
  observerRoles: string[];
};

const splitCsv = (value: string | undefined) =>
  value
    ? value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];

export function getManagementAuthConfig(env: EnvLike = process.env): ManagementAuthConfig {
  const mode = (env.MANAGEMENT_AUTH_MODE ?? "local-dev") as ManagementAuthMode;
  const environment = (env.MANAGEMENT_ENVIRONMENT ?? "test") as ManagementEnvironment;

  if (mode !== "local-dev" && mode !== "descope") {
    throw new Error(`Unsupported MANAGEMENT_AUTH_MODE: ${mode}`);
  }

  if (environment !== "test" && environment !== "live") {
    throw new Error(`Unsupported MANAGEMENT_ENVIRONMENT: ${environment}`);
  }

  if (mode === "descope") {
    if (!env.DESCOPE_PROJECT_ID) {
      throw new Error("DESCOPE_PROJECT_ID is required");
    }
    if (!env.DESCOPE_ISSUER) {
      throw new Error("DESCOPE_ISSUER is required");
    }
  }

  return {
    mode,
    environment,
    descopeProjectId: env.DESCOPE_PROJECT_ID,
    descopeIssuer: env.DESCOPE_ISSUER,
    descopeAllowedTenantId: env.DESCOPE_ALLOWED_TENANT_ID,
    adminRoles: splitCsv(env.MANAGEMENT_ADMIN_ROLES) || ["api-center-admin"],
    operatorRoles: splitCsv(env.MANAGEMENT_OPERATOR_ROLES) || ["api-center-operator"],
    observerRoles: splitCsv(env.MANAGEMENT_OBSERVER_ROLES) || ["api-center-observer"],
  };
}

export function createLocalDevSession(): ManagementSession {
  return {
    userId: "local-dev",
    email: "local-dev@api-center.internal",
    name: "Local Developer",
    role: "admin",
    source: "local-dev",
  };
}

export function resolveManagementSessionFromClaims(
  claims: DescopeClaims,
  mapping: RoleMapping,
): ManagementSession {
  const roles = claims.roles ?? [];
  const hasAnyRole = (allowed: string[]) => roles.some((role) => allowed.includes(role));

  const role: ManagementRole = hasAnyRole(mapping.adminRoles)
    ? "admin"
    : hasAnyRole(mapping.operatorRoles)
      ? "operator"
      : hasAnyRole(mapping.observerRoles)
        ? "observer"
        : "observer";

  return {
    userId: claims.sub ?? claims.email ?? "unknown-descope-user",
    email: claims.email ?? "unknown@api-center.internal",
    name: claims.name,
    role,
    source: "descope",
  };
}
```

- [ ] **Step 4: Run the focused test**

Run: `npm run test -- src/lib/server/management-auth.test.ts`

Expected: pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/lib/server/management-auth.ts src/lib/server/management-auth.test.ts
git commit -m "feat: add management auth session model"
```

### Task 1.3: Protect server route handlers through a shared helper

**Files:**
- Create: `src/lib/server/require-management-session.ts`
- Test: `src/lib/server/require-management-session.test.ts`

- [ ] **Step 1: Write route session tests**

Create `src/lib/server/require-management-session.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { requireManagementSession } from "./require-management-session";

describe("requireManagementSession", () => {
  it("returns a local admin session in local-dev mode", async () => {
    const session = await requireManagementSession({
      env: {
        MANAGEMENT_AUTH_MODE: "local-dev",
        MANAGEMENT_ENVIRONMENT: "test",
      },
    });

    expect(session.role).toBe("admin");
    expect(session.source).toBe("local-dev");
  });

  it("rejects missing Descope bearer tokens in descope mode", async () => {
    await expect(
      requireManagementSession({
        env: {
          MANAGEMENT_AUTH_MODE: "descope",
          MANAGEMENT_ENVIRONMENT: "live",
          DESCOPE_PROJECT_ID: "project-id",
          DESCOPE_ISSUER: "https://api.descope.com/project-id",
        },
        authorizationHeader: null,
      }),
    ).rejects.toThrow("Management authentication required");
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `npm run test -- src/lib/server/require-management-session.test.ts`

Expected: fail because the helper does not exist.

- [ ] **Step 3: Implement the helper**

Create `src/lib/server/require-management-session.ts`:

```ts
import {
  createLocalDevSession,
  getManagementAuthConfig,
  type ManagementSession,
} from "./management-auth";

type RequireSessionInput = {
  env?: Record<string, string | undefined>;
  authorizationHeader?: string | null;
};

export async function requireManagementSession(
  input: RequireSessionInput = {},
): Promise<ManagementSession> {
  const config = getManagementAuthConfig(input.env);

  if (config.mode === "local-dev") {
    return createLocalDevSession();
  }

  if (!input.authorizationHeader?.startsWith("Bearer ")) {
    throw new Error("Management authentication required");
  }

  throw new Error("Descope token verification is not wired yet");
}
```

- [ ] **Step 4: Run the focused test**

Run: `npm run test -- src/lib/server/require-management-session.test.ts`

Expected: pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/lib/server/require-management-session.ts src/lib/server/require-management-session.test.ts
git commit -m "feat: add management route session guard"
```

### Task 1.4: Wire Descope token verification

**Files:**
- Modify: `package.json`
- Modify: `src/lib/server/require-management-session.ts`
- Modify: `src/lib/server/require-management-session.test.ts`

- [ ] **Step 1: Install Descope SDK**

Run: `npm install @descope/node-sdk`

Expected: `package.json` and lockfile include `@descope/node-sdk`.

- [ ] **Step 2: Extend tests with injectable verifier**

Update `src/lib/server/require-management-session.test.ts` with:

```ts
it("maps verified Descope claims into a management session", async () => {
  const session = await requireManagementSession({
    env: {
      MANAGEMENT_AUTH_MODE: "descope",
      MANAGEMENT_ENVIRONMENT: "live",
      DESCOPE_PROJECT_ID: "project-id",
      DESCOPE_ISSUER: "https://api.descope.com/project-id",
      MANAGEMENT_OPERATOR_ROLES: "platform-operator",
    },
    authorizationHeader: "Bearer token-123",
    verifyJwt: async () => ({
      sub: "user-1",
      email: "ops@example.com",
      name: "Ops User",
      roles: ["platform-operator"],
    }),
  });

  expect(session).toMatchObject({
    userId: "user-1",
    email: "ops@example.com",
    role: "operator",
    source: "descope",
  });
});
```

- [ ] **Step 3: Update the helper with verifier injection**

Replace the helper implementation with:

```ts
import {
  createLocalDevSession,
  getManagementAuthConfig,
  resolveManagementSessionFromClaims,
  type ManagementSession,
} from "./management-auth";

type DescopeClaims = {
  sub?: string;
  email?: string;
  name?: string;
  roles?: string[];
};

type RequireSessionInput = {
  env?: Record<string, string | undefined>;
  authorizationHeader?: string | null;
  verifyJwt?: (token: string) => Promise<DescopeClaims>;
};

async function verifyDescopeJwt(token: string): Promise<DescopeClaims> {
  const { default: createSdk } = await import("@descope/node-sdk");
  const config = getManagementAuthConfig();
  const descope = createSdk({ projectId: config.descopeProjectId ?? "" });
  const response = await descope.validateJwt(token);
  return response as DescopeClaims;
}

export async function requireManagementSession(
  input: RequireSessionInput = {},
): Promise<ManagementSession> {
  const config = getManagementAuthConfig(input.env);

  if (config.mode === "local-dev") {
    return createLocalDevSession();
  }

  if (!input.authorizationHeader?.startsWith("Bearer ")) {
    throw new Error("Management authentication required");
  }

  const token = input.authorizationHeader.slice("Bearer ".length);
  const claims = await (input.verifyJwt ?? verifyDescopeJwt)(token);

  return resolveManagementSessionFromClaims(claims, {
    adminRoles: config.adminRoles,
    operatorRoles: config.operatorRoles,
    observerRoles: config.observerRoles,
  });
}
```

- [ ] **Step 4: Run auth tests**

Run: `npm run test -- src/lib/server/management-auth.test.ts src/lib/server/require-management-session.test.ts`

Expected: pass.

- [ ] **Step 5: Run typecheck**

Run: `npx tsc --noEmit`

Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

Run:

```bash
git add package.json package-lock.json src/lib/server/require-management-session.ts src/lib/server/require-management-session.test.ts
git commit -m "feat: verify Descope management sessions"
```

---

## Phase 2: Action Authorization And Live Write Guard

### Task 2.1: Add action policy engine

**Files:**
- Create: `src/lib/action-policy.ts`
- Test: `src/lib/action-policy.test.ts`

- [ ] **Step 1: Write action policy tests**

Create `src/lib/action-policy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { authorizeManagementAction } from "./action-policy";

describe("authorizeManagementAction", () => {
  it("allows observer read access", () => {
    expect(
      authorizeManagementAction({
        role: "observer",
        environment: "live",
        actionRisk: "read",
      }).allowed,
    ).toBe(true);
  });

  it("blocks observer writes", () => {
    expect(
      authorizeManagementAction({
        role: "observer",
        environment: "test",
        actionRisk: "state-write",
      }),
    ).toEqual({
      allowed: false,
      reason: "observer cannot perform state-write actions",
      confirmationRequired: false,
      reasonRequired: false,
    });
  });

  it("requires typed confirmation and reason for live creates", () => {
    expect(
      authorizeManagementAction({
        role: "operator",
        environment: "live",
        actionRisk: "state-write",
      }),
    ).toEqual({
      allowed: true,
      confirmationRequired: true,
      reasonRequired: true,
    });
  });

  it("requires admin for live destructive actions", () => {
    expect(
      authorizeManagementAction({
        role: "operator",
        environment: "live",
        actionRisk: "destructive",
      }).allowed,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `npm run test -- src/lib/action-policy.test.ts`

Expected: fail because `action-policy.ts` does not exist.

- [ ] **Step 3: Implement action policy**

Create `src/lib/action-policy.ts`:

```ts
import type { ManagementEnvironment, ManagementRole } from "./server/management-auth";

export type ActionRisk = "read" | "low-write" | "state-write" | "provider-write" | "destructive";

export type ActionPolicyInput = {
  role: ManagementRole;
  environment: ManagementEnvironment;
  actionRisk: ActionRisk;
};

export type ActionPolicyDecision =
  | {
      allowed: true;
      confirmationRequired: boolean;
      reasonRequired: boolean;
    }
  | {
      allowed: false;
      reason: string;
      confirmationRequired: false;
      reasonRequired: false;
    };

export function authorizeManagementAction(input: ActionPolicyInput): ActionPolicyDecision {
  if (input.actionRisk === "read") {
    return { allowed: true, confirmationRequired: false, reasonRequired: false };
  }

  if (input.role === "observer") {
    return {
      allowed: false,
      reason: `observer cannot perform ${input.actionRisk} actions`,
      confirmationRequired: false,
      reasonRequired: false,
    };
  }

  if (input.environment === "live" && input.actionRisk === "destructive" && input.role !== "admin") {
    return {
      allowed: false,
      reason: "live destructive actions require admin role",
      confirmationRequired: false,
      reasonRequired: false,
    };
  }

  if (input.environment === "live") {
    return { allowed: true, confirmationRequired: true, reasonRequired: true };
  }

  return {
    allowed: true,
    confirmationRequired: input.actionRisk === "destructive",
    reasonRequired: false,
  };
}
```

- [ ] **Step 4: Run focused test**

Run: `npm run test -- src/lib/action-policy.test.ts`

Expected: pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/lib/action-policy.ts src/lib/action-policy.test.ts
git commit -m "feat: add management action policy"
```

### Task 2.2: Add typed confirmation validator

**Files:**
- Create: `src/lib/action-confirmation.ts`
- Test: `src/lib/action-confirmation.test.ts`

- [ ] **Step 1: Write confirmation tests**

Create `src/lib/action-confirmation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validateActionConfirmation } from "./action-confirmation";

describe("validateActionConfirmation", () => {
  it("accepts exact typed confirmation and reason for live writes", () => {
    expect(
      validateActionConfirmation({
        confirmationRequired: true,
        reasonRequired: true,
        expectedPhrase: "APPLY LIVE CHANGE",
        typedPhrase: "APPLY LIVE CHANGE",
        reason: "Rotate stale shared-service config before rollout.",
      }),
    ).toEqual({ valid: true });
  });

  it("rejects incorrect typed confirmation", () => {
    expect(
      validateActionConfirmation({
        confirmationRequired: true,
        reasonRequired: true,
        expectedPhrase: "APPLY LIVE CHANGE",
        typedPhrase: "apply live change",
        reason: "Testing case mismatch.",
      }),
    ).toEqual({
      valid: false,
      error: "Type APPLY LIVE CHANGE exactly to continue",
    });
  });

  it("rejects blank reasons when reason is required", () => {
    expect(
      validateActionConfirmation({
        confirmationRequired: true,
        reasonRequired: true,
        expectedPhrase: "APPLY LIVE CHANGE",
        typedPhrase: "APPLY LIVE CHANGE",
        reason: " ",
      }).valid,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `npm run test -- src/lib/action-confirmation.test.ts`

Expected: fail because `action-confirmation.ts` does not exist.

- [ ] **Step 3: Implement validator**

Create `src/lib/action-confirmation.ts`:

```ts
export type ActionConfirmationInput = {
  confirmationRequired: boolean;
  reasonRequired: boolean;
  expectedPhrase: string;
  typedPhrase?: string;
  reason?: string;
};

export type ActionConfirmationResult =
  | { valid: true }
  | {
      valid: false;
      error: string;
    };

export function validateActionConfirmation(
  input: ActionConfirmationInput,
): ActionConfirmationResult {
  if (input.confirmationRequired && input.typedPhrase !== input.expectedPhrase) {
    return {
      valid: false,
      error: `Type ${input.expectedPhrase} exactly to continue`,
    };
  }

  if (input.reasonRequired && !input.reason?.trim()) {
    return {
      valid: false,
      error: "Operator reason is required",
    };
  }

  return { valid: true };
}
```

- [ ] **Step 4: Run focused test**

Run: `npm run test -- src/lib/action-confirmation.test.ts`

Expected: pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/lib/action-confirmation.ts src/lib/action-confirmation.test.ts
git commit -m "feat: validate live action confirmation"
```

### Task 2.3: Add route write guard helper

**Files:**
- Create: `src/lib/server/require-management-action.ts`
- Test: `src/lib/server/require-management-action.test.ts`

- [ ] **Step 1: Write route write guard tests**

Create `src/lib/server/require-management-action.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { requireManagementAction } from "./require-management-action";

describe("requireManagementAction", () => {
  it("returns action context for allowed test writes", async () => {
    const context = await requireManagementAction({
      session: {
        userId: "local-dev",
        email: "local-dev@api-center.internal",
        role: "admin",
        source: "local-dev",
      },
      environment: "test",
      actionRisk: "state-write",
      actionId: "tribe.create",
    });

    expect(context.audit).toMatchObject({
      actionId: "tribe.create",
      operatorEmail: "local-dev@api-center.internal",
      environment: "test",
      actionRisk: "state-write",
    });
  });

  it("requires confirmation for live writes", async () => {
    await expect(
      requireManagementAction({
        session: {
          userId: "user-1",
          email: "ops@example.com",
          role: "operator",
          source: "descope",
        },
        environment: "live",
        actionRisk: "state-write",
        actionId: "tribe.create",
      }),
    ).rejects.toThrow("Type APPLY LIVE CHANGE exactly to continue");
  });
});
```

- [ ] **Step 2: Run failing test**

Run: `npm run test -- src/lib/server/require-management-action.test.ts`

Expected: fail because helper does not exist.

- [ ] **Step 3: Implement route write guard**

Create `src/lib/server/require-management-action.ts`:

```ts
import { validateActionConfirmation } from "../action-confirmation";
import { authorizeManagementAction, type ActionRisk } from "../action-policy";
import type {
  ManagementEnvironment,
  ManagementSession,
} from "./management-auth";

type RequireManagementActionInput = {
  session: ManagementSession;
  environment: ManagementEnvironment;
  actionRisk: ActionRisk;
  actionId: string;
  typedPhrase?: string;
  reason?: string;
};

export type ManagementActionContext = {
  audit: {
    actionId: string;
    operatorId: string;
    operatorEmail: string;
    operatorRole: string;
    environment: ManagementEnvironment;
    actionRisk: ActionRisk;
    reason?: string;
  };
};

export async function requireManagementAction(
  input: RequireManagementActionInput,
): Promise<ManagementActionContext> {
  const decision = authorizeManagementAction({
    role: input.session.role,
    environment: input.environment,
    actionRisk: input.actionRisk,
  });

  if (!decision.allowed) {
    throw new Error(decision.reason);
  }

  const confirmation = validateActionConfirmation({
    confirmationRequired: decision.confirmationRequired,
    reasonRequired: decision.reasonRequired,
    expectedPhrase: "APPLY LIVE CHANGE",
    typedPhrase: input.typedPhrase,
    reason: input.reason,
  });

  if (!confirmation.valid) {
    throw new Error(confirmation.error);
  }

  return {
    audit: {
      actionId: input.actionId,
      operatorId: input.session.userId,
      operatorEmail: input.session.email,
      operatorRole: input.session.role,
      environment: input.environment,
      actionRisk: input.actionRisk,
      reason: input.reason?.trim() || undefined,
    },
  };
}
```

- [ ] **Step 4: Run focused test**

Run: `npm run test -- src/lib/server/require-management-action.test.ts`

Expected: pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/lib/server/require-management-action.ts src/lib/server/require-management-action.test.ts
git commit -m "feat: add server-side management action guard"
```

### Task 2.4: Apply guards to existing write routes

**Files:**
- Modify: every write route under `src/app/api/local/**/route.ts`
- Test: add or extend route tests near existing route test patterns

- [ ] **Step 1: Locate current write routes**

Run: `rg -n "export async function (POST|PUT|PATCH|DELETE)" src/app/api/local`

Expected: list of write route handlers.

- [ ] **Step 2: Add guard pattern to each write route**

For each write handler, add this pattern before calling API Center or providers:

```ts
const session = await requireManagementSession({
  authorizationHeader: request.headers.get("authorization"),
});

const payload = await request.json();

const action = await requireManagementAction({
  session,
  environment: getManagementAuthConfig().environment,
  actionRisk: "state-write",
  actionId: "replace.with.route.action",
  typedPhrase: payload.confirmation?.typedPhrase,
  reason: payload.confirmation?.reason,
});
```

Use the action inventory risk table to choose the exact `actionRisk`.

- [ ] **Step 3: Attach audit metadata to downstream calls where supported**

When the existing client accepts metadata, pass:

```ts
{
  audit: action.audit,
}
```

When it does not accept metadata yet, include `action.audit` in the route response under `operatorAction` so the UI can display the recorded intent.

- [ ] **Step 4: Run focused tests**

Run: `npm run test`

Expected: pass.

- [ ] **Step 5: Run typecheck**

Run: `npx tsc --noEmit`

Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/app/api/local src/lib/server
git commit -m "feat: guard management write routes"
```

---

## Phase 3: Deployment Target And Environment Hardening

### Task 3.1: Add deployment mode banner and read-only state

**Files:**
- Create: `src/components/environment-banner.tsx`
- Modify: `src/components/app-shell.tsx`
- Test: `src/components/environment-banner.test.tsx`

- [ ] **Step 1: Write banner tests**

Create `src/components/environment-banner.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EnvironmentBanner } from "./environment-banner";

describe("EnvironmentBanner", () => {
  it("shows live warning text", () => {
    render(<EnvironmentBanner environment="live" authMode="descope" />);
    expect(screen.getByText("Live environment")).toBeInTheDocument();
    expect(screen.getByText("Writes require confirmation and reason.")).toBeInTheDocument();
  });

  it("shows local development state", () => {
    render(<EnvironmentBanner environment="test" authMode="local-dev" />);
    expect(screen.getByText("Local development")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement banner**

Create `src/components/environment-banner.tsx`:

```tsx
type EnvironmentBannerProps = {
  environment: "test" | "live";
  authMode: "local-dev" | "descope";
};

export function EnvironmentBanner({ environment, authMode }: EnvironmentBannerProps) {
  if (authMode === "local-dev") {
    return (
      <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
        <strong>Local development</strong>
        <span className="ml-2">Do not use this auth mode in deployed environments.</span>
      </div>
    );
  }

  if (environment === "live") {
    return (
      <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-900">
        <strong>Live environment</strong>
        <span className="ml-2">Writes require confirmation and reason.</span>
      </div>
    );
  }

  return (
    <div className="border-b border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-900">
      <strong>Test environment</strong>
      <span className="ml-2">Provider-impacting actions still require review.</span>
    </div>
  );
}
```

- [ ] **Step 3: Mount banner in `app-shell.tsx`**

Render `EnvironmentBanner` above the main content using server-provided or environment-provided values:

```tsx
<EnvironmentBanner
  environment={process.env.MANAGEMENT_ENVIRONMENT === "live" ? "live" : "test"}
  authMode={process.env.MANAGEMENT_AUTH_MODE === "descope" ? "descope" : "local-dev"}
/>
```

- [ ] **Step 4: Run component test**

Run: `npm run test -- src/components/environment-banner.test.tsx`

Expected: pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/components/environment-banner.tsx src/components/environment-banner.test.tsx src/components/app-shell.tsx
git commit -m "feat: show management environment safety banner"
```

### Task 3.2: Create deployment runbook

**Files:**
- Create: `docs/operations/apicenter-management-deployment-runbook.md`

- [ ] **Step 1: Add runbook**

Create `docs/operations/apicenter-management-deployment-runbook.md`:

```markdown
# API Center Management Deployment Runbook

## Deployment Position

Deploy `apicenter-management` only as a protected operator console. It is not a public portal.

## Recommended Deployment Order

1. Deploy test environment first with `MANAGEMENT_AUTH_MODE=descope` and `MANAGEMENT_ENVIRONMENT=test`.
2. Verify Descope login and roles.
3. Verify read-only routes.
4. Verify safe test writes.
5. Deploy live environment with `MANAGEMENT_AUTH_MODE=descope` and `MANAGEMENT_ENVIRONMENT=live`.
6. Verify live read-only routes.
7. Verify live write attempts require typed confirmation and reason.

## Required Server-Only Secrets

- `DESCOPE_PROJECT_ID`
- `DESCOPE_MANAGEMENT_KEY`
- `DESCOPE_ISSUER`
- `API_CENTER_ADMIN_BASE_URL`
- `API_CENTER_ADMIN_TOKEN` or the configured admin auth equivalent

## Browser-Visible Variables

No provider keys, platform tokens, tribe secrets, payment secrets, SMS secrets, or Secret Manager payloads can be exposed through `NEXT_PUBLIC_*` variables.

## Deployment Target Decision

Use the simplest private deployment target that can:

- Keep server environment variables private.
- Restrict access to the management console.
- Reach API Center admin endpoints.
- Emit logs for route errors and write attempts.

Vercel is acceptable when the API Center admin endpoint is reachable from Vercel. A private internal deployment is preferred when admin endpoints are network-private.

## Release Gate

Run these commands before promoting:

```bash
npm run test
npx tsc --noEmit
npm run build
```
```

- [ ] **Step 2: Commit**

Run:

```bash
git add docs/operations/apicenter-management-deployment-runbook.md
git commit -m "docs: add management deployment runbook"
```

---

## Phase 4: Guided Operator Workflows

### Task 4.1: Add shared workflow step model

**Files:**
- Create: `src/lib/workflow-steps.ts`
- Test: `src/lib/workflow-steps.test.ts`

- [ ] **Step 1: Write workflow model tests**

Create `src/lib/workflow-steps.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getWorkflowProgress } from "./workflow-steps";

describe("getWorkflowProgress", () => {
  it("counts complete and blocked workflow steps", () => {
    const progress = getWorkflowProgress([
      { id: "manifest", label: "Manifest", status: "complete" },
      { id: "secret", label: "Secret", status: "blocked" },
      { id: "smoke", label: "Smoke", status: "pending" },
    ]);

    expect(progress).toEqual({
      total: 3,
      complete: 1,
      blocked: 1,
      currentStepId: "secret",
    });
  });
});
```

- [ ] **Step 2: Implement workflow model**

Create `src/lib/workflow-steps.ts`:

```ts
export type WorkflowStepStatus = "pending" | "active" | "complete" | "blocked";

export type WorkflowStep = {
  id: string;
  label: string;
  status: WorkflowStepStatus;
  detail?: string;
};

export function getWorkflowProgress(steps: WorkflowStep[]) {
  const current = steps.find((step) => step.status === "blocked" || step.status === "active");

  return {
    total: steps.length,
    complete: steps.filter((step) => step.status === "complete").length,
    blocked: steps.filter((step) => step.status === "blocked").length,
    currentStepId: current?.id ?? steps.find((step) => step.status === "pending")?.id,
  };
}
```

- [ ] **Step 3: Run focused test**

Run: `npm run test -- src/lib/workflow-steps.test.ts`

Expected: pass.

- [ ] **Step 4: Commit**

Run:

```bash
git add src/lib/workflow-steps.ts src/lib/workflow-steps.test.ts
git commit -m "feat: add management workflow step model"
```

### Task 4.2: Add payment subscription rollout workflow

**Files:**
- Create: `src/components/workflows/payment-subscription-rollout-flow.tsx`
- Test: `src/components/workflows/payment-subscription-rollout-flow.test.tsx`
- Modify: `src/app/shared-services/setup/page.tsx`

- [ ] **Step 1: Write component test**

Create `src/components/workflows/payment-subscription-rollout-flow.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PaymentSubscriptionRolloutFlow } from "./payment-subscription-rollout-flow";

describe("PaymentSubscriptionRolloutFlow", () => {
  it("shows checkout and subscription rollout steps", () => {
    render(
      <PaymentSubscriptionRolloutFlow
        mode="test"
        checkoutReady
        subscriptionReady={false}
        webhookReady={false}
      />,
    );

    expect(screen.getByText("Checkout wrapper")).toBeInTheDocument();
    expect(screen.getByText("Subscription wrapper")).toBeInTheDocument();
    expect(screen.getByText("Webhook persistence")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement workflow component**

Create `src/components/workflows/payment-subscription-rollout-flow.tsx`:

```tsx
import { getWorkflowProgress, type WorkflowStep } from "@/lib/workflow-steps";

type PaymentSubscriptionRolloutFlowProps = {
  mode: "test" | "live";
  checkoutReady: boolean;
  subscriptionReady: boolean;
  webhookReady: boolean;
};

export function PaymentSubscriptionRolloutFlow(props: PaymentSubscriptionRolloutFlowProps) {
  const steps: WorkflowStep[] = [
    {
      id: "checkout",
      label: "Checkout wrapper",
      status: props.checkoutReady ? "complete" : "active",
      detail: "Stripe-like checkout create, retrieve, expire, and event mapping.",
    },
    {
      id: "subscription",
      label: "Subscription wrapper",
      status: props.subscriptionReady ? "complete" : props.checkoutReady ? "active" : "pending",
      detail: "Stripe-like subscription create, update, cancel, list, and retrieve operations.",
    },
    {
      id: "webhook",
      label: "Webhook persistence",
      status: props.webhookReady ? "complete" : props.subscriptionReady ? "active" : "pending",
      detail: "PayMongo webhook events stored in shared payments schema.",
    },
    {
      id: "live",
      label: "Live rollout guard",
      status: props.mode === "live" && props.webhookReady ? "active" : "pending",
      detail: "Live writes require typed confirmation, reason, and audit capture.",
    },
  ];

  const progress = getWorkflowProgress(steps);

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Payment rollout</h2>
        <p className="text-sm text-muted-foreground">
          {progress.complete} of {progress.total} steps complete
        </p>
      </div>
      <div className="grid gap-2">
        {steps.map((step) => (
          <div key={step.id} className="rounded-md border p-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-medium">{step.label}</h3>
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                {step.status}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{step.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Mount the workflow on shared-service setup**

Add `PaymentSubscriptionRolloutFlow` to `src/app/shared-services/setup/page.tsx` near the payment/shared-service controls.

- [ ] **Step 4: Run focused test**

Run: `npm run test -- src/components/workflows/payment-subscription-rollout-flow.test.tsx`

Expected: pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/components/workflows/payment-subscription-rollout-flow.tsx src/components/workflows/payment-subscription-rollout-flow.test.tsx src/app/shared-services/setup/page.tsx
git commit -m "feat: add payment subscription rollout workflow"
```

### Task 4.3: Add SDK-to-S3 validation workflow

**Files:**
- Create: `src/components/workflows/sdk-to-s3-validation-flow.tsx`
- Test: `src/components/workflows/sdk-to-s3-validation-flow.test.tsx`
- Modify: `src/app/shared-services/usage/page.tsx`

- [ ] **Step 1: Write component test**

Create `src/components/workflows/sdk-to-s3-validation-flow.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SdkToS3ValidationFlow } from "./sdk-to-s3-validation-flow";

describe("SdkToS3ValidationFlow", () => {
  it("shows sdk, gateway, event, and s3 validation steps", () => {
    render(
      <SdkToS3ValidationFlow
        sdkConfigured
        gatewayEventsSeen
        kafkaEventsSeen={false}
        s3ObjectsSeen={false}
      />,
    );

    expect(screen.getByText("SDK configured")).toBeInTheDocument();
    expect(screen.getByText("Gateway events observed")).toBeInTheDocument();
    expect(screen.getByText("Kafka events observed")).toBeInTheDocument();
    expect(screen.getByText("S3 objects observed")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement workflow**

Create `src/components/workflows/sdk-to-s3-validation-flow.tsx`:

```tsx
import { type WorkflowStep } from "@/lib/workflow-steps";

type SdkToS3ValidationFlowProps = {
  sdkConfigured: boolean;
  gatewayEventsSeen: boolean;
  kafkaEventsSeen: boolean;
  s3ObjectsSeen: boolean;
};

export function SdkToS3ValidationFlow(props: SdkToS3ValidationFlowProps) {
  const steps: WorkflowStep[] = [
    {
      id: "sdk",
      label: "SDK configured",
      status: props.sdkConfigured ? "complete" : "active",
      detail: "Tribe app has package auth, runtime API Center URL, and tribe credentials.",
    },
    {
      id: "gateway",
      label: "Gateway events observed",
      status: props.gatewayEventsSeen ? "complete" : props.sdkConfigured ? "active" : "pending",
      detail: "API Center receives governed request or shared-service telemetry.",
    },
    {
      id: "kafka",
      label: "Kafka events observed",
      status: props.kafkaEventsSeen ? "complete" : props.gatewayEventsSeen ? "active" : "pending",
      detail: "Confluent topic contains the expected event stream.",
    },
    {
      id: "s3",
      label: "S3 objects observed",
      status: props.s3ObjectsSeen ? "complete" : props.kafkaEventsSeen ? "active" : "pending",
      detail: "Connector writes partitioned objects to the expected AWS S3 destination.",
    },
  ];

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">SDK to S3 validation</h2>
      <div className="grid gap-2">
        {steps.map((step) => (
          <div key={step.id} className="rounded-md border p-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-medium">{step.label}</h3>
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                {step.status}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{step.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Mount the workflow on usage page**

Add the component to `src/app/shared-services/usage/page.tsx` below the existing usage matrix.

- [ ] **Step 4: Run focused test**

Run: `npm run test -- src/components/workflows/sdk-to-s3-validation-flow.test.tsx`

Expected: pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/components/workflows/sdk-to-s3-validation-flow.tsx src/components/workflows/sdk-to-s3-validation-flow.test.tsx src/app/shared-services/usage/page.tsx
git commit -m "feat: add sdk to s3 validation workflow"
```

---

## Phase 5: Secret And Config Drift Without Secret Disclosure

### Task 5.1: Add secret status schema

**Files:**
- Create: `src/lib/secret-status.ts`
- Test: `src/lib/secret-status.test.ts`

- [ ] **Step 1: Write schema tests**

Create `src/lib/secret-status.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { summarizeSecretStatus } from "./secret-status";

describe("summarizeSecretStatus", () => {
  it("marks missing key names without exposing values", () => {
    const summary = summarizeSecretStatus({
      secretName: "api-shared-services-prod",
      exists: true,
      latestEnabledVersion: "4",
      observedKeyNames: ["redis_url", "paymongo_secret_key"],
      requiredKeyNames: ["redis_url", "paymongo_secret_key", "paymongo_webhook_secret"],
    });

    expect(summary.missingKeyNames).toEqual(["paymongo_webhook_secret"]);
    expect(JSON.stringify(summary)).not.toContain("sk_");
  });
});
```

- [ ] **Step 2: Implement schema**

Create `src/lib/secret-status.ts`:

```ts
export type SecretStatusInput = {
  secretName: string;
  exists: boolean;
  latestEnabledVersion?: string;
  observedKeyNames: string[];
  requiredKeyNames: string[];
  updatedAt?: string;
};

export function summarizeSecretStatus(input: SecretStatusInput) {
  const observed = new Set(input.observedKeyNames);

  return {
    secretName: input.secretName,
    exists: input.exists,
    latestEnabledVersion: input.latestEnabledVersion,
    observedKeyNames: input.observedKeyNames.sort(),
    missingKeyNames: input.requiredKeyNames.filter((key) => !observed.has(key)).sort(),
    updatedAt: input.updatedAt,
  };
}
```

- [ ] **Step 3: Run focused test**

Run: `npm run test -- src/lib/secret-status.test.ts`

Expected: pass.

- [ ] **Step 4: Commit**

Run:

```bash
git add src/lib/secret-status.ts src/lib/secret-status.test.ts
git commit -m "feat: add non-secret config status model"
```

### Task 5.2: Add shared-service secret status endpoint

**Files:**
- Create: `src/app/api/local/secret-status/route.ts`
- Test: `src/app/api/local/secret-status/route.test.ts`

- [ ] **Step 1: Write route behavior test**

Create `src/app/api/local/secret-status/route.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { summarizeSecretStatus } from "@/lib/secret-status";

describe("secret status route behavior", () => {
  it("returns key names and missing keys only", () => {
    const summary = summarizeSecretStatus({
      secretName: "api-shared-services-prod",
      exists: true,
      observedKeyNames: ["redis_url"],
      requiredKeyNames: ["redis_url", "paymongo_secret_key"],
    });

    expect(summary).toMatchObject({
      secretName: "api-shared-services-prod",
      exists: true,
      observedKeyNames: ["redis_url"],
      missingKeyNames: ["paymongo_secret_key"],
    });
  });
});
```

- [ ] **Step 2: Implement endpoint shape**

Create `src/app/api/local/secret-status/route.ts`:

```ts
import { NextResponse } from "next/server";
import { summarizeSecretStatus } from "@/lib/secret-status";
import { requireManagementSession } from "@/lib/server/require-management-session";

export async function GET(request: Request) {
  await requireManagementSession({
    authorizationHeader: request.headers.get("authorization"),
  });

  const requiredKeyNames = [
    "redis_url",
    "paymongo_secret_key",
    "paymongo_webhook_secret",
    "paymongo_live_mode",
  ];

  return NextResponse.json({
    sharedServices: [
      summarizeSecretStatus({
        secretName: "api-shared-services-prod",
        exists: false,
        observedKeyNames: [],
        requiredKeyNames,
      }),
    ],
  });
}
```

Replace the hardcoded `exists: false` implementation with Google Secret Manager metadata and JSON key-name inspection in the same task only if a Secret Manager client helper already exists in the repo. If no helper exists, keep this endpoint shape and add the real client in a follow-up commit.

- [ ] **Step 3: Run tests**

Run: `npm run test -- src/lib/secret-status.test.ts src/app/api/local/secret-status/route.test.ts`

Expected: pass.

- [ ] **Step 4: Commit**

Run:

```bash
git add src/lib/secret-status.ts src/lib/secret-status.test.ts src/app/api/local/secret-status
git commit -m "feat: expose non-secret shared-service config status"
```

---

## Phase 6: Unified Service Timeline

### Task 6.1: Add timeline event model

**Files:**
- Create: `src/lib/service-timeline.ts`
- Test: `src/lib/service-timeline.test.ts`

- [ ] **Step 1: Write timeline tests**

Create `src/lib/service-timeline.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mergeTimelineEvents } from "./service-timeline";

describe("mergeTimelineEvents", () => {
  it("sorts newest events first", () => {
    const events = mergeTimelineEvents([
      {
        id: "audit-1",
        occurredAt: "2026-05-17T01:00:00.000Z",
        source: "audit",
        title: "Manifest updated",
        severity: "info",
      },
      {
        id: "alert-1",
        occurredAt: "2026-05-17T02:00:00.000Z",
        source: "alert",
        title: "Smoke failure",
        severity: "error",
      },
    ]);

    expect(events[0].id).toBe("alert-1");
  });
});
```

- [ ] **Step 2: Implement timeline model**

Create `src/lib/service-timeline.ts`:

```ts
export type TimelineSource = "audit" | "alert" | "smoke" | "usage" | "readiness" | "secret";
export type TimelineSeverity = "info" | "warning" | "error" | "success";

export type ServiceTimelineEvent = {
  id: string;
  occurredAt: string;
  source: TimelineSource;
  title: string;
  detail?: string;
  severity: TimelineSeverity;
  metadata?: Record<string, string | number | boolean | null>;
};

export function mergeTimelineEvents(events: ServiceTimelineEvent[]) {
  return [...events].sort(
    (left, right) =>
      new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime(),
  );
}
```

- [ ] **Step 3: Run focused test**

Run: `npm run test -- src/lib/service-timeline.test.ts`

Expected: pass.

- [ ] **Step 4: Commit**

Run:

```bash
git add src/lib/service-timeline.ts src/lib/service-timeline.test.ts
git commit -m "feat: add service timeline event model"
```

### Task 6.2: Add timeline component to service detail

**Files:**
- Create: `src/components/service-timeline.tsx`
- Test: `src/components/service-timeline.test.tsx`
- Modify: `src/components/service-detail-client.tsx`

- [ ] **Step 1: Write component test**

Create `src/components/service-timeline.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ServiceTimeline } from "./service-timeline";

describe("ServiceTimeline", () => {
  it("renders service events", () => {
    render(
      <ServiceTimeline
        events={[
          {
            id: "event-1",
            occurredAt: "2026-05-17T02:00:00.000Z",
            source: "alert",
            title: "Smoke failure",
            severity: "error",
          },
        ]}
      />,
    );

    expect(screen.getByText("Smoke failure")).toBeInTheDocument();
    expect(screen.getByText("alert")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement timeline component**

Create `src/components/service-timeline.tsx`:

```tsx
import { mergeTimelineEvents, type ServiceTimelineEvent } from "@/lib/service-timeline";

type ServiceTimelineProps = {
  events: ServiceTimelineEvent[];
};

export function ServiceTimeline({ events }: ServiceTimelineProps) {
  const sortedEvents = mergeTimelineEvents(events);

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Service timeline</h2>
      <div className="space-y-2">
        {sortedEvents.map((event) => (
          <article key={event.id} className="rounded-md border p-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-medium">{event.title}</h3>
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                {event.source}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{event.occurredAt}</p>
            {event.detail ? (
              <p className="mt-2 text-sm text-muted-foreground">{event.detail}</p>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Mount timeline on `service-detail-client.tsx`**

Create the first timeline panel with an empty event list so the layout and component contract land before data mapping:

```tsx
<ServiceTimeline events={[]} />
```

Add data mapping in the next commit from actual audit, usage, smoke, and readiness queries.

- [ ] **Step 4: Run component test**

Run: `npm run test -- src/components/service-timeline.test.tsx src/components/service-detail-client.test.tsx`

Expected: pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/components/service-timeline.tsx src/components/service-timeline.test.tsx src/components/service-detail-client.tsx
git commit -m "feat: add service timeline panel"
```

---

## Phase 7: Guarded One-Click Operations

### Task 7.1: Add operation preview contract

**Files:**
- Create: `src/lib/operation-preview.ts`
- Test: `src/lib/operation-preview.test.ts`

- [ ] **Step 1: Write preview tests**

Create `src/lib/operation-preview.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createOperationPreview } from "./operation-preview";

describe("createOperationPreview", () => {
  it("summarizes one-click operation impact", () => {
    const preview = createOperationPreview({
      actionId: "shared-service.payment.rollout",
      environment: "live",
      risk: "provider-write",
      changes: ["Validate PayMongo checkout wrapper", "Validate subscription wrapper"],
    });

    expect(preview.confirmationPhrase).toBe("APPLY LIVE CHANGE");
    expect(preview.changes).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Implement preview contract**

Create `src/lib/operation-preview.ts`:

```ts
import type { ActionRisk } from "./action-policy";
import type { ManagementEnvironment } from "./server/management-auth";

type OperationPreviewInput = {
  actionId: string;
  environment: ManagementEnvironment;
  risk: ActionRisk;
  changes: string[];
};

export function createOperationPreview(input: OperationPreviewInput) {
  return {
    actionId: input.actionId,
    environment: input.environment,
    risk: input.risk,
    changes: input.changes,
    confirmationPhrase: input.environment === "live" ? "APPLY LIVE CHANGE" : undefined,
    reasonRequired: input.environment === "live" && input.risk !== "read",
  };
}
```

- [ ] **Step 3: Run focused test**

Run: `npm run test -- src/lib/operation-preview.test.ts`

Expected: pass.

- [ ] **Step 4: Commit**

Run:

```bash
git add src/lib/operation-preview.ts src/lib/operation-preview.test.ts
git commit -m "feat: add guarded operation preview contract"
```

### Task 7.2: Apply preview contract to one provider-impacting action

**Files:**
- Modify: `src/components/shared-service-smoke-tests.tsx`
- Modify: related smoke test route under `src/app/api/local/**/route.ts`
- Test: existing smoke-test component or route test

- [ ] **Step 1: Pick the first guarded action**

Use provider-impacting payment smoke test as the first one-click operation because it proves the shared-service wrapper and external provider boundary.

- [ ] **Step 2: Add preview mode to route**

Support a preview request body:

```ts
{
  "preview": true,
  "operation": "payment.subscription.rollout"
}
```

Return:

```ts
{
  "preview": {
    "actionId": "payment.subscription.rollout",
    "environment": "live",
    "risk": "provider-write",
    "changes": [
      "Create or validate checkout session wrapper",
      "Create or validate subscription wrapper",
      "Confirm webhook persistence path"
    ],
    "confirmationPhrase": "APPLY LIVE CHANGE",
    "reasonRequired": true
  }
}
```

- [ ] **Step 3: Update UI flow**

In `src/components/shared-service-smoke-tests.tsx`, show preview output before the final submit button. In live mode, render:

- exact phrase input
- operator reason textarea
- disabled final submit until both are valid

- [ ] **Step 4: Run focused tests**

Run: `npm run test -- src/components/shared-service-smoke-tests.test.tsx`

Expected: pass if the test file exists. If the test file does not exist, create it and cover preview rendering plus disabled live submit.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/components/shared-service-smoke-tests.tsx src/app/api/local src/lib/operation-preview.ts
git commit -m "feat: preview provider-impacting smoke operations"
```

---

## Phase 8: Route Smoke And Release Validation

### Task 8.1: Add route smoke script

**Files:**
- Create: `scripts/smoke-routes.mjs`
- Modify: `package.json`

- [ ] **Step 1: Add route smoke script**

Create `scripts/smoke-routes.mjs`:

```js
const baseUrl = process.env.MANAGEMENT_PUBLIC_BASE_URL ?? "http://localhost:3000";

const routes = [
  "/",
  "/alerts",
  "/audit",
  "/cost",
  "/dependencies",
  "/manifest-tools",
  "/readiness",
  "/settings",
  "/shared-services",
  "/shared-services/setup",
  "/shared-services/usage",
  "/smoke-tests",
  "/tribes",
  "/tribes/new",
];

let failed = false;

for (const route of routes) {
  const url = new URL(route, baseUrl);
  const response = await fetch(url);
  if (!response.ok) {
    failed = true;
    console.error(`${route} returned ${response.status}`);
  } else {
    console.log(`${route} returned ${response.status}`);
  }
}

if (failed) {
  process.exit(1);
}
```

- [ ] **Step 2: Add package script**

Add to `package.json`:

```json
"smoke:routes": "node scripts/smoke-routes.mjs"
```

- [ ] **Step 3: Run build**

Run: `npm run build`

Expected: production build succeeds.

- [ ] **Step 4: Run route smoke with dev server running**

Run: `npm run smoke:routes`

Expected: all listed routes return `200`.

- [ ] **Step 5: Commit**

Run:

```bash
git add scripts/smoke-routes.mjs package.json
git commit -m "test: add management route smoke script"
```

### Task 8.2: Final release gate

**Files:**
- Modify: `docs/operations/apicenter-management-deployment-runbook.md`

- [ ] **Step 1: Add release checklist**

Append:

```markdown
## Final Release Checklist

- `npm run test` passes.
- `npx tsc --noEmit` passes.
- `npm run build` passes.
- `npm run smoke:routes` passes against the target deployment.
- Descope login works for admin, operator, and observer users.
- Observer users cannot perform write actions.
- Live creates, updates, provider actions, and destructive actions require typed confirmation and operator reason.
- Secret status pages show metadata and key names only.
- No plaintext provider secrets appear in browser source, network responses, logs, screenshots, or copied evidence blocks.
```

- [ ] **Step 2: Run final verification**

Run:

```bash
npm run test
npx tsc --noEmit
npm run build
```

Expected: all commands pass.

- [ ] **Step 3: Commit**

Run:

```bash
git add docs/operations/apicenter-management-deployment-runbook.md
git commit -m "docs: add management release checklist"
```

---

## Execution Order Recommendation

Implement in this order:

1. Phase 0 and Phase 1 to make the deployed app identity-aware.
2. Phase 2 before any real live deployment is used by more than one operator.
3. Phase 3 before exposing the app outside a developer machine.
4. Phase 4 and Phase 5 to reduce operator mistakes around shared services, payments, and secrets.
5. Phase 6 for debugging speed.
6. Phase 7 after the safety model is proven on manual writes.
7. Phase 8 before promoting any deployment.

Recommended first implementation bundle:

- Phase 0
- Phase 1
- Phase 2
- Phase 3.1
- Phase 8.1

This bundle gives the console a deployable safety spine before adding more workflow power.
