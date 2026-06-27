# One URL Environment Migration Inventory

Date: 2026-06-27

Scope: Task 0 inventory for moving consumers to one API Center URL with required `APICENTER_ENVIRONMENT=test|live`.

## Status

| Area | Status | Evidence |
| --- | --- | --- |
| Live registry verification | Complete | `npm run registry:verify -- --out docs/operations/registry-parity-2026-06-28.json` returned `ready=true`; API snapshot and Postgres both had 22 services, 0 missing, 0 mismatched. |
| Secret-name inventory | Complete | Current Secret Manager name list was collected without reading secret payloads. |
| Shared-service consumer inventory | Complete for API Center catalog | Live Supabase extraction lists consumers for `payment`, `email`, `sms`, `otp`, `gauth`, and `geo`; provider payment records still require shared-services DB verification before provider-impacting smoke. |
| SDK version inventory | Complete for current repo state | The local SDK implementation now requires `environment`, sends it in token requests, and emits the observability header. Published package version remains `1.2.2`; release as `2.0.0` before enforce mode. |
| Visual tracker | Complete | See `docs/visualizations/one-apicenter-environment-aware-routing-tracker.html`. |

## Deployment Snapshot

| Runtime | URL | Known state |
| --- | --- | --- |
| Live API Center | `https://api-center.itsandbox.site` | Earlier rollout verification showed readiness `200`, namespace `api-center` ready, and 22 registered services. Re-run with live env loaded before enforcement. |
| Test API Center | `https://api-center-test.itsandbox.site` | Earlier rollout verification showed readiness `200`, namespace `api-center-test` ready, and 24 registered services. Re-run with test env loaded before enforcement. |
| Management | Vercel deployment | Must be verified against one-URL environment-aware registry, secret handoff, and action guardrails before live cutover. |
| Supabase | `apic_*` control-plane schemas | Current Prisma schema includes `apic_catalog`, `apic_governance`, `apic_runtime`, and `apic_audit`. Environment constraints are still a future slice. |

## Registry Verification

Command run:

```powershell
cd C:\Codes\apic\api-center
npm run registry:verify
```

Result: passed with live runtime env and API Center admin snapshot fallback:

- `DATABASE_URL`: present
- `REDIS_CACHE_URL`: present, but direct local Redis access timed out because Memorystore is private
- `API_CENTER_BASE_URL` + platform admin secret: present
- Source used: `api_center_registry`
- Counts: API snapshot 22, Postgres 22, missing 0, mismatched 0

Evidence artifact: `docs/operations/registry-parity-2026-06-28.json`.

## Active Service Inventory

Live Supabase extraction completed on 2026-06-28 from `apic_catalog`. Registry parity also passed through the API Center admin snapshot fallback. Active service counts: 22 total, 6 shared, 16 tribe.

Known active service signal from the current Management registry view and prior rollout evidence:

| Service ID | Owner tribe | Type | Backend URL | Environment rows | Consumers / dependencies | Handoff state |
| --- | --- | --- | --- | --- | --- | --- |
| `email` | `email` | shared | http://email-service:4012 | test:active:http://email-service:4012 | - | Partial env rows; add missing test/live rows before enforce mode |
| `gauth` | `gauth` | shared | http://gauth-service:4013 | test:active:http://gauth-service:4013 | - | Partial env rows; add missing test/live rows before enforce mode |
| `geo` | `geo` | shared | http://geo-service:4015 | test:active:http://geo-service:4015 | - | Partial env rows; add missing test/live rows before enforce mode |
| `otp` | `otp` | shared | http://otp-service:4014 | test:active:http://otp-service:4014 | - | Partial env rows; add missing test/live rows before enforce mode |
| `payment` | `payment` | shared | http://payment-service:4010 | test:active:http://payment-service:4010 | - | Partial env rows; add missing test/live rows before enforce mode |
| `sms` | `sms` | shared | http://sms-service:4011 | test:active:http://sms-service:4011 | - | Partial env rows; add missing test/live rows before enforce mode |
| `church-donations` | `church-donations` | tribe | https://wlcm-website-backend.onrender.com | test:active:https://wlcm-website-backend.onrender.com | email, gauth, geo, otp, payment, sms | Partial env rows; add missing test/live rows before enforce mode |
| `codex-owner-20260520024731` | `codex-owner-20260520024731` | tribe | https://api-center-test.itsandbox.site | test:active:https://api-center-test.itsandbox.site | kafka | Partial env rows; add missing test/live rows before enforce mode |
| `codex-owner-20260520024731-orders` | `codex-owner-20260520024731` | tribe | https://api-center-test.itsandbox.site | test:active:https://api-center-test.itsandbox.site | kafka | Partial env rows; add missing test/live rows before enforce mode |
| `codex-probe` | `codex-probe` | tribe | https://api-center-test.itsandbox.site | test:active:https://api-center-test.itsandbox.site | kafka | Partial env rows; add missing test/live rows before enforce mode |
| `codex-smoke-20260520022520` | `codex-smoke-20260520022520` | tribe | https://api-center-test.itsandbox.site | test:active:https://api-center-test.itsandbox.site | kafka | Partial env rows; add missing test/live rows before enforce mode |
| `codex-smoke-20260520022710` | `codex-smoke-20260520022710` | tribe | https://api-center-test.itsandbox.site | test:active:https://api-center-test.itsandbox.site | kafka | Partial env rows; add missing test/live rows before enforce mode |
| `flow-ci` | `flow-ci` | tribe | https://flow-ci-api.itsandbox.site | None declared | email, gauth, geo, otp, payment, sms | No env rows; add explicit test/live rows before enforce mode |
| `greenovate` | `greenovate` | tribe | https://greenovate-be.itsandbox.site | None declared | email, gauth, geo, kafka, otp, payment, sms | No env rows; add explicit test/live rows before enforce mode |
| `logistics` | `logistics` | tribe | https://logistics.example.invalid | None declared | kafka | No env rows; add explicit test/live rows before enforce mode |
| `logistics-orders` | `logistics` | tribe | https://logistics-orders.example.invalid | None declared | - | No env rows; add explicit test/live rows before enforce mode |
| `pakiapps` | `pakiapps` | tribe | https://pakiapps-be.itsandbox.site | None declared | email, gauth, geo, kafka, otp, payment, sms | No env rows; add explicit test/live rows before enforce mode |
| `quota-smoke` | `quota-smoke` | tribe | https://quota-smoke.invalid | None declared | payment | No env rows; add explicit test/live rows before enforce mode |
| `shoteam` | `shoteam` | tribe | https://shoteam-be.itsandbox.site | None declared | email, gauth, geo, kafka, otp, payment, sms | No env rows; add explicit test/live rows before enforce mode |
| `smoke-tribe` | `smoke-tribe` | tribe | http://smoke-tribe.local | None declared | email, gauth, geo, kafka, otp, payment, sms | No env rows; add explicit test/live rows before enforce mode |
| `smurf-village` | `smurf-village` | tribe | https://smurf-village-be.itsandbox.site | None declared | email, gauth, geo, kafka, otp, payment, sms | No env rows; add explicit test/live rows before enforce mode |
| `trinithrive` | `trinithrive` | tribe | https://trinithrive.itsandbox.site | None declared | email, gauth, geo, kafka, otp, payment, sms | No env rows; add explicit test/live rows before enforce mode |

Required follow-up command shape:

```powershell
cd C:\Codes\apic\api-center
# Load live or test runtime env first, then:
npm run registry:verify -- --out docs/operations/registry-parity-one-url-<env>-2026-06-27.json
```

## Secret Manager Name Inventory

Collected metadata only. No plaintext secret payloads were read or recorded.

### Runtime Bundles

| Secret name | Classification | Action |
| --- | --- | --- |
| `api-center-prod` | Live API Center runtime bundle | Keep. Source for live runtime env only. |
| `api-center-test` | Test API Center runtime bundle | Keep. Source for test runtime env only. |
| `api-shared-services-prod` | Live shared-service runtime bundle | Keep. Payment live provider keys must stay here. |
| `api-shared-services-test` | Test shared-service runtime bundle | Keep. Payment test provider keys must stay here. |

### Existing Tribe Secrets

| Secret name | Current shape | Required target shape |
| --- | --- | --- |
| `api-center-test-tribe-secret-aping-api` | Test-prefixed legacy | `api-center-tribe-secret-aping-api-test` and later live if needed |
| `api-center-test-tribe-secret-church-donations` | Test-prefixed legacy | `api-center-tribe-secret-church-donations-test` |
| `api-center-test-tribe-secret-codex-owner-20260520024442` | Timestamped test | Review and retire if not active |
| `api-center-test-tribe-secret-codex-smoke-20260520022325` | Timestamped test | Review and retire if not active |
| `api-center-test-tribe-secret-codex-smoke-20260520022425` | Timestamped test | Review and retire if not active |
| `api-center-test-tribe-secret-greenovate` | Test-prefixed legacy | `api-center-tribe-secret-greenovate-test` |
| `api-center-test-tribe-secret-pakiapps` | Test-prefixed legacy | `api-center-tribe-secret-pakiapps-test` |
| `api-center-test-tribe-secret-shoteam` | Test-prefixed legacy | `api-center-tribe-secret-shoteam-test` |
| `api-center-test-tribe-secret-smurf-village` | Test-prefixed legacy | `api-center-tribe-secret-smurf-village-test` |
| `api-center-test-tribe-secret-trinithrive` | Test-prefixed legacy | `api-center-tribe-secret-trinithrive-test` |
| `api-center-tribe-secret-church-donations` | Legacy unscoped | Split to `-test` and `-live` before enforce mode |
| `api-center-tribe-secret-logistics` | Legacy unscoped | Split to `-test` and `-live` before enforce mode |
| `api-center-tribe-secret-smoke-tribe` | Legacy unscoped | Split to `-test` and `-live` or limit to smoke use |
| `api-center-tribe-secret-test-tribe` | Legacy unscoped with test name | Review; likely test-only candidate |

Target naming:

```text
api-center-tribe-secret-<tribe-id>-test
api-center-tribe-secret-<tribe-id>-live
```

## Shared-Service Consumers And Payment Records

Shared services in scope:

| Shared service | Consumers found in live catalog | Runtime plan | Payment/provider classification |
| --- | --- | --- | --- |
| `payment` | `church-donations`, `flow-ci`, `greenovate`, `pakiapps`, `quota-smoke`, `shoteam`, `smoke-tribe`, `smurf-village`, `trinithrive` | Split runtime: payment-test/payment-live | No shared_payment tables visible through the live API Center DB connection; provider record classification must be verified in the shared-services DB before provider-impacting smoke. |
| `email` | `church-donations`, `flow-ci`, `greenovate`, `pakiapps`, `shoteam`, `smoke-tribe`, `smurf-village`, `trinithrive` | Single runtime for now; track usage by environment | Not payment provider records |
| `sms` | `church-donations`, `flow-ci`, `greenovate`, `pakiapps`, `shoteam`, `smoke-tribe`, `smurf-village`, `trinithrive` | Single runtime for now; track usage by environment | Not payment provider records |
| `otp` | `church-donations`, `flow-ci`, `greenovate`, `pakiapps`, `shoteam`, `smoke-tribe`, `smurf-village`, `trinithrive` | Single runtime for now; track usage by environment | Not payment provider records |
| `gauth` | `church-donations`, `flow-ci`, `greenovate`, `pakiapps`, `shoteam`, `smoke-tribe`, `smurf-village`, `trinithrive` | Single runtime for now; track usage by environment | Not payment provider records |
| `geo` | `church-donations`, `flow-ci`, `greenovate`, `pakiapps`, `shoteam`, `smoke-tribe`, `smurf-village`, `trinithrive` | Single runtime for now; track usage by environment | Not payment provider records |

Provider-impacting payment smoke remains gated until the shared-services database/provider records are verified in the correct shared-service runtime database and approved by an operator.

## SDK Version Inventory

Current package:

| Package | Version | Environment support |
| --- | ---: | --- |
| `@alpha-explora/apicenter` | local repo still declares `1.2.2`; rollout target `2.0.0` | Environment-aware implementation is present locally: `TribeClient` requires `environment`, token requests include it, and SDK docs use `APICENTER_ENVIRONMENT`. Publish as `2.0.0` before enforce mode. |

Decision: release the environment-aware SDK as `2.0.0` because it changes the constructor/config contract. Until every consumer upgrades and proves smoke evidence, add each active service to an explicit legacy environment map or keep API Center in warn mode.

## Open Gates Before Enforce Mode

- Load live and test runtime env safely and rerun `npm run registry:verify`.
- Export row-level active service, environment, dependency, and secret-reference inventory from Supabase without printing secret values.
- Classify payment records as test/live before database backfill.
- Provision target `api-center-tribe-secret-<tribe-id>-test|live` records.
- Publish SDK `2.0.0` and verify each consumer sends `APICENTER_ENVIRONMENT`.
- Add Management target-environment guardrails before one Management deployment can perform live actions.
