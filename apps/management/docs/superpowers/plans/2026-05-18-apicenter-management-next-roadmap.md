# API Center Management Next Roadmap

**Date:** 2026-05-18

**Goal:** Make `apicenter-management` the dependable operations console for API Center: safe enough for deployed use, clear enough for day-to-day operators, and useful enough for tribe onboarding, shared-service management, S3 export operations, and production support.

**Current state:** The app already covers registry management, tribe onboarding, Secret Manager provisioning, Confluent topic and S3 sink operations, shared-service smoke checks, usage, audit, cost signals, readiness, and settings. Descope auth, role mapping, action safety, and Vercel/GCP OIDC deployment support are now part of the direction.

---

## Executive Recommendation

Prioritize the roadmap in this order:

1. **Deployment correctness and access control**
2. **Operator safety for test/live writes**
3. **Guided operational workflows**
4. **Shared-service SDK and tribe developer experience**
5. **Observability, audit, and incident support**
6. **Automation with approvals**
7. **Governance and scale**

This order keeps the console from becoming more powerful before it is safer. The app already mutates registry, Confluent, Secret Manager, and provider-facing flows. The next improvements should reduce operator mistakes first, then reduce manual work.

---

## North Star

API Center Management should feel like a control plane, not a collection of admin pages.

An operator should be able to answer:

- Who is using which shared services?
- Which tribes are fully onboarded?
- Which topics are exporting to S3?
- Which secrets, provider configs, and credentials are ready?
- Which live actions happened, by whom, and why?
- What changed between test and live?
- What can safely be automated?
- What should be blocked until a human confirms?

---

## Product Principles

- **API Center stays the source of truth.** The management app should not invent its own registry or policy database unless there is a clear reason.
- **Server routes own privileged work.** Browser code should never receive platform admin secrets, provider secrets, Confluent secrets, or plaintext tribe secrets.
- **Read paths should be fast. Write paths should be deliberate.**
- **Test and live must be visually and behaviorally different.**
- **Every live write needs identity, preview, typed confirmation, reason, and audit evidence.**
- **SDK onboarding should be self-service for tribes.**
- **Automation should propose and execute guarded operations, not silently mutate production.**

---

## Decision Matrix

| Area | Option A | Option B | Option C | Recommendation |
| --- | --- | --- | --- | --- |
| Hosting | Local-only | Vercel private deployment | Internal GKE deployment | Use Vercel for management UI now, keep server-only secrets and OIDC. Revisit GKE only if Vercel function/runtime limits hurt operations. |
| Auth | Local bypass | Descope RBAC | Vercel protection only | Use Descope RBAC. Vercel protection can be extra perimeter protection, not the app authorization model. |
| Test/live | One project with preview/prod | Two Vercel projects | Local switch only | Keep two Vercel projects because that matches current setup and lowers confusion. |
| Writes | Direct buttons | Confirmation modal | Preview plus confirmation plus reason | Use preview plus confirmation plus reason for live/provider-impacting writes. |
| Secrets | Show plaintext | Show metadata only | Hide entirely | Show metadata and key presence only. Never show plaintext. |
| S3 export | Manual Confluent actions | Management UI buttons | Fully automatic from tribe create | Keep UI buttons now. Add policy-driven automation later with preview. |
| Shared services | Docs only | SDK examples | SDK package plus generated onboarding kit | Add generated onboarding kit and route/service examples. |
| Observability | Separate pages | Per-tribe timeline | Full incident workspace | Add timeline first. Build incident workspace only after timeline data is reliable. |
| Automation | Manual only | One-click guarded | Background scheduled jobs | Start with one-click guarded actions. Add scheduled jobs only for checks and drift detection. |

---

## Phase 1: Deployment Correctness And Access Control

**Objective:** Make deployed test/live management reliable and impossible to confuse with local-dev mode.

### Scope

- Add a deployment readiness page section that clearly shows:
  - `MANAGEMENT_AUTH_MODE`
  - `MANAGEMENT_ENVIRONMENT`
  - API Center base URL
  - public API Center base URL
  - topic prefix
  - Secret Manager auth mode
  - Confluent target connector
  - Descope project ID
- Add a hard warning when deployed URL is using `local-dev`.
- Add a server-side `/api/local/deployment/config-check` endpoint that returns safe metadata only.
- Add a Vercel deployment checklist page or panel.
- Add tests that fail if production env examples omit required deployed auth vars.

### Pros

- Catches the exact class of issue seen on `api-center-management-test.itsandbox.site`, where the site loaded but was still in local-dev mode.
- Gives operators one place to verify whether Vercel env vars are applied.
- Reduces silent misconfiguration.

### Cons

- More environment metadata in the UI can clutter settings/readiness if not grouped well.
- Requires discipline to keep the checklist updated when env vars change.

### Decision Points

- Should the app block all pages if deployed in `local-dev` mode?
- Should test and live use separate domains only, or also separate styling and route banners?
- Should deployment readiness be a top-level nav item or part of Settings/Readiness?

### Recommendation

Block privileged pages when a deployed app is in `local-dev`. Allow only a clear diagnostic screen explaining which env vars are missing.

### Done When

- Test deployment shows Descope login.
- Live deployment shows Descope login.
- Readiness reports test API URL for test and live API URL for live.
- No deployed page shows the local-dev warning.

---

## Phase 2: Role-Based Operations

**Objective:** Make roles meaningful and consistent across UI and server route handlers.

### Scope

- Finalize role definitions:
  - `api-center-admin`: all reads and writes, including live destructive actions after confirmation.
  - `api-center-operator`: routine reads and guarded non-destructive writes.
  - `api-center-observer`: read-only.
- Add role badges in the app shell.
- Disable UI actions the user cannot perform.
- Keep server-side enforcement as the source of truth.
- Add tests for each privileged route:
  - unauthenticated rejected
  - observer rejected for writes
  - operator allowed for routine test writes
  - admin required for live destructive writes

### Pros

- Makes Descope roles operationally useful.
- Prevents accidental exposure of write controls.
- Gives a clean model for adding more users.

### Cons

- More tests and route metadata to maintain.
- Role disputes can become product decisions rather than code decisions.

### Decision Points

- Can operators create tribes in live, or only admins?
- Can operators provision test Confluent topics?
- Can operators run provider-impacting smoke checks?
- Should observer users see secrets metadata, or only readiness status?

### Recommendation

- Operators can create/update in test.
- Operators can run safe checks in test.
- Provider-impacting checks require operator or admin plus explicit confirmation.
- Live writes require admin until operating patterns are proven.

---

## Phase 3: Live Write Safety And Operation Preview

**Objective:** Every risky action should explain what it will change before it changes anything.

### Scope

- Standardize an operation preview model:
  - action ID
  - target environment
  - resource type
  - resource ID
  - before/after summary when available
  - risk level
  - required role
  - required typed confirmation
  - operator reason
- Apply preview and confirmation to:
  - tribe create/update
  - tribe secret provision/rotation
  - Confluent topic provision
  - S3 sink include/remove topic
  - provider-impacting smoke checks
  - deployment restart
  - deprovision actions
- Save operation result summaries into audit where API Center supports it.

### Pros

- Gives operators confidence before clicking live actions.
- Creates better audit evidence.
- Makes automation easier later because each action has a preview contract.

### Cons

- Requires extra server logic for before/after summaries.
- Some providers may not support dry-run, so preview will be best-effort.
- Adds friction to urgent production fixes.

### Decision Points

- Should typed confirmation use the service ID, environment name, or a generated phrase?
- Should live writes require an operator reason every time?
- Should test writes require confirmation, or only provider-impacting writes?

### Recommendation

Use typed target confirmation, for example `trinithrive live`, and require an operator reason for all live writes.

---

## Phase 4: Guided Tribe Onboarding

**Objective:** Turn onboarding into a single guided workflow from registration to S3 export validation.

### Scope

- Build an onboarding workspace per tribe:
  - register manifest
  - provision tribe secret hash
  - issue temporary smoke token
  - provision Kafka topic
  - add topic to S3 sink
  - show SDK env vars
  - show NestJS/Node examples
  - publish test event
  - verify usage/audit/S3 path
- Add state checks for each step.
- Add copyable tribe onboarding packet.
- Add "what tribe does" vs "what platform does" split.

### Pros

- Reduces support conversations.
- Makes shared-service and event-publishing setup understandable for tribes.
- Gives operators a repeatable checklist.

### Cons

- More UI state and API calls.
- S3 export verification may need new API Center or analytics endpoints.

### Decision Points

- Should the onboarding packet include the plaintext tribe secret once?
- Should the packet be downloadable, copy-only, or sent by secure channel?
- Should topic provisioning happen automatically when a tribe is created?

### Recommendation

Generate plaintext tribe secret once, copy-only with a clear warning, and store only hash in Secret Manager. Keep topic provisioning as an explicit step until the process is trusted.

---

## Phase 5: Shared-Service SDK Experience

**Objective:** Make API Center easy for tribe developers to use through SDK calls instead of direct provider calls.

### Scope

- Add per-service SDK examples for:
  - `gauth`
  - `geo`
  - `payment`
  - `email`
  - `sms`
  - `otp`
- Add NestJS provider/module examples.
- Add event publishing examples:
  - generic event
  - payment event
  - OTP event
  - custom tribe event
- Add generated `.env` snippet per tribe:
  - `APICENTER_URL`
  - `APICENTER_TRIBE_ID`
  - `APICENTER_TRIBE_SECRET`
- Add "service contract" panels showing:
  - allowed routes
  - required scopes
  - example payload
  - example response
  - expected audit/event output

### Pros

- Makes the shared-services model real for consumers.
- Reduces direct provider integrations in tribe apps.
- Gives a clear answer to "how do they use each service?"

### Cons

- Requires examples to stay aligned with SDK releases.
- If SDK package naming changes, docs and UI snippets must update.

### Decision Points

- Should SDK examples be generated from service manifests?
- Should API Center expose OpenAPI specs per shared service?
- Should tribes be allowed to publish arbitrary custom events, or only typed event categories?

### Recommendation

Generate examples from registered manifests where possible, but keep curated examples for payment, OTP, and event publishing because those are high-risk and need precise guidance.

---

## Phase 6: S3 Export And Data Pipeline Visibility

**Objective:** Make it obvious whether a tribe's data is flowing into the analytics/S3 pipeline.

### Scope

- Add a per-tribe data pipeline panel:
  - expected topic name
  - topic exists
  - topic partition count
  - retention
  - S3 sink includes topic
  - connector status
  - last connector update
  - last observed event timestamp
  - S3 destination prefix
- Add connector drift detection:
  - topic exists but not in sink
  - sink includes topic but topic missing
  - test/live prefix mismatch
  - connector not running
- Add one-click repair with preview.

### Pros

- Reduces confusion when topics exist but readiness still says pending.
- Helps operators validate data export without using Confluent directly.
- Turns S3 sink management into a product feature instead of a manual backend task.

### Cons

- Requires reliable connector and event observation endpoints.
- "Last observed event" may need access to analytics/S3/Athena metadata.

### Decision Points

- Should connector repair be automatic or manual?
- Should readiness depend on actual observed events or only configuration?
- Should test and live share a Confluent cluster or split over time?

### Recommendation

Use configuration readiness first, then add observed-event readiness once the analytics pipeline can report it reliably.

---

## Phase 7: Observability And Incident Support

**Objective:** Give operators a timeline they can use during incidents.

### Scope

- Add per-tribe timeline:
  - manifest changes
  - secret provisioning/rotation
  - token issuance
  - shared-service calls
  - provider-impacting checks
  - topic provisioning
  - S3 sink changes
  - auth failures
  - policy denials
- Add filters:
  - environment
  - service
  - actor
  - action type
  - success/failure
- Add incident snapshot:
  - current readiness
  - recent failures
  - config metadata
  - related audit entries

### Pros

- Makes support faster.
- Helps prove what happened after production changes.
- Reduces need to jump across audit, usage, alerts, and readiness.

### Cons

- Requires consistent event schemas across API Center and shared services.
- Timeline UI can become noisy without good filters.

### Decision Points

- Should timeline be per tribe, per shared service, or both?
- Should raw audit events be visible, or summarized only?
- How long should management timeline data be retained?

### Recommendation

Start per tribe because operators most often debug one tenant/service at a time. Add shared-service timeline after event names are standardized.

---

## Phase 8: Secret And Provider Config Health

**Objective:** Show whether required platform and provider config exists without exposing secret values.

### Scope

- Add metadata-only checks for:
  - tribe secret hash exists
  - shared-service provider config exists
  - expected JSON keys exist
  - last secret version timestamp
  - disabled/destroyed version status
- Add drift checks:
  - missing expected keys
  - stale provider config
  - test/live config mismatch where unsafe
- Add rotation workflow:
  - generate new secret
  - store hash
  - show one-time copy
  - verify token issuance
  - record audit event

### Pros

- Operators can diagnose provider/service setup safely.
- Secret rotation becomes repeatable.
- Reduces accidental plaintext handling.

### Cons

- Requires careful redaction and tests.
- Metadata may still reveal sensitive operational shape.

### Decision Points

- Which keys are safe to name in the UI?
- Should stale secret thresholds be fixed or per service?
- Who can rotate live tribe secrets?

### Recommendation

Show key names only for known shared-service config schemas. For tribe secrets, show existence and version metadata only.

---

## Phase 9: Automation With Approval

**Objective:** Reduce repetitive operations without removing human control from production.

### Scope

- Add "proposed actions" from readiness/drift checks:
  - create missing topic
  - add topic to S3 sink
  - rotate stale secret
  - re-register shared-service manifest
  - restart API Center after config change
- Add batch operation preview.
- Add approval queue for live changes.
- Add scheduled read-only drift checks.

### Pros

- Saves time for repeated onboarding.
- Encourages consistent operations.
- Converts alerts into guided fixes.

### Cons

- Approval queue adds product complexity.
- Automation bugs can create broad impact if action scoping is weak.
- Scheduled jobs need hosting/runtime decisions.

### Decision Points

- Should approval be single-person or two-person for live?
- Should automation run inside Vercel, GKE, or API Center backend jobs?
- Should scheduled checks only alert, or also create proposed fixes?

### Recommendation

Start with scheduled read-only checks that create proposed actions. Require human approval for all writes, especially live.

---

## Phase 10: Governance, Compliance, And Scale

**Objective:** Make the console useful as the number of tribes and shared-service consumers grows.

### Scope

- Add ownership metadata:
  - tribe owner
  - technical contact
  - business contact
  - escalation channel
  - data classification
- Add policy views:
  - which tribes can call which shared services
  - which scopes are granted
  - unused access
  - denied access attempts
- Add exportable evidence:
  - onboarding completion
  - access matrix
  - live write audit
  - provider-impacting test log

### Pros

- Helps with security reviews and operational handoff.
- Makes access sprawl visible.
- Useful before many teams integrate with API Center.

### Cons

- Requires policy and ownership metadata to be maintained.
- Evidence exports can become stale if treated as static documents.

### Decision Points

- Should ownership live in API Center registry manifests?
- Should management app allow editing owners directly?
- Should access reviews be quarterly, monthly, or event-driven?

### Recommendation

Store ownership and access metadata in API Center registry records. Let management edit through guarded registry APIs so the source of truth remains central.

---

## Immediate Implementation Backlog

Recommended next 10 tasks:

1. Add deployed-local-dev blocker and diagnostic page.
2. Add deployment config-check endpoint with safe metadata.
3. Add readiness checks for Descope, Vercel OIDC vars, and management environment.
4. Add role badge and action availability hints in the app shell.
5. Add route-level tests for observer/operator/admin write permissions.
6. Standardize operation preview schema.
7. Apply preview/typed confirmation to Confluent topic and S3 sink actions.
8. Add per-tribe pipeline panel with topic and sink status.
9. Add generated NestJS SDK guide per tribe/service.
10. Add per-tribe timeline shell backed by existing audit/usage endpoints.

---

## Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Deployed app accidentally runs in local-dev | Unauthorized admin access | Block privileged pages when deployed auth mode is local-dev |
| Platform admin secret exposed through public env | Full platform compromise | Tests and readiness check must fail on `NEXT_PUBLIC_API_CENTER_PLATFORM_ADMIN_SECRET` |
| Test/live environment mismatch | Writes hit wrong environment | Strong banners, config-check endpoint, per-env domains, readiness warnings |
| Secret metadata leaks too much | Security exposure | Schema allowlist and redaction tests |
| Automation mutates too broadly | Production incident | Preview, scoped action IDs, typed confirmation, audit |
| SDK examples drift | Tribe integration failures | Generate from manifests where possible and version examples with SDK |
| Timeline becomes noisy | Operators ignore it | Filters, summaries, and per-tribe default view |

---

## Recommended Decisions To Lock Now

- **Two deployed Vercel projects:** keep `apicenter-management-test` and `apicenter-management`.
- **Both projects use Vercel production environment:** because they are separate projects.
- **Descope is required for deployed use.**
- **Local-dev auth is allowed only on localhost or explicit local operator usage.**
- **Live writes require admin role, typed confirmation, and reason.**
- **Provider-impacting checks require explicit confirmation in both test and live.**
- **No plaintext secrets in UI, logs, browser responses, or generated evidence.**
- **S3 export setup remains explicit until drift checks and previews are reliable.**

---

## Open Questions

- Should live tribe creation be admin-only forever, or can operators do it after the workflow is proven?
- Should test provider-impacting smoke checks be allowed by operators, or only admins?
- Should API Center expose a dedicated admin endpoint for S3 export verification?
- Should tribe onboarding packets be copy-only, downloadable, or delivered through a secure channel?
- Should timeline data come from API Center audit only, or merge audit, usage, and provider events?
- Should scheduled drift checks run in Vercel cron, API Center backend, or GKE?

---

## Success Metrics

- Test and live deployments both show Descope login.
- Zero deployed readiness warnings for missing required env vars.
- 100% of write routes have server-side action authorization.
- 100% of live writes require typed confirmation and reason.
- A new tribe can be onboarded from one guided screen.
- A tribe can copy a NestJS SDK guide and publish a test event.
- Operators can verify topic and S3 sink state without using Confluent UI.
- Operators can answer "what changed?" from a per-tribe timeline.
- No platform/provider secret appears in browser source, network responses, or logs.

