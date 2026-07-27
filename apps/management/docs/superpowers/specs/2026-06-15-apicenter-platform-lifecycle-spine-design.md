# API Center Platform Lifecycle Spine Design

Date: 2026-06-15
Status: Active implementation slice
Scope: APICenter platform workflow across `api-center`, `api-shared-services`, `apicenter-management`, and `control-tower`

## Purpose

APICenter should feel like one platform lifecycle rather than a set of separate management pages. Every service should have one readable state from registration through live operation:

```text
Registry -> Ownership -> Dependencies -> Runtime -> Quotas -> Pipeline -> Promotion -> Evidence
```

The lifecycle spine is the product object that ties management, developer portal, promotions, operational trust, quota policy, data pipeline, and service detail together.

## Product Rules

- The service remains the center of gravity.
- The UI should always show the next blocked or attention stage before lower-priority work.
- Evidence must be source-oriented. Derived states are allowed, but they must say which current signal drove the state.
- Shared services and tribe services have different quota responsibilities.
- Event-exporting services are not fully ready until topic and S3 sink evidence are checked.
- Mutating workflows remain on specialist pages with preview, confirmation, and audit behavior.

## Lifecycle Stages

| Stage | Meaning | Current source | Primary action |
|---|---|---|---|
| Registry | Service exists and has a usable lifecycle status | Registry service entry | Service detail |
| Ownership | Owner tribe, owner team, and contact are set | Manifest metadata | Edit manifest |
| Dependencies | Declared consumed services resolve to registered services or known external systems | Registry relationship graph | Dependencies |
| Runtime | Health path and latest health result support runtime readiness | Registry health fields | Service health |
| Quotas | Tribe consumption has active policy and no blocked usage | Quota policies and usage decisions | Quotas |
| Pipeline | Event-exporting services have topic and S3 sink evidence | Current slice derives need; later slice should read Confluent status | Service pipeline |
| Promotion | Core live gate inputs are present | Registry, runtime, quota, owner data | Promotions |
| Evidence | Recent proof exists for the current state | Health and registry timestamps now; later audit/evidence sections | Evidence timeline |

## First Slice

The first implementation slice adds a derived lifecycle model in `apicenter-management`:

- `src/lib/service-lifecycle.ts` builds service and platform lifecycle entries.
- `src/components/platform-lifecycle-panel.tsx` renders the lifecycle table.
- The overview shows the lifecycle panel below platform health.
- The developer portal shows lifecycle state for a tribe's owned services.
- `/lifecycle` becomes a first-class route and smoke-tested route.

This creates the product spine without changing backend contracts yet.

## Later Slices

1. `api-center`: expose lifecycle/evidence API sections so the UI no longer infers pipeline and evidence state from partial registry data.
2. `api-shared-services`: publish smoke, provider, and SDK handoff evidence into the same lifecycle evidence model.
3. `control-tower`: feed CI/CD promotion gate outcomes into promotion and evidence stages.
4. `apicenter-management`: replace derived placeholders with source-backed lifecycle evidence and add route-level browser QA for the full lifecycle flow.

## Acceptance Criteria

- Users can open one lifecycle route to see all services sorted by blocked, attention, then ready.
- The overview and developer portal use the same lifecycle language.
- Broken dependencies and blocked quota usage appear before lower-priority work.
- Shared services are not incorrectly blocked by tribe quota-policy requirements.
- Event-exporting services surface pipeline evidence as required work.
- Existing routes remain reachable.
