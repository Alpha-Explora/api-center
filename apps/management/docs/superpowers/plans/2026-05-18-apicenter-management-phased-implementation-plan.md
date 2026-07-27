# API Center Management Phased Implementation Plan

**Date:** 2026-05-18

**Source roadmap:** `docs/superpowers/plans/2026-05-18-apicenter-management-next-roadmap.md`

**Goal:** Implement the next management-console upgrades in controlled phases so the app becomes safe for deployed test/live operations, clearer for operators, and easier for tribes to adopt through the SDK.

**Implementation rule:** Do not start a later phase if the current phase leaves a security or environment-safety gap. The console already has privileged paths, so deployment correctness and write safety come before convenience automation.

---

## Accepted Assumptions

- Test and live are separate Vercel projects connected to one GitHub repo:
  - test: `apicenter-management-test`
  - live: `apicenter-management`
- Both Vercel projects use their own Vercel `production` environment.
- Deployed auth uses Descope.
- Local development can use `MANAGEMENT_AUTH_MODE=local-dev`.
- API Center remains the source of truth for registry, usage, audit, policy, and admin operations.
- Privileged provider/cloud work remains behind server-side Next.js route handlers.
- No plaintext platform, provider, or tribe secrets are shown in browser UI, network responses, logs, docs output, or generated evidence.

---

## Phase Gates

| Gate | Required outcome | Verification |
| --- | --- | --- |
| Gate 1 | Deployed test/live cannot silently run as local-dev | Readiness endpoint and UI show correct auth/env; deployed local-dev is blocked |
| Gate 2 | Role model is enforced in UI and server routes | Role tests pass for admin/operator/observer |
| Gate 3 | Risky writes have preview, confirmation, reason, and audit metadata | Route tests plus manual smoke through test UI |
| Gate 4 | Tribe onboarding is a guided workflow | New tribe can reach SDK, secret, topic, S3, and smoke-test readiness from one screen |
| Gate 5 | SDK examples are usable by NestJS consumers | Examples compile or are covered by snippet tests where practical |
| Gate 6 | Operators can diagnose S3 pipeline state without Confluent UI | Per-tribe pipeline panel shows topic, sink, connector, and drift |
| Gate 7 | Per-tribe timeline answers "what changed?" | Timeline combines existing audit/usage/status data |
| Gate 8 | Secret/provider config checks expose metadata only | Redaction tests pass |
| Gate 9 | Automation creates proposed actions, not unreviewed live writes | Proposal and approval tests pass |
| Gate 10 | Governance metadata is available for access review | Ownership/access matrix export works |

---

## Phase 1: Deployment Correctness And Deployed-Local-Dev Blocker

**Objective:** Prevent the deployed app from looking healthy while running with local development defaults.

### Tasks

- [x] Add a safe deployment config endpoint, for example `/api/local/deployment/config-check`.
- [x] Return only non-secret metadata:
  - `MANAGEMENT_AUTH_MODE`
  - `MANAGEMENT_ENVIRONMENT`
  - `MANAGEMENT_ENV`
  - `API_CENTER_BASE_URL`
  - `NEXT_PUBLIC_API_CENTER_BASE_URL`
  - `NEXT_PUBLIC_KAFKA_TOPIC_PREFIX`
  - `GOOGLE_CLOUD_PROJECT`
  - GCP auth mode: `vercel-oidc`, `local-impersonation`, `adc`, or `missing`
  - Confluent target IDs and connector name
  - Descope project ID and issuer presence
- [x] Add a deployed-local-dev detector.
- [x] Block privileged pages when a deployed URL is using `MANAGEMENT_AUTH_MODE=local-dev`.
- [x] Show a diagnostic screen with missing env vars and the expected test/live values.
- [x] Extend the readiness page with deployment correctness checks.
- [x] Add tests for config-check output.

### Pros

- Catches misconfigured Vercel deployments immediately.
- Prevents accidental admin access through local-dev mode.
- Helps operators verify whether env vars were applied before testing writes.

### Cons

- Adds another readiness/config surface to maintain.
- Must be carefully redacted to avoid leaking secrets.

### Decision Checkpoint

No user answer needed before starting. Recommended behavior: block privileged pages if the deployed app is in local-dev mode.

### Verification

```powershell
npm run test
npx tsc --noEmit
npm run build
```

Manual checks:

- `https://api-center-management-test.itsandbox.site/api/local/readiness`
- `https://api-center-management-test.itsandbox.site`
- Confirm Descope login appears after Vercel envs are applied.

---

## Phase 2: Role Model And Action Availability

**Objective:** Make admin/operator/observer roles consistent across UI and server routes.

### Tasks

- [x] Add role badge in the app shell.
- [x] Add a safe session endpoint for resolved operator identity.
- [x] Add current user/session metadata panel in Settings.
- [x] Add a central action capability map:
  - read-only actions
  - test writes
  - provider-impacting writes
  - live writes
  - destructive writes
- [x] Show action availability based on the resolved role.
- [x] Keep server route authorization as the source of truth.
- [x] Add action authorization tests for observer/operator/admin behavior.
- [x] Document Descope role setup in the deployment runbook.

### Role Recommendation

| Role | Recommended permissions |
| --- | --- |
| `api-center-observer` | Read-only pages, readiness, usage, audit, settings metadata |
| `api-center-operator` | Test writes, safe smoke checks, guarded provider-impacting test checks |
| `api-center-admin` | All operator permissions plus live writes and destructive actions after confirmation |

### Pros

- Users can be added without making everyone an admin.
- Server routes have a clear authorization contract.
- UI becomes less confusing for read-only users.

### Cons

- Requires careful test coverage across many routes.
- Operators may need admin escalation for live tasks early on.

### Decision Questions Before Phase 2

1. Should `api-center-operator` be allowed to create tribes in live, or should live create be admin-only?
2. Should `api-center-observer` see Secret Manager metadata, or only high-level readiness status?

**Default recommendation:** live create is admin-only; observers can see existence/status metadata but not key names for provider secrets.

---

## Phase 3: Operation Preview, Typed Confirmation, And Reason Capture

**Objective:** Standardize the write path so risky actions explain themselves before execution.

### Tasks

- [x] Create an operation preview schema:
  - action ID
  - title
  - environment
  - risk level
  - required role
  - target resource
  - planned change summary
  - confirmation text
  - reason requirement
- [x] Add reusable preview/confirmation UI.
- [x] Apply to:
  - Confluent topic provision
  - S3 sink include/remove topic
  - tribe secret provision/rotation
  - provider-impacting smoke checks
  - deployment restart
  - tribe deprovision actions
- [x] Require typed confirmation for live writes.
- [x] Require operator reason for live writes.
- [x] Include action metadata in audit calls where API Center supports it.

Implementation progress:

- [x] Shared-service provider-impacting smoke checks use reusable preview UI.
- [x] Confluent topic provision has preview and sends live confirmation payload.
- [x] S3 sink include-topic has preview and sends live confirmation payload.
- [x] S3 sink remove-topic preview.
- [x] Tribe secret provision/rotation preview.
- [x] Deployment restart preview.
- [x] Tribe deprovision preview.

### Pros

- Reduces accidental live/provider changes.
- Creates a reusable contract for future automation.
- Makes audit logs more useful.

### Cons

- Adds click friction.
- Some actions cannot produce true provider dry-runs, only planned summaries.

### Decision Questions Before Phase 3

1. For typed confirmation, should the phrase be the service ID only, or `<service-id> <environment>`?
2. Should test provider-impacting checks require a reason, or only live writes?

**Default recommendation:** use `<service-id> <environment>` and require reasons only for live writes.

---

## Phase 4: Guided Tribe Onboarding Workspace

**Objective:** Move tribe onboarding from scattered cards/pages into one guided operational flow.

### Tasks

- [x] Add or extend a per-tribe onboarding workspace.
- [x] Show step state for:
  - manifest registered
  - shared-service access declared
  - tribe secret provisioned
  - token issued
  - safe smoke checks pass
  - Kafka topic created
  - topic added to S3 sink
  - usage/audit observed
- [x] Split responsibilities:
  - platform/operator actions
  - tribe developer actions
- [x] Add generated onboarding packet:
  - install command
  - env vars
  - NestJS setup
  - service call examples
  - event publishing examples
- [x] Add copy controls for each section.
- [x] Keep plaintext tribe secret one-time only.

Implementation progress:

- [x] Tribe detail onboarding tab includes the guided flow, Confluent/S3 actions, SDK config, and the handoff packet.
- [x] The flow now separates shared-service access, token issuance, and safe smoke checks.
- [x] The handoff packet separates platform/operator tasks from tribe developer tasks.
- [x] The handoff packet generates server env vars, NestJS module setup, shared-service call snippets, event publishing snippets, and the S3 export topic.
- [x] Each packet section has its own copy control, plus a full-packet copy action.
- [x] Focused coverage added for the onboarding packet and updated onboarding flow labels.

### Pros

- Gives operators a repeatable checklist.
- Gives tribes one place to understand what they need to do.
- Reduces support questions around SDK, S3, and shared services.

### Cons

- More state to synchronize.
- Some readiness states may need new API Center endpoints later.

### Decision Questions Before Phase 4

1. Should onboarding packet be copy-only or downloadable?
2. Should topic creation happen automatically after manifest registration?

**Default recommendation:** copy-only for anything containing secrets; explicit topic creation for now.

---

## Phase 5: SDK And NestJS Developer Experience

**Objective:** Make the SDK usage clear enough that a tribe developer can integrate without a support call.

### Tasks

- [x] Add per-service examples for:
  - `gauth`
  - `geo`
  - `payment`
  - `email`
  - `sms`
  - `otp`
- [x] Add NestJS module/provider example.
- [x] Add event publishing examples.
- [x] Add examples for custom tribe events.
- [x] Add service contract panels:
  - route
  - method
  - required scopes
  - payload
  - response
  - audit/event output
- [x] Add SDK package/version warning if the app can detect outdated docs.

Implementation progress:

- [x] SDK onboarding now shows the install command, package-name/version caveat, server env vars, and NestJS provider module.
- [x] Curated SDK examples exist for `gauth`, `geo`, `payment`, `email`, `sms`, and `otp`.
- [x] Payment and OTP examples are curated instead of inferred from generic manifests.
- [x] Tribe event and custom tribe event publishing snippets are both generated.
- [x] Registered service contract panels show route, method, scopes, payload, response, and audit/event output.
- [x] Component/helper tests cover curated examples, contracts, and custom-event snippets.

### Pros

- Drives the correct architecture: tribes call API Center through SDK.
- Reduces direct provider access from tribe services.
- Makes shared services discoverable.

### Cons

- Examples can drift from SDK implementation.
- Requires coordination with SDK package naming/versioning.

### Decision Questions Before Phase 5

1. What is the final SDK package name to show in the UI?
2. Should examples be generated from manifests or curated by service?

**Default recommendation:** curate high-risk services like payment/OTP, generate simple route metadata from manifests.

---

## Phase 6: S3 Export And Data Pipeline Visibility

**Objective:** Make topic and S3 sink status clear and repairable.

### Tasks

- [x] Add per-tribe pipeline panel:
  - expected topic
  - topic exists
  - partitions
  - retention
  - S3 connector name
  - topic included in connector
  - connector status
  - last connector update
- [x] Add drift states:
  - topic missing
  - topic exists but not in sink
  - sink includes topic but topic missing
  - wrong prefix for environment
  - connector unavailable
- [x] Add guarded repair actions with preview.
- [x] Add tests for test/live topic naming.

Implementation progress:

- [x] Tribe and shared-service onboarding tabs now include a read-only Confluent pipeline status panel.
- [x] The panel shows expected topic, expected partitions, retention, S3 connector name, topic-in-sink status, connector reachability, last check time, and connector update availability.
- [x] Drift labels cover missing topic, topic not in sink, sink topic without topic existence, wrong environment prefix, and connector unavailability.
- [x] Existing topic/S3 repair actions already use preview and confirmation through the provisioning card.
- [x] Topic naming tests cover unprefixed live-style names and `test.` prefixed test names.

### Pros

- Removes confusion when topic and sink state do not match readiness cards.
- Lets operators avoid Confluent UI for routine checks.
- Creates a foundation for data export validation.

### Cons

- Connector APIs can be slow or occasionally inconsistent.
- Last observed event may require later analytics/Athena integration.

### Decision Questions Before Phase 6

1. Should readiness require only config state, or actual observed S3/event state?
2. Should S3 repair be batchable across many tribes?

**Default recommendation:** config readiness first; observed event readiness later.

---

## Phase 7: Per-Tribe Timeline And Incident Snapshot

**Objective:** Let operators answer "what changed?" from one place.

### Tasks

- [x] Add timeline shell on tribe detail page.
- [x] Merge existing API Center data where available:
  - audit
  - usage
  - token issuance
  - shared-service calls
  - topic/S3 actions
  - readiness changes
- [x] Add filters:
  - action type
  - actor
  - success/failure
  - environment
- [x] Add incident snapshot panel:
  - current readiness
  - recent failures
  - last writes
  - related provider-impacting checks

Implementation progress:

- [x] Observability tab now renders a service timeline panel instead of an empty static timeline.
- [x] Timeline events are built from registry readiness, API Center audit events, and shared-service runtime usage.
- [x] Audit events include actor, environment, and success/failure metadata when available.
- [x] Usage events show tribe-to-shared/shared-to-tribe calls, failures, and latency.
- [x] Filters cover action type/source, actor, success/failure, severity, and environment.
- [x] Incident snapshot shows readiness summary, recent failures, last write, and provider-related checks.
- [x] Focused tests cover timeline event merging and the client timeline panel.

### Pros

- Speeds up support and incident response.
- Reduces context switching across pages.
- Makes audit data usable.

### Cons

- Depends on consistent API Center event/audit data.
- Timeline can become noisy without grouping.

### Decision Questions Before Phase 7

1. Should timeline be shown by default or behind a tab?
2. How far back should the default view query?

**Default recommendation:** show as a tab on tribe detail; default to 24 hours with quick filters.

---

## Phase 8: Secret And Provider Config Health

**Objective:** Show whether secrets/config are ready without revealing values.

### Tasks

- [x] Add schema-aware metadata checks for shared-service provider config.
- [x] Add tribe secret metadata checks:
  - exists
  - enabled
  - latest version timestamp
  - expected secret ID
- [x] Add redaction tests.
- [x] Add stale/rotation warnings.
- [x] Add guarded secret rotation flow.

Implementation progress:

- [x] Shared-service provider config health is schema-aware for `gauth`, `geo`, `payment`, `email`, `sms`, and `otp`.
- [x] Provider config UI shows only allowlisted key names and missing-key metadata.
- [x] Tribe secret health shows expected secret ID, existence, enabled state, latest enabled version, and latest version timestamp.
- [x] Secret rotation warnings flag missing, disabled, unknown timestamp, invalid timestamp, and 90-day stale versions.
- [x] Guarded tribe secret rotation remains in the existing tribe secret card with preview, live typed confirmation, and operator reason.
- [x] Redaction tests assert provider values are not emitted.

### Pros

- Operators can diagnose provider setup safely.
- Rotation becomes repeatable.
- Reduces accidental secret leakage.

### Cons

- Requires strong redaction discipline.
- Even metadata can be sensitive if too detailed.

### Decision Questions Before Phase 8

1. Which provider config key names are safe to display?
2. Who can rotate live tribe secrets?

**Default recommendation:** display key names only for allowlisted shared-service schemas; live rotation admin-only.

---

## Phase 9: Proposed Actions And Approval Queue

**Objective:** Turn drift/readiness failures into proposed fixes, without unreviewed live automation.

### Tasks

- [x] Add proposed action model.
- [x] Generate proposed actions from:
  - missing topic
  - topic not in sink
  - stale secret
  - missing shared-service manifest
  - failed readiness config
- [x] Add proposal list on dashboard and tribe detail.
- [x] Add approval and execution flow.
- [x] Keep live execution behind admin confirmation.
- [x] Add tests for proposal scoping.

Implementation progress:

- [x] Proposed actions are first-class `proposal` records with risk, reason, target link, and 24-hour expiry.
- [x] Dashboard proposals cover missing expected shared-service manifests and missing dependency registrations.
- [x] Service detail proposals cover missing health/owner metadata, missing Confluent topics, topics not in S3 sink, failed Confluent reads, and stale/missing tribe secrets.
- [x] Proposal execution is intentionally review-only; action links route operators to the guarded workflow that already requires preview/confirmation for writes.
- [x] Focused tests cover proposal scoping and dashboard rendering.

### Pros

- Reduces repetitive operator work.
- Gives a clear path from alert to fix.
- Prepares for future scheduled drift checks.

### Cons

- Adds product complexity.
- Requires careful scoping to avoid batch mistakes.

### Decision Questions Before Phase 9

1. Should live approvals require one admin or two people?
2. Should proposed actions expire?

**Default recommendation:** one admin initially; proposals expire after config changes or 24 hours.

---

## Phase 10: Governance And Access Review

**Objective:** Support scale as more tribes and shared-service consumers are added.

### Tasks

- [x] Add ownership metadata to tribe/service views.
- [x] Add access matrix:
  - tribe
  - consumed shared services
  - scopes
  - last used
  - denied attempts
- [x] Add unused access warnings.
- [x] Add exportable access review evidence.
- [x] Add runbook updates for periodic review.

Implementation progress:

- [x] Access review evidence model includes tribe ownership, contact, consumed shared services, scopes, last used, denied attempts, and unused access flags.
- [x] Shared-service usage page now includes access review evidence below the runtime/declaration matrix.
- [x] Operators can copy redacted access review JSON evidence for periodic reviews.
- [x] Tests cover evidence construction, redacted export content, and UI rendering.

### Pros

- Helps with security and compliance review.
- Makes access sprawl visible.
- Improves operational handoff.

### Cons

- Requires ownership metadata to stay current.
- Evidence exports need careful redaction.

### Decision Questions Before Phase 10

1. Should ownership be editable in management or only in API Center registry records?
2. Should access reviews be monthly or quarterly?

**Default recommendation:** edit ownership through guarded registry APIs; quarterly review at first.

---

## Implementation Order

Recommended batches:

1. **Batch A:** Phase 1 only.
2. **Batch B:** Phase 2 and Phase 3 together if small enough; otherwise Phase 2 first.
3. **Batch C:** Phase 4 and Phase 5.
4. **Batch D:** Phase 6.
5. **Batch E:** Phase 7 and Phase 8.
6. **Batch F:** Phase 9.
7. **Batch G:** Phase 10.

Do not implement automation before preview/confirmation is finished.

---

## Files Likely To Change

Expected high-touch areas:

- `src/app/api/local/**/route.ts`
- `src/app/readiness/page.tsx`
- `src/app/settings/page.tsx`
- `src/app/tribes/[tribeId]/page.tsx`
- `src/components/app-shell.tsx`
- `src/components/readiness-client.tsx`
- `src/components/tribe-onboarding-flow.tsx`
- `src/components/confluent-provisioning-card.tsx`
- `src/components/smoke-token-card.tsx`
- `src/components/shared-service-smoke-tests.tsx`
- `src/lib/action-policy.ts`
- `src/lib/server/management-auth.ts`
- `src/lib/server/require-management-action.ts`
- `src/lib/server/gcp-secret-manager.ts`
- `src/lib/server/confluent-cloud.ts`
- `src/lib/schemas.ts`
- `docs/operations/apicenter-management-runbook.md`
- `docs/operations/apicenter-management-deployment-runbook.md`

---

## Verification Standard

Each phase should include:

- Unit/component tests for new behavior.
- Typecheck.
- Build.
- Manual test on local test mode.
- Deployed test verification before live rollout if deployment behavior changed.

Baseline commands:

```powershell
npm run test
npx tsc --noEmit
npm run build
```

Manual deployment checks:

```text
https://api-center-management-test.itsandbox.site
https://api-center-management-test.itsandbox.site/api/local/readiness
https://api-center-management.itsandbox.site
https://api-center-management.itsandbox.site/api/local/readiness
```

---

## Questions To Answer Before Implementation

These are not blockers for creating the plan, but they should be answered before the relevant phase starts.

1. Should `api-center-operator` be allowed to create tribes in live?
2. Should observers see Secret Manager/provider key names, or only existence/status?
3. Should typed confirmation be `<service-id> <environment>`?
4. Should test provider-impacting checks require an operator reason?
5. Should onboarding packets be copy-only or downloadable?
6. What is the final public SDK package name?
7. Should pipeline readiness eventually require observed S3 events, or config-only readiness?
8. Should live approvals eventually require two people?

## Current Recommendations

- Live creates: admin-only.
- Observer secret visibility: existence/status only.
- Typed confirmation: `<service-id> <environment>`.
- Test provider-impacting checks: explicit checkbox, no reason required.
- Onboarding packet: copy-only for secret-bearing sections.
- SDK package name: keep current displayed package until SDK publish name is final.
- Pipeline readiness: config-only first, observed S3 later.
- Live approval: one admin now; revisit two-person approval after operators use the console in production.
