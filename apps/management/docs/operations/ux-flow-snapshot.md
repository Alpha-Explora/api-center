# API Center Management UX Flow Snapshot

Last checked: 2026-05-14

This snapshot records the management UI shape after the first operator-flow
cleanup. It is based on the route/component source and the current operations
runbook.

## Current Information Architecture

| Area | Route | Main purpose |
|---|---|---|
| Dashboard | `/` | High-level registry health, traffic, alerts, and next actions |
| Readiness | `/readiness` | Local env and API Center connectivity checks |
| Registry | `/tribes` | Search and filter all tribe/shared-service registry entries |
| Register service | `/tribes/new` | Create a tribe or shared-service manifest |
| Service detail | `/tribes/<service-id>` | Task-sectioned view for overview, onboarding, observability, lifecycle, and developer tools |
| Edit service | `/tribes/<service-id>/edit` | Update a manifest with diff preview |
| Dependencies | `/dependencies` | View `consumes` relationships and broken dependencies |
| Shared services | `/shared-services` | Platform shared-service catalog and secret signals |
| Shared setup | `/shared-services/setup` | Register predefined shared-service manifests |
| Shared usage | `/shared-services/usage` | Declared-vs-runtime shared-service usage matrix |
| Smoke tests | `/smoke-tests` | Request a token and run shared-service smoke checks |
| Audit | `/audit` | Recent registry/proxy/Kafka/readiness events |
| Cost | `/cost` | Provider-facing usage and failure signals |
| Alerts | `/alerts` | Read-only operational warnings |
| Manifest tools | `/manifest-tools` | Export/import registry manifests |
| Settings | `/settings` | Local endpoint config and guarded deployment restart |

## Current Strengths

- The app keeps platform secrets server-side through `/api/local/*` route
  handlers.
- The sidebar groups major surfaces by operator intent: Operate, Registry,
  Shared services, and Setup.
- Tribe registration has a useful smoke preset and warns when a local backend
  URL cannot be reached by production GKE.
- Service detail pages now cover the real lifecycle through tabs: manifest, dependencies,
  SDK, secret provisioning, Confluent topic/S3 sink, deprovisioning,
  observability, contract tests, event mapping, and registry lifecycle.
- Shared page headings, time-window controls, and empty/error/setup states are
  centralized to reduce UI drift.
- Shared-service usage already answers the important question: which tribe uses
  which shared service and how often, when runtime analytics are available.
- Cost, alerts, audit, and traffic surfaces are present and can become the main
  observability layer without introducing a separate monitoring UI yet.

## Remaining UX Problems And Redundancies

### 1. Service detail pages still need route-level test coverage

`/tribes/<service-id>` is now split into task sections, but it still needs
automated route-level coverage for:

- overview default rendering
- `?section=onboarding`
- `?section=observability`
- `?section=lifecycle`
- `?section=developer`

Recommended direction: add focused component tests or browser smoke checks for
the section links before making this console public.

### 2. Onboarding is split across too many pages

The real new-tribe flow is now staged from the service detail Onboarding tab:

1. readiness
2. register manifest
3. provision tribe secret
4. grant API Center runtime secret access
5. provision Confluent topic
6. add topic to S3 sink
7. request token
8. run safe shared-service smoke checks
9. check audit/usage/alerts

The guided checklist deep-links to `/smoke-tests`, `/shared-services/usage`,
and `/audit`, but Confluent topic/S3 sink status still depends on existing
provision buttons rather than a full read-only status API.

### 3. Observability is fragmented

The app has separate surfaces for:

- dashboard traffic
- shared usage
- cost signals
- alerts
- audit
- per-tribe observability
- per-shared-service observability

That is a good data model, but there is no single "incident view" or clear
operator path from alert to affected service to fix.

Current direction: `/alerts` is the primary entry point for problems and links
rows to service detail sections, audit filters, shared usage, readiness, or
settings depending on alert type.

### 4. Time-window controls are duplicated

The same `["1h", "24h", "7d", "30d"]` segmented control appears in multiple
components:

- `src/components/alerts-client.tsx`
- `src/components/cost-insights-client.tsx`
- `src/components/shared-service-usage-matrix.tsx`
- `src/components/tribe-observability-panel.tsx`
- `src/components/shared-service-observability-panel.tsx`

Current direction: `TimeWindowSelector` and `usageWindows` are centralized.

### 5. Status, empty, and error states are inconsistent

Most pages use `Alert`, but wording and severity vary. Some "endpoint
unavailable" states are operationally normal because analytics may not be
deployed, while other failures block writes.

Current direction: three state components are centralized:

- `SetupRequiredState`: missing env, missing analytics endpoint, missing GCP IAM
- `EmptyDataState`: no registry rows, no alerts, no runtime calls
- `ActionFailedState`: write or provider mutation failed

### 6. The navigation is complete but not grouped by task

The sidebar is now grouped by operator intent. Remaining work is mostly visual
QA on smaller screens and keyboard navigation.

### 7. The shared-services catalog duplicates setup state

`/shared-services` lists the six shared services and secret signals.
`/shared-services/setup` lists the same six services as manifests.

Current direction: `/shared-services` is the catalog and shows
registered/unregistered state directly. `/shared-services/setup` remains the
batch-registration step.

### 8. Smoke tests are powerful but intimidating

The smoke page correctly separates safe checks from provider-impacting checks,
but it is long and operationally dense.

Current direction: token generation remains at the top, safe checks are visible
first, and provider-impacting checks are behind expandable disclosure sections.
Provider-secret prerequisite chips still need a backend-supported status source.

### 9. Manifest import/export is useful but isolated

`/manifest-tools` can dry-run imports, but it is not linked from edit/detail
flows except the dashboard.

Current direction: service detail has a Developer tools manifest export panel
and `/manifest-tools` has copy/download/clear controls with dry-run guarded
import.

### 10. Browser console health needs a separate pass

During snapshotting, the local browser logged repeated Next RSC payload fetch
fallback messages during navigation. The pages still rendered, but these logs
should be isolated in a separate debugging pass so normal navigation is quiet.

## Recommended User Flows

### New Tribe Onboarding

1. Start at `/readiness`.
2. Open `/tribes/new`.
3. Register manifest.
4. Land on `/tribes/<service-id>?section=onboarding`.
5. Complete checklist:
   - secret generated and provisioned
   - Confluent topic created
   - topic added to S3 sink
   - API Center runtime secret access confirmed
   - token requested
   - safe smoke checks passed
6. Review usage/audit/alerts.

### Shared-Service Operations

1. Start at `/shared-services`.
2. Check each service registration state and provider secret signal.
3. Register missing manifests inline or through `/shared-services/setup`.
4. Open `/shared-services/usage`.
5. Inspect high-usage or undeclared runtime callers.
6. Open affected service detail.

### Incident Triage

1. Start at `/alerts`.
2. Open affected service detail.
3. Inspect recent audit events for that service.
4. Inspect runtime usage/cost for the selected time window.
5. Run targeted smoke/contract checks.
6. Apply manifest or lifecycle fix.
7. Recheck alerts.

### Deprovisioning

1. Open `/tribes/<service-id>?section=lifecycle`.
2. Review consumers, runtime usage, S3 mapping, and recent audit.
3. Delete tribe credential secret if token issuance should stop.
4. Remove topic from S3 sink only if future export should stop.
5. Deregister registry entry.
6. Preserve Confluent topics and S3 historical objects by default.

## Implementation Priorities

1. Add route-level and UI smoke tests for the critical operator flows.
2. Add provider-secret prerequisite status if API Center exposes it safely.
3. Add richer alert-to-smoke-test handoff when alert types identify a specific
   shared-service failure.
4. Add keyboard and screen-reader QA before public deployment.


