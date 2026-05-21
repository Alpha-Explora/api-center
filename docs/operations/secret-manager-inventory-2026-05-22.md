# Secret Manager Inventory - 2026-05-22

Project: `api-center-496422`

Scope: metadata-only inventory. No secret payloads were read or printed.

## Summary

| Area | Finding | Decision |
| --- | --- | --- |
| Environment secrets | `api-center-prod`, `api-center-test`, `api-shared-services-prod`, and `api-shared-services-test` exist with automatic replication. | Keep. Rotate through normal release flow only. |
| Test tribe secrets | Multiple test tribe secrets exist and are expected for onboarding/smoke coverage. | Keep active tribe secrets; review timestamped `codex-*` secrets. |
| Historical versions | Several secrets have many enabled historical versions. | Do not disable until deployments are confirmed to use `latest` or the current approved version. |
| Payload safety | Inventory used `secrets list` and `secrets versions list` only. | No values exposed. |

## Secret Inventory

| Secret | Created | Enabled versions | Disabled versions | Notes |
| --- | --- | ---: | ---: | --- |
| `api-center-prod` | 2026-05-15 23:11 UTC | 7 | 4 | Version `11` is latest enabled; older enabled versions remain. |
| `api-center-test` | 2026-05-16 02:03 UTC | 5 | 3 | Version `8` is latest enabled. |
| `api-center-test-tribe-secret-church-donations` | 2026-05-16 08:54 UTC | 1 | 0 | Active test tribe secret. |
| `api-center-test-tribe-secret-codex-owner-20260520024442` | 2026-05-19 18:44 UTC | 1 | 0 | Timestamped test secret; review for retirement. |
| `api-center-test-tribe-secret-codex-owner-20260520024731` | 2026-05-19 18:47 UTC | 1 | 0 | Timestamped test secret; review for retirement. |
| `api-center-test-tribe-secret-codex-sdk-20260520041053` | 2026-05-19 20:11 UTC | 1 | 0 | Timestamped SDK test secret; review for retirement after SDK smoke coverage is stable. |
| `api-center-test-tribe-secret-codex-smoke-20260520022325` | 2026-05-19 18:23 UTC | 1 | 0 | Timestamped smoke secret; candidate for disablement. |
| `api-center-test-tribe-secret-codex-smoke-20260520022425` | 2026-05-19 18:24 UTC | 1 | 0 | Timestamped smoke secret; candidate for disablement. |
| `api-center-test-tribe-secret-codex-smoke-20260520022520` | 2026-05-19 18:26 UTC | 1 | 0 | Timestamped smoke secret; candidate for disablement. |
| `api-center-test-tribe-secret-codex-smoke-20260520022710` | 2026-05-19 18:27 UTC | 1 | 0 | Timestamped smoke secret; candidate for disablement. |
| `api-center-test-tribe-secret-flow-ci` | 2026-05-17 06:12 UTC | 1 | 0 | Keep if still used by CI. |
| `api-center-test-tribe-secret-greenovate` | 2026-05-17 12:45 UTC | 1 | 0 | Active test tribe secret. |
| `api-center-test-tribe-secret-pakiapps` | 2026-05-17 13:13 UTC | 2 | 0 | Latest enabled version is `2`; version `1` should be reviewed. |
| `api-center-test-tribe-secret-shoteam` | 2026-05-17 13:21 UTC | 1 | 0 | Active test tribe secret. |
| `api-center-test-tribe-secret-smoke-tribe` | 2026-05-16 02:04 UTC | 14 | 1 | Heavy rotation history; likely cleanup candidate after version-pin check. |
| `api-center-test-tribe-secret-smurf-village` | 2026-05-16 09:39 UTC | 1 | 0 | Active test tribe secret. |
| `api-center-test-tribe-secret-trinithrive` | 2026-05-17 13:24 UTC | 2 | 0 | Latest enabled version is `2`; version `1` should be reviewed. |
| `api-center-tribe-secret-logistics` | 2026-05-20 17:46 UTC | 5 | 0 | Prod-like tribe secret; do not disable old versions until live smoke confirms current version. |
| `api-center-tribe-secret-smoke-tribe` | 2026-05-16 01:18 UTC | 6 | 0 | Prod-like smoke secret; review whether this still belongs in live namespace. |
| `api-center-tribe-secret-test-tribe` | 2026-05-16 08:57 UTC | 1 | 0 | Name suggests test usage in live namespace; review naming and scope. |
| `api-shared-services-prod` | 2026-05-15 23:11 UTC | 8 | 7 | Version `15` is latest enabled; older enabled versions remain. |
| `api-shared-services-test` | 2026-05-16 02:04 UTC | 7 | 1 | Version `8` is latest enabled; older enabled versions remain. |

## Version Metadata

| Secret | Enabled versions | Disabled versions |
| --- | --- | --- |
| `api-center-prod` | `4`, `5`, `6`, `7`, `8`, `9`, `11` | `1`, `2`, `3`, `10` |
| `api-center-test` | `4`, `5`, `6`, `7`, `8` | `1`, `2`, `3` |
| `api-center-test-tribe-secret-church-donations` | `1` | none |
| `api-center-test-tribe-secret-codex-owner-20260520024442` | `1` | none |
| `api-center-test-tribe-secret-codex-owner-20260520024731` | `1` | none |
| `api-center-test-tribe-secret-codex-sdk-20260520041053` | `1` | none |
| `api-center-test-tribe-secret-codex-smoke-20260520022325` | `1` | none |
| `api-center-test-tribe-secret-codex-smoke-20260520022425` | `1` | none |
| `api-center-test-tribe-secret-codex-smoke-20260520022520` | `1` | none |
| `api-center-test-tribe-secret-codex-smoke-20260520022710` | `1` | none |
| `api-center-test-tribe-secret-flow-ci` | `1` | none |
| `api-center-test-tribe-secret-greenovate` | `1` | none |
| `api-center-test-tribe-secret-pakiapps` | `1`, `2` | none |
| `api-center-test-tribe-secret-shoteam` | `1` | none |
| `api-center-test-tribe-secret-smoke-tribe` | `2` through `15` | `1` |
| `api-center-test-tribe-secret-smurf-village` | `1` | none |
| `api-center-test-tribe-secret-trinithrive` | `1`, `2` | none |
| `api-center-tribe-secret-logistics` | `1` through `5` | none |
| `api-center-tribe-secret-smoke-tribe` | `1` through `6` | none |
| `api-center-tribe-secret-test-tribe` | `1` | none |
| `api-shared-services-prod` | `7`, `8`, `9`, `10`, `11`, `12`, `14`, `15` | `1`, `2`, `3`, `4`, `5`, `6`, `13` |
| `api-shared-services-test` | `2` through `8` | `1` |

## Repo Reference Check

Current repo search found no direct `versions/<number>` references for the
listed secrets in `api-center` or `apicenter-management`. That lowers the risk
of version pinning in these two repos, but it does not prove deployed runtimes,
Vercel settings, GitHub Actions secrets, or other repos are not pinned.

## Recommended Cleanup

1. Confirm live and test services resolve Secret Manager aliases through
   `latest` or the intended active version.
2. For base environment secrets, keep the latest enabled version and disable
   older enabled versions only after post-deploy smoke passes.
3. For timestamped `api-center-test-tribe-secret-codex-*` secrets, disable the
   full secret only if no active smoke, SDK, or CI workflow depends on it.
4. Review live-namespace secrets whose names imply tests:
   `api-center-tribe-secret-smoke-tribe` and
   `api-center-tribe-secret-test-tribe`.
5. Do not destroy versions yet. Disable first, observe, then destroy only after
   the rollback window expires.

## Cleanup Commands

These commands do not read payloads. Run them only after the version-pin and
post-deploy checks pass.

```powershell
# Example: disable older enabled versions for one secret after validation.
gcloud secrets versions disable 4 --secret=api-center-prod --project=api-center-496422
```

For timestamped smoke secrets:

```powershell
# Disable the only version first; do not delete the secret until the rollback
# window has passed.
gcloud secrets versions disable 1 `
  --secret=api-center-test-tribe-secret-codex-smoke-20260520022325 `
  --project=api-center-496422
```

## Current Blocker

No destructive cleanup was performed in this inventory pass. The blocker is
runtime confirmation that deployed services and CI jobs are not pinned to older
secret versions.
