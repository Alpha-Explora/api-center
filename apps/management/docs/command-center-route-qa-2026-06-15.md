# Command Center Route QA - 2026-06-15

Branch: `codex/command-center-redesign`
Base URL: `http://localhost:3010`
Browser surface: Codex in-app browser
Latest follow-up pass: desktop default viewport and mobile 390x844 viewport

## Scope

This pass covers the primary routes listed in the command-center goal contract. It checks whether each route loads in the browser and whether the page structure supports the redesign goal:

- one clear page heading
- no runtime error text
- no horizontal document overflow
- global workflow search present
- no browser console warnings or errors
- obvious unlabeled form controls identified for follow-up

## Result Summary

- Routes checked: 27
- Desktop route pass: 27/27 clean
- Mobile route pass: 27/27 clean at 390x844
- Routes with runtime error text: 0
- Routes with browser console warnings/errors: 0
- Routes with duplicate or missing `h1`: 0
- Routes with horizontal overflow: 0
- Routes missing global workflow search: 0
- Routes with likely unlabeled controls: 0
- Mobile routes with off-screen workflow controls: 0
- Browser screenshot capture: unavailable during this pass because the Browser CDP screenshot command timed out; DOM, console, route, and interaction evidence were still collected.

## Routes Checked

| Route | H1 | Runtime error | Horizontal overflow | Unlabeled controls |
| --- | --- | --- | --- | --- |
| `/` | Platform health | No | No | 0 |
| `/alerts` | Alerts | No | No | 0 |
| `/api-catalog` | API catalog | No | No | 0 |
| `/audit` | Audit log | No | No | 0 |
| `/compliance` | Compliance | No | No | 0 |
| `/cost` | Cost signals | No | No | 0 |
| `/data-pipeline` | Data pipeline | No | No | 0 |
| `/dependencies` | Dependencies | No | No | 0 |
| `/developer-portal` | Developer portal | No | No | 0 |
| `/docs/consumer-runbook` | SDK runbook | No | No | 0 |
| `/lifecycle` | Service lifecycle | No | No | 0 |
| `/manifest-tools` | Manifest tools | No | No | 0 |
| `/marketplace` | Marketplace | No | No | 0 |
| `/operational-trust` | Operational Trust | No | No | 0 |
| `/plans` | Tribe plans | No | No | 0 |
| `/promotions` | Environment promotions | No | No | 0 |
| `/quotas` | Tribe quotas | No | No | 0 |
| `/readiness` | Readiness | No | No | 0 |
| `/registration-requests` | Registration requests | No | No | 0 |
| `/reliability` | Reliability | No | No | 0 |
| `/settings` | Settings | No | No | 0 |
| `/shared-services` | Shared services | No | No | 0 |
| `/shared-services/setup` | Shared services setup | No | No | 0 |
| `/shared-services/usage` | Shared-service usage | No | No | 0 |
| `/smoke-tests` | Smoke tests | No | No | 0 |
| `/tribes` | Registry | No | No | 0 |
| `/tribes/new` | Register service | No | No | 0 |

## Concrete Gaps

### P1 - Label the remaining workflow controls

Status: fixed after follow-up implementation.

The original browser pass found likely unlabeled inputs on `/plans`, `/quotas`, `/shared-services/setup`, `/smoke-tests`, and `/tribes/new`. Follow-up component tests and browser scans now verify these routes return zero unlabeled form controls.

### P2 - Review empty-state quality on data-dependent routes

Status: fixed after follow-up implementation.

These data-dependent routes now show recovery paths when local data is missing or a filtered state has no entries:

- `/alerts`: verify analytics ingestion, open runtime evidence, refresh the selected window.
- `/data-pipeline`: verify raw-to-silver telemetry, check gateway decision export, refresh the partition window.
- `/developer-portal`: find the owner tribe ID, verify registry source data, preview the portal packet.

### P3 - Keep heading structure as-is for now

All checked routes had exactly one `h1`. There is no current evidence of the earlier duplicate-heading problem on the primary route set.

### P4 - Keep overflow checks in the final mobile pass

Status: fixed after follow-up implementation.

Desktop and mobile document overflow were clean on this pass. The mobile sweep used a 390x844 viewport and checked each primary route for runtime error text, exactly one `h1`, horizontal overflow, unlabeled form controls, off-screen interactive controls, global workflow search presence, and browser console warnings/errors.

### Interaction proof

The mobile workflow search was exercised on `/`:

- Action: type `quota` into `#workflow-search`.
- Observed state: input value remained `quota`.
- Observed result: quota workflow links were present, including `/quotas` with the description `Operations - Set and review quota policy, rate limits, and usage.`

## P4 - Service-Detail Spine And Standalone Workflow Audit

Audit date: 2026-06-15

Outcome: fixed in branch. Service-specific actions either deep-link to `/tribes/[serviceId]?section=...`, or the route is intentionally kept as a standalone workflow because it owns cross-service review, guarded mutation, validation, or environment setup.

### Service-specific deep links verified

| Surface | Verified relationship |
| --- | --- |
| Overview issue detail | Broken dependencies route to `/tribes/[sourceServiceId]?section=dependencies`; quota pressure routes to `/tribes/[ownerTribeId]?section=quotas`. |
| Overview alert strip | `open first issue` now routes service-scoped alerts to `/tribes/[serviceId]?section=health` instead of the legacy `observability` alias. |
| Alerts | Service, audit/evidence, usage, and dependency actions route to service detail health, evidence, or dependencies sections. |
| Registry | Service rows route to `/tribes/[serviceId]?section=summary`. |
| Registration requests | Approved/request detail steps route to service summary, governance, and evidence sections. |
| API catalog and marketplace | API/product actions route to service summary or governance sections. |
| Dependencies and shared-service usage | Provider/consumer impact links route to service dependencies or quotas sections. |
| Lifecycle and promotions | Known-service lifecycle, quota, evidence, promotion gate, pipeline, and governance actions route to service detail sections. |
| Developer portal and SDK support | Tribe-specific quota, evidence, and governance actions route to service detail; task-level runbook actions route to the owning tool page. |
| Pipeline dashboard | Service-specific quality/health actions route to `/tribes/[serviceId]?section=pipeline`. |

### Standalone workflows kept intentionally

| Route | Standalone reason |
| --- | --- |
| `/quotas` | Owns policy creation, proposal review, and prefilled quota-policy forms; plan-generated proposal links use query params here because this is the guarded quota mutation surface. |
| `/plans` | Owns plan assignment and generated proposal review before handing quota policy work to `/quotas`. |
| `/registration-requests` | Owns cross-service request review and approve/reject decisions before a durable service detail record exists. |
| `/dependencies` | Owns the global dependency map; individual provider/consumer links still drill into service detail. |
| `/shared-services`, `/shared-services/setup`, `/shared-services/usage` | Own shared-provider discovery, setup, and matrix analysis; affected services link back to service detail. |
| `/developer-portal` and `/docs/consumer-runbook` | Own tribe-safe onboarding packet and SDK task guidance; service-specific follow-through links to service detail. |
| `/manifest-tools` | Owns bulk import/export, validation, and recovery tooling; normal inspection stays in registry/service detail. |
| `/smoke-tests` | Owns provider-impacting validation runs that require explicit setup and review controls. |
| `/settings` | Owns environment/session/capability confidence and is not service-specific. |
| `/audit`, `/compliance`, `/operational-trust`, `/promotions` | Own cross-service governance evidence, release gates, and trust review; known service evidence and remediation links return to service detail. |
| `/data-pipeline`, `/cost`, `/readiness`, `/reliability` | Own cross-platform operational posture; service-specific findings deep-link to health, pipeline, dependencies, quotas, or evidence sections. |

Regression test added:

- `src/components/dashboard-alert-strip.test.tsx` verifies the first service alert links to `/tribes/payment?section=health`.

Final status:

- Focused alert-strip regression test passed.
- Full test suite passed in chunks.
- Typecheck, lint, route smoke, staged diff check, and production build passed.
- Branch pushed to `origin/codex/command-center-redesign`.
