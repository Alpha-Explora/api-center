---
title: Feature escalation implementation plan
status: active
authority: informative
owner: platform-maintainers
audience: [engineers, maintainers, agents]
last_verified: "unverified"
verification: unverified
sources: [apps/gateway/src/domains/control-plane/console-access.policy.ts, apps/gateway/src/domains/control-plane/control-plane-admin.controller.ts, apps/gateway/src/domains/control-plane/quota.service.ts, apps/gateway/src/domains/control-plane/capability-configuration.service.ts, apps/gateway/src/domains/control-plane/payouts-console.controller.ts, apps/gateway/src/domains/control-plane/approvals-queue.ts, apps/payments/src/features/payouts/payout-executor.ts, apps/payments/src/features/linked-accounts/linked-accounts-switch.ts, apps/payments/src/features/linked-accounts/payee-onboarding.routes.ts]
---
# Feature Escalation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Changes that spend Alpha Explora's shared accounts or money, or make Alpha Explora responsible, need a platform operator's approval. Project members request them in the console, and an operator approves or rejects them. Every other change stays self-service. The plan also puts per-project caps on paid SMS, holds payouts until payments settle, and keeps every operator action tied to a named person.

**Architecture:**
1. One code-owned **feature catalog** in the gateway says, for each gated feature, whether it is released and which changes need approval. Changing who decides means editing one entry.
2. One **gate** at each place the change happens refuses an escalating change from anyone but a platform operator, with `403 FEATURE_APPROVAL_REQUIRED`.
3. A **feature request** records the exact change asked for. Approving it applies that change, through the same service code the console uses. Nothing is left over to reuse later, and turning something off never needs approval.
4. The console reads each feature's state from one endpoint and shows it with one component: **Coming soon**, **Paused by APICenter**, **Request access**, **Pending**, or the normal controls.
5. Each environment variable now has one job:
   - **Release status** stays configuration: the catalog in code. The deployment variables `PAYOUTS_LIVE_ENABLED`, `LINKED_ACCOUNTS_ENABLED` and `PAYEE_WALLET_ONBOARDING_ENABLED` are removed. Nothing runs for a project until an operator switches it on for that project, and prerequisites such as the payout wallet are checked directly.
   - **Per-project access** is decided by an operator through requests.
   - **Emergency stop** is a per-environment **pause** that operators turn on and off in the console. It takes effect at once, is audited, and needs no deploy.

**Tech Stack:** NestJS gateway with Prisma, Express payments runtime with `pg`, Supabase Postgres migrations with row-level security, the Next.js 16 console with TanStack Query, zod, Jest 30 and Vitest.

**Spec:** the Decisions section below, from the 2026-11-24 access review in this session.

## Implementation status

Implemented on `feat/feature-escalation`. The maintained behavior is in the [console access guide](../../../apps/docs/content/docs/management/access-and-tenancy.mdx), [control-plane operations](../../operations/control-plane-operations.md), and [payouts runbook](../../operations/payouts-runbook.md). The steps below record the original implementation sequence. The remaining production work is in [Rollout](#rollout).

Local verification covered the 52-migration replay, the gateway and runtime suite, the console and SDK suites, and the published contracts and docs. The disposable Postgres integration tests covered competing approvals, retry after an apply failure, SMS and OTP counters, linked-account routing, and signed payout pause and resume.

The production destination inventory found seven webhook destinations and zero direct Pub/Sub push destinations across four projects, including disabled rows. Task 15 removed the direct destination type and its dynamic IAM provisioning. Internal Pub/Sub subscriptions still deliver signed webhooks.

## Decisions

The approach follows how other platforms gate risky features:
- **Stripe:** account capabilities move from requested to pending to active.
- **AWS:** SES starts in a sandbox until production access is granted, and Service Quotas raises a limit on request.
- **Twilio:** sender IDs are registered before use, and trial accounts reach only verified numbers, like APICenter's test recipients.

Each feature has two independent settings:
- **Released?** Product status, from the catalog.
- **Needs approval?** Who may make the change, from the catalog.

User permissions (console roles) stay a third, separate check.

| Feature key | Change requested | Needs approval when |
| :--- | :--- | :--- |
| `plan.upgrade` | `{ planKey }` | `planKey` is `pro` or `enterprise` and differs from the current plan (test and live) |
| `payments.live` | `{}` | Payments is turned on in live |
| `payouts.sending` | `{}` | Sending payouts is turned on for the project in live. In test it stays self-service. |
| `payouts.merchant_account` | `{}` | The project's own merchant account is turned on (test and live) |
| `payouts.payee_wallets` | `{}` | Payee wallet onboarding is turned on for the project (test only) |
| `sms.sender` | `{ senderId }` | A sender ID is pinned or changed in live |
| `email.sender` | `{ fromAddress, dailyLimit }` | In live: the address changes. In both environments: `dailyLimit` is above both the runtime's default and the current limit. |
| `sms.daily_limit` | `{ dailyLimit }` | `dailyLimit` is above both the default of 500 and the current limit (test and live) |
| `sms.international` | `{ prefixes }` | `prefixes` adds a calling code other than `+63` that isn't already allowed (test and live) |

Rules that apply to every feature:
- **No approval needed** for turning something off, choosing a lower plan, re-saving the current value, or any change made by a platform operator.
- **Existing setups** keep working as they are. The gate checks only changes, so nothing needs to be backfilled.
- **Release status** is per environment. `payouts.sending`, `payouts.merchant_account` and `payouts.payee_wallets` (a pilot) are open and self-service in test, and `coming_soon` in live, where the console reads "Not available in live yet". Coming-soon features accept no requests; operators can still switch one on for a pilot project. Each entry lists the environments that take requests (`requestsIn`). To open a feature in live, change its catalog line in a release.
- **Pauses:** operators can pause `payouts_sending`, `payee_wallets` and `merchant_account` per environment. The runtime checks the pause first, then the project switch, then the feature's prerequisite (the payout wallet for sending payouts, and mock payments mode for payee wallets, as today).
  - Pausing keeps every project's approval and switch, so resuming restores exactly what ran before.
  - A paused feature still accepts requests, and operators can still approve them. They take effect on resume.
  - Pausing `merchant_account` stops onboarding actions only (start, reissue link, advance, move). Payments collected through existing merchant accounts are never paused.
  - Pausing `payouts_sending` makes the weekly run skip every pool with reason `paused`, and cash-out returns `409 PAYOUTS_PAUSED`.
- **SMS spending:** each project environment may send at most 500 SMS a day and 500 OTP texts a day by default. Each runtime counts its own sends from its own table, because each runtime's database role can use only its own schema. The approved `dailyLimit` applies to both. A refused send returns `429 DAILY_LIMIT_REACHED`, the same code email uses.
- **SMS destinations:** SMS and OTP texts go only to numbers starting with an allowed calling code. The default is `+63`. A refused send returns `403 SMS_DESTINATION_NOT_ALLOWED`. This is a breaking change, so the rollout lists projects that sent abroad in the last 90 days, and operators approve those before deploying.
- **Notifications:**
  - Operators get an email when a request comes in.
  - The requester gets an email when their request is decided.
  - The other operators get an email when an operator makes an escalating change directly, without a request, for `payments.live`, `payouts.sending`, `payouts.merchant_account` or `plan.upgrade`.
- **Named people only:** approving, rejecting, pausing, resuming and managing operators need a signed-in operator. The shared platform secret (`x-platform-secret`) is refused for these actions with `403 PERSON_REQUIRED`. It keeps every other platform action.
- **Operators:** operators are listed in the database and managed in the console's Platform settings. `PLATFORM_ADMIN_EMAILS` stays as the starting list and can't be removed in the console.
- **Settlement hold:** a share is paid out only after its payment has been paid for at least `settlementHoldDays` days. The default is 7, and operators can set 0 to 30 in payout settings. Earnings gain `settling`, the released amount still inside the hold. Cash-out with only settling earnings returns `409 IN_SETTLEMENT`.
- **Flags:** a variable that only repeats a default, or that the runtime can work out itself, is removed (Task 15). What stays is real configuration: which provider, test or live mode, and local mocks.
- **Quota policies:** a project admin may switch off only quota policies created at project level. Policies created by an organization owner or admin can be switched off only by an organization owner or admin.
- **Out of scope:** live environment activation keeps its existing in-project approval. Domain verification that would let email senders self-serve, and the "golden copy" deployment profile, come later.

## Global Constraints

- New table IDs: `frq_` plus 24 characters from `[a-z0-9]`, the same format as `acr_` in `cp_api_access_requests`.
- Refusal: HTTP 403, `{ success: false, error: { code: "FEATURE_APPROVAL_REQUIRED", message, details: { feature } } }`. The message is `"<Title> needs approval from APICenter. Request it in the console."`
- Only a platform operator (`hasPlatformAccess`) decides a request, and never the person who requested it. Rejecting needs a note of 1 to 500 characters. A request's reason is 1 to 500 characters.
- Requesting needs the same console permission as making the change directly: `environment.write`, or `project.manage` for plans.
- Each feature environment has at most one pending request (a unique index).
- Public contract changes, all additive, ship as contracts 1.6.0 and SDK 3.7.0 in Task 16:
  - The cash-out description lists `PAYOUTS_PAUSED` and `IN_SETTLEMENT`.
  - The SMS send and OTP generate descriptions list `DAILY_LIMIT_REACHED` and `SMS_DESTINATION_NOT_ALLOWED`.
  - `PayeeEarnings` gains `settling`.
- `FEATURE_APPROVAL_REQUIRED` and `PERSON_REQUIRED` are console/admin codes. Cash-out in live for a project without approval keeps returning `409 PAYOUTS_LIVE_DISABLED`.
- Pausing and resuming need a reason of 1 to 500 characters. Audit events: `feature.paused`, `feature.resumed`, `feature.operator_override`, `platform.operator.added` and `platform.operator.removed`.
- Every operator-only action goes through one function, `requireOperatorPerson(actor)` (Task 4). Never check `hasPlatformAccess` directly for these actions.
- Audit events: `feature.requested`, `feature.approved`, `feature.rejected`, `feature.cancelled`, through `AuditEventsService.record`.
- Console copy follows `apps/management/DESIGN.md`: plain sentences, and buttons named with a verb ("Request access").

## Review Focus

1. **An approved change that can't be applied**, for example because the runtime is unreachable: the request must stay pending and show the error. Approving again must retry. It must never show approved when nothing changed. (Task 4)
2. **Two operators approving the same request at once:** only one applies it. The second gets `409 FEATURE_REQUEST_DECIDED`. (Task 2)
3. **The state changed after the request was made**, for example someone pinned another sender: approval applies exactly the requested change, and the audit record shows the before and after values. (Task 4)
4. **Re-saving the email or SMS sheet unchanged in live:** no approval needed. (Task 1, `needsApproval` with `current`)
5. **A requester who has lost access to the project:** they can no longer cancel, because cancelling needs `environment.write` as well as being the requester or a project admin. The request stays pending for operators. (Task 4)

---

### Task 1: Feature catalog

**Files:**
- Create: `apps/gateway/src/domains/control-plane/features/feature-catalog.ts`
- Test: `tests/unit/src/control-plane/features/feature-catalog.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export type FeatureKey = "plan.upgrade" | "payments.live" | "payouts.sending" | "payouts.merchant_account"
    | "payouts.payee_wallets" | "sms.sender" | "email.sender" | "sms.daily_limit" | "sms.international";
  export const SMS_DAILY_LIMIT_DEFAULT = 500;
  export const SMS_DEFAULT_PREFIXES = ["+63"];
  export type Release = "available" | "pilot" | "coming_soon";
  export interface FeatureContext { environment: EnvironmentKind; current: Record<string, unknown> }
  export interface FeatureDefinition<C> {
    key: FeatureKey; title: string; description: string; release: Release;
    environments: EnvironmentKind[];
    change: z.ZodType<C>;
    /** The only place escalation is decided. */
    needsApproval(change: C, context: FeatureContext): boolean;
    summary(change: C): string;
  }
  export const FEATURE_CATALOG: { [K in FeatureKey]: FeatureDefinition<any> };
  export function featureDefinition(key: string): FeatureDefinition<unknown> | undefined;
  export function parseChange(key: FeatureKey, raw: unknown): unknown; // ValidationError on bad input
  ```

- [ ] **Step 1: Write the failing tests.** Each row of the Decisions table gets one `it`, covering both the approval and no-approval cases with the exact values:
  ```ts
  const live = (current = {}) => ({ environment: "live" as const, current });
  expect(FEATURE_CATALOG["plan.upgrade"].needsApproval({ planKey: "enterprise" }, live({ planKey: "standard" }))).toBe(true);
  expect(FEATURE_CATALOG["plan.upgrade"].needsApproval({ planKey: "standard" }, live({ planKey: "pro" }))).toBe(false);
  expect(FEATURE_CATALOG["plan.upgrade"].needsApproval({ planKey: "pro" }, live({ planKey: "pro" }))).toBe(false);
  expect(FEATURE_CATALOG["sms.sender"].needsApproval({ senderId: "MYSHOP" }, { environment: "test", current: {} })).toBe(false);
  expect(FEATURE_CATALOG["sms.sender"].needsApproval({ senderId: "MYSHOP" }, live({ senderId: "MYSHOP" }))).toBe(false);
  expect(FEATURE_CATALOG["sms.sender"].needsApproval({ senderId: "OTHER" }, live({ senderId: "MYSHOP" }))).toBe(true);
  expect(FEATURE_CATALOG["email.sender"].needsApproval({ fromAddress: "a@x.ph", dailyLimit: 600 },
    { environment: "test", current: { defaultDailyLimit: 500 } })).toBe(true);
  expect(FEATURE_CATALOG["email.sender"].needsApproval({ fromAddress: "a@x.ph", dailyLimit: null },
    { environment: "test", current: { defaultDailyLimit: 500 } })).toBe(false);
  expect(FEATURE_CATALOG["sms.daily_limit"].needsApproval({ dailyLimit: 501 }, { environment: "test", current: {} })).toBe(true);
  expect(FEATURE_CATALOG["sms.daily_limit"].needsApproval({ dailyLimit: 100 }, live())).toBe(false);
  expect(FEATURE_CATALOG["sms.international"].needsApproval({ prefixes: ["+63", "+65"] }, live({ prefixes: ["+63"] }))).toBe(true);
  expect(FEATURE_CATALOG["sms.international"].needsApproval({ prefixes: ["+63"] }, live({ prefixes: ["+63", "+65"] }))).toBe(false);
  expect(() => parseChange("sms.international", { prefixes: ["65"] })).toThrow(ValidationError); // must be + and 1 to 4 digits
  expect(FEATURE_CATALOG["payouts.sending"].release).toBe("coming_soon");
  expect(FEATURE_CATALOG["payouts.payee_wallets"].environments).toEqual(["test"]);
  expect(() => parseChange("sms.sender", { senderId: "" })).toThrow(ValidationError);
  ```
- [ ] **Step 2: Run the tests** with `npx jest tests/unit/src/control-plane/features/feature-catalog.spec.ts`. Expected: FAIL, the module is not found.
- [ ] **Step 3: Implement `feature-catalog.ts`.** Plain data and pure functions, with no Nest imports.
  - Titles: "Pro or Enterprise plan", "Payments in live", "Sending payouts", "Project merchant account", "Payee wallet onboarding", "SMS sender ID", "Email sender", "Higher SMS limit", "SMS to other countries".
  - `sms.sender` change: `senderId`, 1 to 11 characters, `^[A-Za-z0-9 ]+$`.
  - `email.sender` change: `fromAddress` as an email of up to 320 characters, `dailyLimit` as a positive integer or `null`.
  - `current` keys the gates pass: `planKey`, `enabled`, `senderId`, `fromAddress`, `dailyLimit`, `defaultDailyLimit`.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** with message `feat(gateway): add the feature catalog`.

### Task 2: Feature requests: table and service

**Files:**
- Create: `supabase/migrations/20261125000100_control_plane_feature_requests.sql`
- Modify: `prisma/schema.prisma`, to add `model CpFeatureRequest` next to `CpApiAccessRequest`
- Create: `apps/gateway/src/domains/control-plane/features/feature-request.service.ts`
- Test: `tests/unit/src/control-plane/features/feature-request.service.spec.ts`, plus a database case in the existing control-plane database test folder (copy the setup of the `cp_api_access_requests` RLS test)

**Interfaces:**
- Consumes: `FeatureKey`, `featureDefinition` and `parseChange` from Task 1. `withTenant` and `EnvironmentScope` as other control-plane services use them.
- Produces:
  ```ts
  export type FeatureRequestStatus = "pending" | "approved" | "rejected" | "cancelled";
  export interface FeatureRequest { id: string; organizationId: string; projectId: string; environmentKind: EnvironmentKind;
    feature: FeatureKey; change: Record<string, unknown>; reason: string; status: FeatureRequestStatus;
    requestedBy: string; decidedBy: string | null; decidedAt: string | null; decisionNote: string | null; createdAt: string }
  class FeatureRequestService {
    create(scope: EnvironmentScope, input: { feature: FeatureKey; change: unknown; reason: string }, actor: string): Promise<FeatureRequest>;
    listForEnvironment(scope: EnvironmentScope): Promise<FeatureRequest[]>; // newest first, last 50
    get(id: string): Promise<FeatureRequest>;                                 // platform scope; NotFoundError
    cancel(scope: EnvironmentScope, id: string, actor: string): Promise<FeatureRequest>;
    /** Claims the pending row and returns it. Task 4 applies the change and then calls finish. */
    claim(id: string, decider: string): Promise<FeatureRequest>;
    finish(id: string, outcome: { status: "approved" | "rejected"; decider: string; note?: string }): Promise<FeatureRequest>;
    release(id: string): Promise<void>; // returns a claimed row to pending after a failed apply
  }
  ```

- [ ] **Step 1: Write the migration.**
  - Table `apic_catalog.cp_feature_requests` with these columns: `id` (checked against `^frq_[a-z0-9]{24}$`), `organization_id uuid`, `project_id`, `environment_id`, `environment_kind` (`test`|`live`), `feature` (checked against the 9 keys), `change jsonb NOT NULL DEFAULT '{}'`, `reason` (1 to 500), `status` (`pending`|`deciding`|`approved`|`rejected`|`cancelled`, default `pending`), `requested_by`, `decided_by`, `decided_at`, `decision_note`, `created_at`.
  - Foreign key `(environment_id, project_id, organization_id)` to `cp_environments`.
  - Unique index on `(environment_id, feature)` where status is `pending` or `deciding`.
  - Index on `(organization_id, project_id, created_at DESC)`.
  - Row-level security, the grant to `api_center_app` and the tenant policy, copying the `DO $$` block in `20261114000700_control_plane_published_apis.sql`.
  - `deciding` is internal: claiming a row is a conditional update from `pending` to `deciding`, so two operators can't both apply it. API responses show `deciding` as `pending`.
- [ ] **Step 2: Write the failing service tests:**
  - `create` refuses a coming-soon feature (`409 FEATURE_NOT_AVAILABLE`), a feature not offered in this environment (`409 FEATURE_NOT_AVAILABLE`), and a second pending request (`409 FEATURE_REQUEST_PENDING`).
  - `claim` succeeds once and then throws `409 FEATURE_REQUEST_DECIDED`.
  - `claim` by the requester throws `403 FEATURE_SELF_APPROVAL`.
  - `release` returns the row to `pending`.
  - `cancel` works only while pending.
  - Database test: a tenant-scoped transaction for another organization can't see the row.
- [ ] **Step 3: Run the tests.** Expected: FAIL.
- [ ] **Step 4: Implement the service and the Prisma model.** Generate IDs the same way as `acr_`. Record the `feature.requested` and `feature.cancelled` audit events here.
- [ ] **Step 5: Run the tests**, plus `npx prisma validate` and `npm run db:verify:replay`. Expected: PASS.
- [ ] **Step 6: Commit** with message `feat(gateway): store feature requests`.

### Task 3: The gate at every place a gated change is made

**Files:**
- Create: `apps/gateway/src/domains/control-plane/features/feature-gate.ts`
- Modify:
  - `apps/gateway/src/domains/control-plane/control-plane-admin.controller.ts`, at three routes: `PUT ${ENV}/plan` (around line 393), `PUT ${ENV}/capabilities/:capability` (around 676) and `PUT ${ENV}/capabilities/:capability/configuration` (around 546)
  - `apps/gateway/src/domains/control-plane/payouts-console.controller.ts`:
    - The `PUT linked-account/enabled` route becomes `WRITE` instead of `OPERATE`, and is gated when `enabled` is true.
    - Add an `OPERATE` route, `PUT project-features/:feature` (`payouts_sending` or `payee_wallets`), that forwards to the Task 5 runtime route. It is how an operator switches these on or off directly; nobody else has a direct route.
- Test: `tests/unit/src/control-plane/features/feature-gate.spec.ts` and the existing controller specs for those routes

**Interfaces:**
- Consumes: Task 1.
- Produces:
  ```ts
  export class FeatureApprovalRequiredError extends AppError {} // 403, code FEATURE_APPROVAL_REQUIRED, details { feature }
  export function assertFeatureAllowed(actor: ConsoleActor, feature: FeatureKey, change: unknown, context: FeatureContext): void;
  ```
  Platform actors always pass. Otherwise the function throws when `needsApproval` is true, or when the feature's release is `coming_soon`.

- [ ] **Step 1: Write the failing tests:**
  - A project admin setting `enterprise` gets 403 `FEATURE_APPROVAL_REQUIRED` with `details.feature === "plan.upgrade"`, and `quotas.assignPlan` is not called.
  - A platform operator setting `enterprise` succeeds.
  - Enabling `payments` in live as a project admin gets 403. Disabling succeeds. Enabling in test succeeds.
  - Pinning SMS sender `OTHER` in live gets 403. `DELETE` of the SMS configuration succeeds.
  - In the email configuration, `PUT` above the default limit gets 403 in test. The current `current` values come from the runtime's `GET` (`dailyLimit`, `defaults.dailyLimit`, `fromAddress`).
  - Enabling the linked account as a project admin gets 403 `FEATURE_APPROVAL_REQUIRED`. Disabling it as a project admin still gets 403 `Only APICenter platform operators…`, because turning it off stays an operator action.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement the gate** and call it in each route after `authorizeEnvironment` or `access.require` and before the service call.
  - Load `current` with existing reads: `quotas.currentPlan(scope)`, the capability installation status, and `configuration.configure(scope, capability, "GET")`.
  - Add a small `readCurrent` helper per route; don't add a new service.
- [ ] **Step 4: Run the tests**, plus `npm run typecheck --workspace @apicenter/gateway`. Expected: PASS.
- [ ] **Step 5: Commit** with message `feat(gateway): require approval for escalating changes`.

### Task 4: Deciding requests and applying the change

**Files:**
- Create:
  - `apps/gateway/src/domains/control-plane/payments-runtime.client.ts`, extracted from `PayoutsConsoleController.forward`
  - `apps/gateway/src/domains/control-plane/features/feature-appliers.ts`
  - `apps/gateway/src/domains/control-plane/features/feature-requests.controller.ts`
- Modify: `payouts-console.controller.ts` (use the client), `control-plane.module.ts` (register the providers)
- Test: `tests/unit/src/control-plane/features/feature-requests.controller.spec.ts`, plus the existing `payouts-console` spec, which must still pass unchanged

**Interfaces:**
- Consumes: Tasks 1 to 3. `QuotaService.assignPlan`, `ControlPlaneAdminService.setCapability`, `CapabilityConfigurationService.configure`, `AuditEventsService.record`.
- Produces:
  ```ts
  class PaymentsRuntimeClient { call(scope: { organizationId: string; projectId: string; environment: EnvironmentKind },
    scopeAction: "payments:payouts:read" | "payments:payouts:write", method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<unknown> }
  type FeatureApplier = (scope: EnvironmentScope, change: any, actor: string) => Promise<void>;
  /** In console-access.policy.ts. Throws 403 PERSON_REQUIRED for the platform secret and 403 for non-operators; returns the operator's email. */
  export function requireOperatorPerson(actor: ConsoleActor): string;
  export const FEATURE_APPLIERS: Record<FeatureKey, FeatureApplier>; // built in a Nest provider from the services above
  ```
  Routes:
  - `GET  admin/control-plane/organizations/:organizationId/projects/:projectId/environments/:environment/features`: `environment.read`. Returns `{ data: FeatureView[] }`, where `FeatureView = { key, title, description, release, offered: boolean, paused: boolean, pending: FeatureRequest | null, last: FeatureRequest | null }`. `paused` comes from the payments runtime's pauses (Task 6) for the three payouts features. It is `false` until Task 6 lands and whenever the runtime is unreachable.
  - `POST …/environments/:environment/feature-requests`: body `{ feature, change, reason }`. Needs `environment.write`, or `project.manage` for `plan.upgrade`. Returns 201.
  - `POST …/environments/:environment/feature-requests/:requestId/cancel`: the requester, or the project admin.
  - `POST admin/control-plane/feature-requests/:requestId/decision`: platform operators only. Body `{ approve: true } | { approve: false, note }`.

- [ ] **Step 1: Write the failing tests:**
  - Approving `sms.sender` `{ senderId: "MYSHOP" }` calls `configuration.configure(scope, "sms", "PUT", { senderId: "MYSHOP" }, "approved:<operator>")`, marks the request approved, and records `feature.approved` with `before` and `after`.
  - Approving when the applier throws a `BadGatewayError` returns that error and leaves the request `pending`. A second approve applies it.
  - Rejecting without a note is a 400. Rejecting with a note leaves the configuration unchanged.
  - A non-platform member's decision call gets 403.
  - A decision made with the platform secret (`actor.kind === "platform"`) gets 403 `PERSON_REQUIRED`, and the request stays pending.
  - Cancelling as the requester after their project role was removed gets 403, and the request stays pending.
  - Appliers:
    - `payouts.sending` calls `PUT /admin/payouts/project-features/payouts_sending` with `{ enabled: true, actor }`.
    - `payouts.payee_wallets` calls `PUT /admin/payouts/project-features/payee_wallets`.
    - `payouts.merchant_account` calls `PUT /admin/payouts/linked-account/enabled`.
  - `GET features` shows each catalog entry with `offered` set from its `environments` list, and the pending request.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Decision flow: `claim`, then (when approving) run the applier as the operator, then `finish`. If the applier throws, call `release` and rethrow.
  - Extract `forward`'s HTTP and token logic into `PaymentsRuntimeClient` without changing behavior.
- [ ] **Step 4: Run the tests**, plus the full gateway unit suite (`npx jest tests/unit/src/control-plane`). Expected: PASS.
- [ ] **Step 5: Commit** with message `feat(gateway): decide feature requests and apply the change`.

### Task 5: Payments runtime: per-project switches for sending payouts and payee wallets

**Files:**
- Create:
  - `supabase/migrations/20261125000200_payments_project_features.sql`
  - `apps/payments/src/features/payouts/project-features.ts`
- Modify:
  - `payout-executor.ts`: `assertLiveEnabled` becomes per project
  - `availability.ts`
  - `payouts.routes.ts`: the overview, plus the new admin route
  - `apps/payments/src/features/linked-accounts/payee-onboarding.routes.ts`
  - `apps/payments/src/server.ts`
- Test: `tests/unit/src/payments/payouts/project-features.spec.ts`, plus updates to `payout-executor` and `availability` specs and the payee onboarding route spec

**Interfaces:**
- Produces:
  ```ts
  export type ProjectFeature = "payouts_sending" | "payee_wallets";
  export interface ProjectFeatureSwitches {
    enabled(environment: Environment, projectId: string, feature: ProjectFeature): Promise<boolean>;
    set(environment: Environment, projectId: string, feature: ProjectFeature, enabled: boolean, actor: string): Promise<void>;
  }
  export function createProjectFeatureSwitches(pool: Pool | undefined): ProjectFeatureSwitches; // no pool: every check is false
  export async function sendingEnabled(switches: ProjectFeatureSwitches, environment: Environment, projectId: string): Promise<boolean>;
  // test: true. live: switches.enabled(live, projectId, 'payouts_sending'). PAYOUTS_LIVE_ENABLED is removed.
  ```
  Route: `PUT /admin/payouts/project-features/:feature`, with body `{ enabled: boolean, actor: string }`, using the same admin auth as `/admin/payouts/linked-account/enabled`.

- [ ] **Step 1: Write the migration.** Table `shared_payment.project_feature_settings` with `environment` (`test`|`live`), `project_id`, `feature` (`payouts_sending`|`payee_wallets`), `enabled boolean NOT NULL`, `updated_by`, `updated_at`, and primary key `(environment, project_id, feature)`. Grant it like `project_linked_account_settings`.
- [ ] **Step 2: Write the failing tests:**
  - In live, with the project not enabled, `runPayouts` skips the pool with reason `project_not_enabled`, and cash-out throws `409 PAYOUTS_LIVE_DISABLED`.
  - Setting `PAYOUTS_LIVE_ENABLED`, `LINKED_ACCOUNTS_ENABLED` or `PAYEE_WALLET_ONBOARDING_ENABLED` changes nothing. A test asserts each is no longer read: `grep` over `apps/payments/src` finds none of the three names.
  - Linked accounts: `createLinkedAccountsSwitch` drops `environmentEnabled()`, and `enabledFor` is the project switch alone.
  - With the project enabled, payouts are submitted.
  - In test, the switch is ignored.
  - The overview reports `transfers.reason === "not_enabled"` in live when the project isn't enabled. Replace the reason `live_payouts_disabled` with `not_enabled` in `availability.ts` and in the console's `availabilityMessage`.
  - Payee onboarding in test with the project off returns `503 PAYEE_ONBOARDING_DISABLED`.
  - The admin route stores the switch and refuses unknown features with a 400.
- [ ] **Step 3: Run the tests.** Expected: FAIL.
- [ ] **Step 4: Implement.**
  - `runPayouts` checks `sendingEnabled` per pool, caching it per project for the run.
  - Delete `assertLiveEnabled` and `payeeOnboardingEnabled`. The emergency stop is the Task 6 pause.
  - The payee wallets check becomes the project switch, plus mock payments mode as today. Remove the three variables from `infra/gcp/cloud-run/*.yaml`, `.env.example` files and `docs/operations/payouts-runbook.md`.
- [ ] **Step 5: Run the tests** with `npx jest tests/unit/src/payments` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** with message `feat(payments): switch payouts sending and payee wallets per project`.

### Task 6: Platform pauses

**Files:**
- Create:
  - `supabase/migrations/20261125000300_payments_feature_pauses.sql`
  - `apps/payments/src/features/payouts/feature-pauses.ts`
- Modify:
  - `payout-executor.ts`, `availability.ts` and `payouts.routes.ts` (the overview, plus the new admin routes)
  - `apps/payments/src/features/linked-accounts/linked-accounts.routes.ts` and `payee-onboarding.routes.ts`
  - `apps/payments/src/server.ts`
  - Gateway: `payouts-console.controller.ts`, with two new routes (below)
  - `contracts/public/apicenter.openapi.yaml`: add `PAYOUTS_PAUSED` to the cash-out description, then run `npm run contracts:sync-json`
  - `packages/sdk/src/services/payments.ts`: the `cashOut` JSDoc
- Test:
  - `tests/unit/src/payments/payouts/feature-pauses.spec.ts`
  - The executor, availability and linked-account route specs
  - The `payouts-console` controller spec

**Interfaces:**
- Consumes: `ProjectFeatureSwitches` and `sendingEnabled` from Task 5. `PaymentsRuntimeClient` from Task 4.
- Produces:
  ```ts
  export type PausableFeature = "payouts_sending" | "payee_wallets" | "merchant_account";
  export interface FeaturePause { feature: PausableFeature; paused: boolean; reason: string | null; updatedBy: string | null; updatedAt: string | null }
  export interface FeaturePauses {
    list(environment: Environment): Promise<FeaturePause[]>; // all three, unpaused when no row
    isPaused(environment: Environment, feature: PausableFeature): Promise<boolean>;
    set(environment: Environment, feature: PausableFeature, paused: boolean, reason: string, actor: string): Promise<void>;
  }
  export function createFeaturePauses(pool: Pool | undefined): FeaturePauses; // no pool: nothing is paused
  export class FeaturePausedError extends PayMongoError {} // 409; code PAYOUTS_PAUSED, PAYEE_ONBOARDING_PAUSED or MERCHANT_ACCOUNT_PAUSED
  ```
  Payments routes (admin auth, as for the linked-account routes):
  - `GET /admin/payouts/feature-pauses` returns `{ data: FeaturePause[] }`.
  - `PUT /admin/payouts/feature-pauses/:feature` takes `{ paused: boolean, reason: string, actor: string }`.

  Gateway routes:
  - `GET admin/control-plane/payouts/feature-pauses/:environment`, platform operators only.
  - `PUT admin/control-plane/payouts/feature-pauses/:environment/:feature`, through `requireOperatorPerson`. It records `feature.paused` or `feature.resumed`.

  Payouts availability gains the reason `paused`.

- [ ] **Step 1: Write the migration.** Table `shared_payment.feature_pauses` with `environment` (`test`|`live`), `feature` (the three keys), `paused boolean NOT NULL`, `reason text NOT NULL` (1 to 500), `updated_by`, `updated_at`, and primary key `(environment, feature)`. Grant it like `project_feature_settings`.
- [ ] **Step 2: Write the failing tests:**
  - With `payouts_sending` paused in live, `runPayouts` skips every pool with reason `paused`. Cash-out throws `409 PAYOUTS_PAUSED`, even for an enabled project. The overview reports `transfers: { available: false, reason: "paused" }`.
  - Resuming restores sending for a project that was enabled before the pause, with no change to its switch.
  - With `merchant_account` paused, `POST /admin/payouts/linked-account` (start) returns `409 MERCHANT_ACCOUNT_PAUSED`. Checkout creation through an existing linked account still succeeds.
  - With `payee_wallets` paused, onboarding start returns `409 PAYEE_ONBOARDING_PAUSED`, and `GET` onboarding still works.
  - A pause in test doesn't affect live.
  - The gateway `PUT` as a non-operator gets 403. With the platform secret it gets 403 `PERSON_REQUIRED`. Without a reason it gets 400.
- [ ] **Step 3: Run the tests.** Expected: FAIL.
- [ ] **Step 4: Implement.**
  - Order of checks: pause, then project switch, then prerequisite.
  - `runPayouts` reads the pause once per run.
  - Update the cash-out description in the OpenAPI source, then run `npm run contracts:sync-json && npm run contracts:validate && npm run check:contracts`.
- [ ] **Step 5: Run the tests** with `npx jest tests/unit/src/payments tests/unit/src/control-plane tests/unit/contracts` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** with message `feat(payouts): let operators pause payout features without a deploy`.

### Task 7: Approvals queue shows feature requests

**Files:**
- Modify:
  - `apps/gateway/src/domains/control-plane/approvals-queue.ts`: add item kind `feature`
  - `approvals-queue.service.ts`: load `cp_feature_requests` in the same tenant transaction
  - `approvals-queue.controller.ts`: an organization's list includes its feature requests, even though only operators decide them
- Test: the existing approvals-queue spec

**Interfaces:**
- Produces: `ApprovalItem` gains `| (ItemBase & { kind: "feature"; feature: FeatureKey; title: string; change: Record<string, unknown>; reason: string; environmentKind: EnvironmentKind; decidedBy: "platform" })`. `summary` comes from the catalog's `summary(change)`. Decided items map `approved`/`rejected`/`cancelled` to `decision`.

- [ ] **Step 1: Write the failing tests.**
  - The platform list includes a pending `sms.sender` request with summary `Pin sender ID MYSHOP in live`.
  - An organization owner's list includes it too, without the `project.manage` filter applied to other kinds.
  - The decided view includes a rejected request with its note.
- [ ] **Step 2: Run the tests**, implement, and run them again. Expected: FAIL, then PASS.
- [ ] **Step 3: Commit** with message `feat(gateway): list feature requests in the approvals queue`.

### Task 8: Console: request access, pending state and operator decisions

**Files:**
- Create:
  - `apps/management/src/features/control-plane/data/features.ts`
  - `apps/management/src/features/control-plane/model/features.ts`
  - `apps/management/src/components/patterns/feature-access.tsx`
- Modify:
  - `views/quotas/plan-picker.tsx`
  - `views/capabilities/capabilities-page.tsx` (the payments switch in live)
  - `views/capabilities/sms-sender-sheet.tsx` and `email-sender-sheet.tsx`
  - `views/payouts/payouts-page.tsx` (sending), `linked-account-panel.tsx` and `payee-sheet.tsx`
  - `model/approvals.ts`, for the `feature` kind, its label "Feature access" and its link (the item's project environment)
  - `views/approvals/approvals-page.tsx`, for an inline Approve/Reject dialog on `feature` items, shown to platform operators only
  - Platform settings page (`views/settings`): a "Payout features" panel for platform operators, with **Pause** and **Resume** per environment, a required reason, and the last change's person, time and reason
  - `apps/management/DESIGN.md`, for a `FeatureAccess` row in the patterns table
- Test:
  - `tests/unit/src/features/control-plane/model/features.test.ts`
  - `tests/unit/src/features/control-plane/feature-access.test.tsx`
  - Updates to `payouts-page.test.tsx`, plus approvals page tests (create them if none exist)

**Interfaces:**
- Consumes: the Task 4 routes, the Task 6 pause routes and the Task 7 item shape.
- Produces:
  ```ts
  // model/features.ts
  export const featureViewSchema: z.ZodType<FeatureView>;
  export type FeatureAccessState = "coming_soon" | "not_offered" | "paused" | "pending" | "rejected" | "request";
  export function featureAccessState(view: FeatureView): FeatureAccessState;
  // components/patterns/feature-access.tsx
  export function FeatureAccess(props: { feature: FeatureKey; change: Record<string, unknown>; children?: ReactNode }): JSX.Element;
  ```
  `FeatureAccess` covers the case where the person isn't a platform operator and the change needs approval. It renders the `ComingSoonBadge`, or a **Request access** button that opens a dialog with a reason field, or "Pending approval from APICenter", plus a **Cancel request** link for the requester. For a rejection it shows "Rejected: <note>" and offers to request again.

  The console does not copy the approval rules. Saves go through as usual, and a `403 FEATURE_APPROVAL_REQUIRED` response opens the request dialog with the attempted change filled in. Pending and rejected states come from `GET …/features`. Features with no direct control (sending payouts, payee wallets, the project merchant account) show **Request access** whenever the view is `offered` and has no pending request.

- [ ] **Step 1: Write the failing tests:**
  - `featureAccessState` for each `FeatureView` shape.
  - Choosing Enterprise in the plan picker as a project admin: the save returns `403 FEATURE_APPROVAL_REQUIRED`, which opens the request dialog, and submitting posts `{ feature: "plan.upgrade", change: { planKey: "enterprise" }, reason }`.
  - In the live SMS sheet, saving a new sender as a project admin shows the request dialog with the sender filled in.
  - The payouts page in live with a pending `payouts.sending` shows "Pending approval from APICenter".
  - On the approvals page as a platform operator, rejecting needs a note and approving calls `decision` with `{ approve: true }`.
  - On the approvals page as an organization owner, a feature item shows "Waiting for APICenter" with no decision buttons.
  - A paused `payouts.sending` view shows "Paused by APICenter", and still offers **Request access** when the project isn't enabled.
  - In platform settings, pausing needs a reason and calls the gateway `PUT` with `{ paused: true, reason }`. The panel is hidden for non-operators.
- [ ] **Step 2: Run the tests** with `npm run test --workspace @apicenter/management`. Expected: FAIL.
- [ ] **Step 3: Implement**, reusing `Notice`, `GuardedButton` and `ComingSoonBadge`.
- [ ] **Step 4: Run the tests**, plus `npx tsc --noEmit` in `apps/management`. Expected: PASS.
- [ ] **Step 5: Commit** with message `feat(management): request access to gated features`.

### Task 9: SMS daily limit

**Files:**
- Create:
  - `supabase/migrations/20261125000400_sms_limits.sql`
  - `apps/sms/src/shared/sms-limits.ts`
  - `apps/otp/src/shared/otp-sms-limits.ts`
- Modify:
  - `apps/sms/src/features/send-sms/send-sms.service.ts`
  - `apps/sms/src/shared/project-sender-admin.ts`, `project-sender.ts` and `postgres-sms-store.ts`
  - `apps/otp/src/features/generate-otp/generate-otp.service.ts` and the OTP settings admin handler and store
  - Gateway: `capability-configuration.service.ts` (`auditFields`), `feature-appliers.ts` (the `sms.daily_limit` applier) and the configuration gate from Task 3
  - Console: `sms-sender-sheet.tsx` and `otp-settings-sheet.tsx`, each with a "Daily limit" field showing the default
  - `contracts/public/apicenter.openapi.yaml`: the SMS send and OTP generate descriptions list `DAILY_LIMIT_REACHED`
- Test:
  - `tests/unit/src/sms/sms-limits.spec.ts` and `tests/unit/src/otp/otp-sms-limits.spec.ts`
  - The gateway appliers spec
  - The console sheet tests

**Interfaces:**
- Consumes: `SMS_DAILY_LIMIT_DEFAULT` from Task 1. The applier map from Task 4.
- Produces:
  ```ts
  // apps/sms/src/shared/sms-limits.ts (the OTP file has the same shape over otp_challenges with channel 'sms')
  export async function reserveDailySend(pool: Pool, input: { projectId: string; environment: 'test' | 'live'; limit: number; now: Date }): Promise<boolean>;
  ```
  Limit storage:
  - `shared_sms.project_senders.daily_limit integer NULL`, where NULL means the default.
  - `shared_otp.project_settings.sms_daily_limit integer NULL`.

  The admin `PUT` bodies accept `dailyLimit`. Each runtime reads `SMS_DAILY_LIMIT_DEFAULT` from its environment, defaulting to 500.

- [ ] **Step 1: Write the migration.**
  - Add the two columns.
  - Add `shared_sms.sms_daily_usage` (`project_id`, `environment`, `day date`, `count integer`, primary key on all three except `count`), with grants for the SMS role only.
  - Add `shared_otp.otp_sms_daily_usage` with the same shape, with grants for the OTP role only.
- [ ] **Step 2: Write the failing tests:**
  - With limit 2, the third send returns `429 DAILY_LIMIT_REACHED`, and the provider is not called.
  - 10 concurrent sends with limit 5 deliver exactly 5. The reservation is one `INSERT … ON CONFLICT DO UPDATE SET count = count + 1 WHERE count < limit RETURNING`.
  - The count resets at midnight Asia/Manila.
  - A suppressed test send (`suppressDelivery`) doesn't count.
  - Without a database pool, the limit isn't enforced and a warning is logged once.
  - Gateway: approving `sms.daily_limit` `{ dailyLimit: 2000 }` calls `PUT` on both the SMS and OTP configuration with `dailyLimit: 2000`. Lowering the limit to 100 in live as a project admin needs no approval.
- [ ] **Step 3: Run the tests.** Expected: FAIL.
- [ ] **Step 4: Implement.** Reserve the send before calling the provider. If the provider then fails, don't refund the reservation: the limit is a spending ceiling, and failed sends can still cost money.
- [ ] **Step 5: Run the tests**, plus `npm run contracts:sync-json && npm run contracts:validate`, plus the SMS, OTP and gateway suites. Expected: PASS.
- [ ] **Step 6: Commit** with message `feat(sms): cap SMS and OTP texts per project per day`.

### Task 10: SMS destination countries

**Files:**
- Create:
  - `supabase/migrations/20261125000500_sms_destinations.sql`
  - `packages/runtime/src/sms-destinations.js`, with its `.d.ts` entry
  - `scripts/report-international-sms.ts`
- Modify:
  - `apps/sms/src/features/send-sms/send-sms.service.ts` and `apps/otp/src/features/generate-otp/generate-otp.service.ts`
  - The SMS and OTP admin handlers and stores
  - Gateway: the `sms.international` applier and the configuration gate
  - Console: the SMS sender sheet's "Countries" field
  - `contracts/public/apicenter.openapi.yaml`: the SMS send and OTP generate descriptions list `SMS_DESTINATION_NOT_ALLOWED`
- Test:
  - `tests/unit/src/runtime/sms-destinations.spec.ts`
  - The SMS and OTP send specs
  - The gateway appliers spec

**Interfaces:**
- Produces:
  ```ts
  export function destinationAllowed(phone: string, prefixes: readonly string[]): boolean; // E.164 phone; prefix match on "+<digits>"
  export const DEFAULT_SMS_PREFIXES: readonly string[]; // ["+63"]
  ```
  Storage:
  - `shared_sms.project_senders.allowed_prefixes text[] NULL`.
  - `shared_otp.project_settings.sms_allowed_prefixes text[] NULL`.

  NULL means the default. Each prefix matches `^\+[1-9]\d{0,3}$`.

- [ ] **Step 1: Write the failing tests:**
  - `destinationAllowed("+639171234567", ["+63"])` is true.
  - `destinationAllowed("+6591234567", ["+63"])` is false.
  - `destinationAllowed("+6591234567", ["+63", "+65"])` is true.
  - A non-E.164 value is false.
  - SMS send to `+65…` returns `403 SMS_DESTINATION_NOT_ALLOWED` before the daily limit is reserved and before the provider is called. The same applies to OTP generate over SMS.
  - Email OTP is unaffected.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Add the migration with both columns.
  - Add the check before the Task 9 reservation.
  - Write `scripts/report-international-sms.ts`. It counts, per project and environment, SMS and OTP sends to numbers outside `+63` in the last 90 days, from `sms_messages` and `otp_challenges`. It prints project IDs, calling codes and counts, never phone numbers, and runs read-only like the usage report script.
- [ ] **Step 4: Run the tests**, plus the contract checks. Expected: PASS.
- [ ] **Step 5: Commit** with message `feat(sms): send SMS only to allowed countries`.

### Task 11: Notifications and operator-override alerts

**Files:**
- Create:
  - `apps/gateway/src/domains/control-plane/platform-mail.service.ts`, extracted from the `POST /admin/platform-messages` call in `member-invite.service.ts`
  - `apps/gateway/src/domains/control-plane/features/feature-notifications.ts`
- Modify:
  - `member-invite.service.ts`, to use the new service
  - `feature-request.service.ts` (create), the Task 4 decision flow, and the Task 3 gate call sites (operator overrides)
- Test: `tests/unit/src/control-plane/features/feature-notifications.spec.ts`, plus the existing member-invite spec, which must still pass unchanged

**Interfaces:**
- Consumes: the operator list from Task 12 when present, otherwise `PLATFORM_ADMIN_EMAILS`.
- Produces:
  ```ts
  class PlatformMailService { send(input: { to: string[]; subject: string; text: string }): Promise<"sent" | "not_sent"> }
  export function requestCreatedMail(request: FeatureRequest, title: string, consoleUrl: string): { subject: string; text: string };
  export function requestDecidedMail(request: FeatureRequest, title: string, consoleUrl: string): { subject: string; text: string };
  export function operatorOverrideMail(input: { operator: string; feature: FeatureKey; title: string; projectName: string; environment: EnvironmentKind; change: Record<string, unknown> }): { subject: string; text: string };
  ```
  Mail failures never fail the request, decision or change. They're logged, and recorded on the audit event as `notification: "not_sent"`.

- [ ] **Step 1: Write the failing tests:**
  - Creating a request mails every operator except the requester, with subject `"APICenter: <title> requested for <project> (<environment>)"` and a link to `/approvals`.
  - A decision mails the requester. The subject is `"APICenter: <title> approved"`, or `"… rejected"` with the note in the body.
  - An operator enabling `payments.live` directly mails the other operators and records `feature.operator_override`.
  - An operator unpinning an SMS sender sends nothing, because it isn't an escalation.
  - When `PlatformMailService` throws, the request is still created.
  - Request age: approvals queue items gain `ageHours` (Task 7's item type), and the console shows "Waiting 3 days".
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.** Detect overrides in the Task 3 gate: it returns `"override"` when the actor is an operator and `needsApproval` is true. The caller notifies after the change succeeds.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** with message `feat(gateway): notify operators and requesters about feature access`.

### Task 12: Operators in the database

**Files:**
- Create:
  - `supabase/migrations/20261125000600_platform_operators.sql`
  - `apps/gateway/src/domains/control-plane/platform-operators.service.ts`
  - `apps/gateway/src/domains/control-plane/platform-operators.controller.ts`
- Modify:
  - `console-actor.guard.ts` (line 89) and `organization-people.service.ts` (line 49): the operator check becomes `PlatformOperatorsService.isOperator(email)`
  - Console: the Platform settings page (`apps/management/src/app/(management)/settings/page.tsx`) gains an "Operators" panel
- Test:
  - `tests/unit/src/control-plane/platform-operators.spec.ts`
  - The console-actor guard spec
  - A console panel test

**Interfaces:**
- Produces:
  ```ts
  class PlatformOperatorsService {
    isOperator(email: string): Promise<boolean>;  // PLATFORM_ADMIN_EMAILS or an active row; cached 60 s per instance
    list(): Promise<{ email: string; source: "configuration" | "console"; addedBy: string | null; addedAt: string | null }[]>;
    add(email: string, actor: string): Promise<void>;
    remove(email: string, actor: string): Promise<void>; // 409 on self, on a configuration operator, or on the last operator
  }
  ```
  Routes, all through `requireOperatorPerson`:
  - `GET admin/control-plane/platform/operators`
  - `PUT admin/control-plane/platform/operators/:email`
  - `DELETE admin/control-plane/platform/operators/:email`

  Table `apic_catalog.platform_operators`: `email` primary key, lower-case, checked as an email; `added_by`; `added_at`; `removed_by`; `removed_at`. It has no row-level-security tenant policy, because it isn't organization data. Only the gateway role is granted access.

- [ ] **Step 1: Write the failing tests:**
  - An added operator passes `hasPlatformAccess` within 60 seconds, without a restart.
  - A removed operator loses it.
  - Removing yourself, the last operator, or an email from `PLATFORM_ADMIN_EMAILS` returns 409.
  - Each change records `platform.operator.added` or `platform.operator.removed`.
  - Calling with the platform secret returns `PERSON_REQUIRED`.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.** The guard's operator check becomes async. Keep the comparison case-insensitive.
- [ ] **Step 4: Run the tests**, plus `npm run db:verify:replay`. Expected: PASS.
- [ ] **Step 5: Commit** with message `feat(gateway): manage platform operators in the console`.

### Task 13: Payout settlement hold

**Files:**
- Create: `supabase/migrations/20261125000700_payout_settlement_hold.sql`
- Modify:
  - `apps/payments/src/features/payouts/payout-policy.ts`: `PayoutPolicy` and `isDue`
  - `payout-store.ts`: pool summaries and earnings
  - The settings validation in `payouts.routes.ts`
  - The allocation hold path, which sets `held_at` when the payment is paid
  - `contracts/public/apicenter.openapi.yaml`: `PayeeEarnings.settling`, and `IN_SETTLEMENT` in the cash-out description
  - `packages/sdk/src` types: `PayeeEarnings.settling`
  - Console: `payout-settings-sheet.tsx` gains "Settlement hold (days)"; the payee sheet shows "Settling"
- Test:
  - The `payout-policy` and `payout-store` specs
  - `tests/unit/contracts/public-payment-contract.spec.ts`
  - The SDK types test
  - The console payouts tests

**Interfaces:**
- Produces:
  - `PayoutPolicy.settlementHoldDays: number`: 0 to 30, default 7, set only by operators through the existing `OPERATE` settings route.
  - Earnings `{ awaitingPayment, held, settling, available, inFlight, paidThisWeek }`. `available` now excludes `settling`.

- [ ] **Step 1: Write the migration.**
  - Add `shared_payment.payout_allocations.held_at timestamptz NULL`.
  - Backfill `held_at = updated_at` for rows in `held`, `released`, `pooled` or `paid`.
  - Add `settlement_hold_days integer NOT NULL DEFAULT 7 CHECK (settlement_hold_days BETWEEN 0 AND 30)` to the payout settings table.
- [ ] **Step 2: Write the failing tests:**
  - A released share whose payment was paid 6 days ago is in `settling` and isn't pooled by the weekly run.
  - At 7 days, it is pooled.
  - With `settlementHoldDays: 0`, it is pooled immediately.
  - A cash-out with only settling earnings returns `409 IN_SETTLEMENT`.
  - With some settled earnings, it pays only those.
  - A full refund during the hold cancels the share as before.
  - Settings outside 0 to 30 return 400.
  - The contract test accepts `settling`.
- [ ] **Step 3: Run the tests.** Expected: FAIL.
- [ ] **Step 4: Implement.** Run `npm run contracts:sync-json && npm run contracts:validate && npm run check:contracts`.
- [ ] **Step 5: Run the tests** with `npx jest tests/unit/src/payments tests/unit/contracts`, the SDK tests and the console tests. Expected: PASS.
- [ ] **Step 6: Commit** with message `feat(payouts): hold shares until their payments settle`.

### Task 14: Quota policies keep the level that created them

**Files:**
- Create: `supabase/migrations/20261125000800_quota_policy_created_level.sql`
- Modify:
  - `prisma/schema.prisma` (`CpQuotaPolicy`)
  - `quota.service.ts`: create and `policyProject`
  - `control-plane-admin.controller.ts`: `PUT organizations/:organizationId/quota-policies/:policyId/status`, around line 440
  - Console: the quotas page shows "Set by your organization" on locked policies
- Test: the existing quotas spec and the console `quotas.test.ts`

**Interfaces:**
- Produces: `CpQuotaPolicy.createdLevel: "organization" | "project"`. Creation sets `organization` when the creator holds `organization.quotas.manage`, and `project` otherwise.

- [ ] **Step 1: Write the migration.** Add the column `created_level text NOT NULL DEFAULT 'project' CHECK (created_level IN ('organization','project'))`. Backfill `organization` for `scope = 'organization'` rows. Existing project-scope rows keep `project`, which is today's behavior.
- [ ] **Step 2: Write the failing tests:**
  - A project admin switching off a project policy with `createdLevel: "organization"` gets 403.
  - An organization admin succeeds.
  - A project admin switching off their own project-level policy succeeds.
- [ ] **Step 3: Run the tests**, implement, and run them again. Expected: FAIL, then PASS.
- [ ] **Step 4: Commit** with message `fix(gateway): keep organization quota limits out of project admins' reach`.

### Task 15: Remove flags that repeat a default

Production values, read on 2026-11-24 from the Cloud Run services:

| Variable | Where it's read | Production | What happens |
| :--- | :--- | :--- | :--- |
| `DATABASE_ENABLED` | Gateway, 9 places | `true` | Removed. One helper decides from `DATABASE_URL`. |
| `CLOUD_RUN_AUTH_ENABLED`, `API_CENTER_CLOUD_RUN_AUTH_ENABLED` | Gateway, console | `true` | Removed. On when Cloud Run's own `K_SERVICE` is set. |
| `PUBSUB_DISPATCHER_ENABLED` | Payments | `true` on both | Removed. On when the environment's `APICENTER_PAYMENT_EVENTS_TOPIC_*` is set. |
| `GAUTH_PROVIDER_TIMEOUT_MS`, `_FAILURE_THRESHOLD`, `_CIRCUIT_RESET_MS` | Google sign-in | 2000, 5 and 30000, the code's defaults | Removed. They become constants. |
| `PAYOUTS_REQUIRE_PAYEE_VERIFICATION` | Payments | unset, so off | Becomes the per-project payout setting `requirePayeeVerification`, set by operators. |
| `PAYMENT_PUBSUB_IAM_ENABLED` | Gateway | unset, so Pub/Sub permissions are silently skipped | Decided by usage (Step 1). |
| 20 keys in the `api-center-prod` secret bundle | Nothing | present | Deleted (Rollout). |

The 20 bundle keys are for removed systems: Kafka (5, including a password), Descope (6), the old JWT keys (2), tribe secrets (3), and registry and database dual-write (3), plus `KAFKA_SSL_ENABLED`.

These stay because they're real configuration: `PAYMENT_PROVIDER_MODE`, `SMS_PROVIDER`, `EMAIL_PROVIDER`, `GEOCODING_PROVIDER`, `APICENTER_PAYMENT_METHODS_TEST`/`_LIVE`, `MANAGEMENT_AUTH_MODE`, `SMS_PROVIDER_MODE` and `OTP_DELIVERY_MODE` (local mocks, ignored in production), `PAYOUT_MOCK_BALANCE` (mock only) and `NODE_ENV`.

**Files:**
- Create: `apps/gateway/src/config/database-configured.ts`, and `supabase/migrations/20261125000900_payee_verification_setting.sql`
- Modify:
  - The 9 `DATABASE_ENABLED` reads (`config.service.ts`, `prisma.service.ts`, `audit-events.service.ts`, `tenant-transaction.ts`, `payment-limits.service.ts` (two places), `payment-idempotency.service.ts`, `health.controller.ts` and `request-diagnostics.store.ts`)
  - `apps/gateway/src/shared/proxy/cloud-run-auth.ts` and `apps/management/src/lib/server/api-center-admin.ts`
  - `apps/payments/src/events/pubsubPublisher.js` and `paymentEventDispatcher.js`
  - `apps/gauth/src/shared/google-provider.ts`
  - `apps/payments/src/features/payouts/payee-verification.ts`, `payout-policy.ts` and the settings route
  - The console's `payout-settings-sheet.tsx` ("Require a verification record before paying")
  - `infra/gcp/cloud-run/*.yaml`, `.env.example` files, and `docs/operations/*` lines that set removed variables
- Test:
  - `tests/unit/src/config/database-configured.spec.ts`
  - The audit-events, payment-limits and request-diagnostics specs
  - The Cloud Run auth specs
  - The payments publisher spec
  - The payout policy spec

**Interfaces:**
- Produces:
  ```ts
  export function databaseConfigured(env?: NodeJS.ProcessEnv): boolean; // Boolean(env.DATABASE_URL?.trim())
  export function onCloudRun(env?: NodeJS.ProcessEnv): boolean;         // Boolean(env.K_SERVICE)
  ```
  `PayoutPolicy.requirePayeeVerification: boolean`, default `false`.

- [ ] **Step 1: Decide on Pub/Sub permissions.** Run a read-only count of webhook destinations of type Pub/Sub push in production, with the same pattern as `inspect-db.cjs`.
  - If there are none: remove the Pub/Sub push destination type from the console and the gateway, along with `PaymentPubSubIamProvisioningService` and `PAYMENT_PUBSUB_IAM_ENABLED`. Signed webhooks are the standard channel. Update the webhooks guide.
  - If there are some: set `PAYMENT_PUBSUB_IAM_ENABLED=true` on the gateway, then fix the silent skip so the console shows `Permissions not granted` instead.
  - Record which branch was taken in this task's commit message.
- [ ] **Step 2: Write the failing tests:**
  - With `DATABASE_URL` set and `DATABASE_ENABLED` unset, audit events are written, payment limits are counted, and request diagnostics are stored. This is today's latent bug: these three read only `DATABASE_ENABLED`.
  - Cloud Run auth is on when `K_SERVICE` is set and off otherwise.
  - The payments publisher publishes when the topic variable is set, and returns `null` without it.
  - Google sign-in uses 2000, 5 and 30000 with no variables set.
  - A project with `requirePayeeVerification: true` skips unverified payees with reason `payee_unverified`. Another project in the same environment doesn't.
- [ ] **Step 3: Run the tests.** Expected: FAIL.
- [ ] **Step 4: Implement.**
  - Replace every read of a removed variable.
  - Add the migration column `require_payee_verification boolean NOT NULL DEFAULT false` to the payout settings table.
  - Make sure no code reads the removed names: `grep -rnE "DATABASE_ENABLED|CLOUD_RUN_AUTH_ENABLED|PUBSUB_DISPATCHER_ENABLED|GAUTH_PROVIDER_(TIMEOUT|FAILURE|CIRCUIT)|PAYOUTS_REQUIRE_PAYEE_VERIFICATION" apps packages --include=*.ts --include=*.js --include=*.tsx` prints nothing outside tests.
- [ ] **Step 5: Run the tests**, plus `npm run typecheck && npm test`. Expected: PASS.
- [ ] **Step 6: Commit** with message `chore: remove flags that repeat a default`.

### Task 16: Documentation and release notes

**Files:**
- Modify:
  - `apps/docs/content/docs/management/access-and-tenancy.mdx`: a section "Changes that need APICenter's approval", with the Decisions table in user terms
  - `apps/docs/content/docs/payments/payouts.mdx`: in "What is available now", sending payouts in live is requested per project
  - `docs/operations/control-plane-operations.md`: a section "Deciding feature requests", with where the queue is, what to check per feature, and how to retry an approval that failed to apply
  - `docs/operations/payouts-runbook.md`: "Pause payouts in an emergency", with when to pause, what stops and what keeps working, and how to resume. It replaces the step of changing `PAYOUTS_LIVE_ENABLED` for an emergency stop.
  - `apps/docs/content/docs/errors.mdx` and `payments/payouts.mdx`: `409 PAYOUTS_PAUSED`, meaning "Payouts are paused by APICenter. Earnings are kept and paid after payouts resume."
  - `apps/docs/content/docs/messaging-verification/sms.mdx` and `otp.mdx`: the daily limit and allowed countries, how to request more, and the two error codes
  - `apps/docs/content/docs/payments/payouts.mdx`: the settlement hold and `settling`
  - `CHANGELOG.md`:
    - Under Unreleased → Breaking: SMS destinations.
    - Under Added: feature requests, pauses, SMS limits, the settlement hold, operators in the console and notifications.
    - Mention every migration from this plan.
  - `packages/sdk/package.json` to 3.7.0, `SDK_VERSION` in `packages/sdk/src/ApiCenter.ts` and its test, and `packages/contracts/package.json` to 1.6.0
- [ ] **Step 1: Write the docs.** Run `npm run check:documentation`. Expected: `Documentation valid`.
- [ ] **Step 2: Run the whole repo's checks:** `npm run typecheck && npm run lint && npm test && npm run contracts:validate && npm run check:contracts && npm run build --workspace @apicenter/docs`. Expected: all pass. The contract changes are those listed under Global Constraints.
- [ ] **Step 3: Commit** with message `docs: explain feature requests and approvals`.
- [ ] **Step 4: After merge, release:** `git tag -a sdk-v3.7.0` on `main`, push the tag, then run `gh workflow run release-sdk.yml --ref sdk-v3.7.0`. Expected: the run publishes contracts 1.6.0 and SDK 3.7.0.

## Rollout

1. Before switching traffic, run `npx ts-node scripts/report-international-sms.ts` with an authorized read-only database connection in `DATABASE_URL`. The report lists calling codes and counts by project, environment and service. OTP challenge counts can include suppressed or failed attempts, so confirm which historical destinations each project still needs.
2. Apply migrations `20261125000100` to `20261125000900` through the existing rollout process. They add the new tables and settings, classify existing quota policies and backfill allocations' `held_at`.
3. Stage the payments, SMS and OTP runtimes and payout runner first, then the gateway, console and docs. Before moving traffic, apply each project's approved calling codes to both staged messaging runtimes and confirm the new settings. Review existing merchant and live payout switches against the planned pilots.
4. Move traffic to the new revisions by hand, because services are pinned to named revisions.
5. Smoke test:
   - As a project admin, a request to pin a live SMS sender appears in the platform approvals queue.
   - Rejecting it leaves the sender unchanged.
   - Choosing Enterprise without approval returns `403 FEATURE_APPROVAL_REQUIRED`.
   - Pausing and resuming `payouts_sending` in test from platform settings shows in the audit log, and the payouts page shows "Paused by APICenter" while it is paused.
   - An SMS to a `+65` number from the smoke project returns `403 SMS_DESTINATION_NOT_ALLOWED`.
   - A decision call with the platform secret returns `403 PERSON_REQUIRED`.
6. Release contracts 1.6.0 and SDK 3.7.0 (Task 16, Step 4).
7. Remove the variables deleted in Tasks 5 and 15 from the Cloud Run services with `gcloud run services update --remove-env-vars`, then move traffic. Do this only after the new revisions are serving, because the old code still reads them.
8. Delete the 20 unused keys from the `api-center-prod` secret bundle by writing a new secret version without them. Then revoke the Kafka SASL credentials and the Descope project at their providers if those accounts still exist, and destroy the old secret versions. This needs operator approval at the time, because it changes production secrets.
