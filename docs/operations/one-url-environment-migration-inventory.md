# One URL Environment Migration Inventory

Date: 2026-06-27

Scope: Task 0 inventory for moving consumers to one API Center URL with required `APICENTER_ENVIRONMENT=test|live`.

## Status

| Area | Status | Evidence |
| --- | --- | --- |
| Local registry verification | Blocked | `npm run registry:verify` failed because the local shell does not have `DATABASE_URL` and Redis/API snapshot credentials loaded. |
| Secret-name inventory | Complete | Current Secret Manager name list was collected without reading secret payloads. |
| Shared-service consumer inventory | Partial | Shared services are known (`payment`, `email`, `sms`, `otp`, `gauth`, `geo`), but live row-level consumer extraction from Supabase is still pending. |
| SDK version inventory | Complete for current SDK | `@alpha-explora/apicenter` is `1.2.2` and does not require or send `APICENTER_ENVIRONMENT`. Treat active consumers as needing upgrade or explicit legacy mapping until each repo proves otherwise. |
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

Result: failed locally because these values were not loaded:

- `DATABASE_URL`
- `REDIS_CACHE_URL` / `REDIS_URL` / `CACHE_URL`
- or `API_CENTER_BASE_URL` plus admin registry snapshot credentials

This does not prove registry drift. It proves Task 0 Step 1 needs an operator shell with the deployed runtime env loaded before it can be checked off.

## Active Service Inventory

Live row-level extraction from Supabase is pending. Until this is collected, treat every active service in Management as in scope for the environment handoff.

Known active service signal from the current Management registry view and prior rollout evidence:

| Service ID | Owner tribe | Current environment rows | Current handoff state | Notes |
| --- | --- | --- | --- | --- |
| `pakiapps` | `pakiapps` | Pending live extraction | Needs `APICENTER_ENVIRONMENT` | Visible in Management registry. |
| `greenovate` | `greenovate` | Pending live extraction | Needs `APICENTER_ENVIRONMENT` | Visible in Management registry. |
| `shoteam` | `shoteam` | Pending live extraction | Needs `APICENTER_ENVIRONMENT` | Visible in Management registry. |
| `trinithrive` | `trinithrive` | Pending live extraction | Needs `APICENTER_ENVIRONMENT` | Visible in Management registry. |
| `flow-ci-api` | `flow-ci` | Pending live extraction | Needs `APICENTER_ENVIRONMENT` | Visible in Management registry. |
| `church-donations` | `church-donations` | Pending live extraction | Needs `APICENTER_ENVIRONMENT` | Visible in Management registry. |
| `smoke-tribe` | `smoke-tribe` | Pending live extraction | Needs `APICENTER_ENVIRONMENT` | Smoke service; must remain usable for rollout checks. |
| `logistics` | `logistics-platform` | Pending live extraction | Needs `APICENTER_ENVIRONMENT` | Visible in Management registry. |
| Other active tribe services | Pending | Pending live extraction | Needs `APICENTER_ENVIRONMENT` | Live count previously showed 16 tribe services. |
| Shared services | Platform | Pending live extraction | Needs environment-aware routing | Live count previously showed 6 shared services. |

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

| Shared service | Runtime plan | Consumer inventory status | Payment/provider classification |
| --- | --- | --- | --- |
| `payment` | Split runtime: `payment-test`, `payment-live` | Pending live extraction | Existing provider records must be classified as test/live before backfill. |
| `email` | Single runtime for now | Pending live extraction | Provider side effects are lower risk than payment; keep one runtime until risk changes. |
| `sms` | Single runtime for now | Pending live extraction | Track usage by environment before enforcement. |
| `otp` | Single runtime for now | Pending live extraction | Cache, challenge, and attempt keys must include environment. |
| `gauth` | Single runtime for now | Pending live extraction | OAuth state and token references must include environment context. |
| `geo` | Single runtime for now | Pending live extraction | Cache and rollups must include environment. |

## SDK Version Inventory

Current package:

| Package | Version | Environment support |
| --- | ---: | --- |
| `@alpha-explora/apicenter` | `1.2.2` | No required `environment` option found in `TribeClient`, no `APICENTER_ENVIRONMENT` docs, and no `X-APICenter-Environment` header emission. |

Decision: release the environment-aware SDK as `2.0.0` because it changes the constructor/config contract. Until every consumer upgrades, add each active service to an explicit legacy environment map or keep it in warn mode.

## Open Gates Before Enforce Mode

- Load live and test runtime env safely and rerun `npm run registry:verify`.
- Export row-level active service, environment, dependency, and secret-reference inventory from Supabase without printing secret values.
- Classify payment records as test/live before database backfill.
- Provision target `api-center-tribe-secret-<tribe-id>-test|live` records.
- Publish SDK `2.0.0` and verify each consumer sends `APICENTER_ENVIRONMENT`.
- Add Management target-environment guardrails before one Management deployment can perform live actions.
