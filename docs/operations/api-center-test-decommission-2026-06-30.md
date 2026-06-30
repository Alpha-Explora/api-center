# API Center Test Namespace Decommission

Date: 2026-06-30

Scope: retire the old `api-center-test` public lane after APICenter moved to one
public URL with environment-aware routing.

## Current Active Topology

| Component | Active state |
| --- | --- |
| Public API Center URL | `https://api-center.itsandbox.site` |
| Active namespace | `api-center` |
| Active API Center secret bundle | Secret Manager `api-center-prod`, latest enabled version |
| Active payment test runtime | `api-center/payment-test` |
| Active payment live runtime | `api-center/payment-live` |
| Payment test route | `SHARED_SERVICE_ROUTE_PAYMENT_TEST=http://payment-test.api-center.svc.cluster.local:4010` |
| Payment live route | `SHARED_SERVICE_ROUTE_PAYMENT_LIVE=http://payment-live.api-center.svc.cluster.local:4010` |
| Payment test secret source | Secret Manager `api-shared-services-test`, latest enabled version |
| Payment live secret source | Secret Manager `api-shared-services-prod`, latest enabled version |

## Old Lane Inventory

Read-only inventory before deletion on 2026-06-30 showed namespace `api-center-test` had:

| Resource type | Resource |
| --- | --- |
| Deployment | `api-center` |
| Service | `api-center` |
| HPA | `api-center` |
| ConfigMap | `api-center-config` |
| Ingress | `api-center` for host `api-center-test.itsandbox.site` |
| ManagedCertificate | `api-center-cert` |
| PodDisruptionBudget | `api-center` |
| ServiceAccount | `api-center` |

This lane is not part of the active topology. Do not deploy new work to it.

A live registry check on 2026-06-30 returned no active service entries whose
`baseUrl` or environment rows referenced `api-center-test.itsandbox.site`.

## Completion Evidence

Approved cleanup was completed on 2026-06-30:

1. Namespace `api-center-test` was deleted.
2. Every enabled version of Secret Manager secret `api-center-test` was disabled.
3. Older enabled versions of active Secret Manager bundles were disabled, leaving
   only the latest active version enabled.

ConfigMaps are Kubernetes resources, not Secret Manager objects, and do not
have versions. Deleting `api-center-test` removed the old ConfigMap with the
namespace.

## Pre-Delete Checks

Run metadata-only checks first:

```powershell
kubectl get ns api-center-test
kubectl -n api-center-test get all,configmap,secret,ingress,managedcertificate,pdb,serviceaccount --ignore-not-found
kubectl -n api-center get deploy,svc payment-test payment-live api-center -o wide
kubectl -n api-center exec deploy/api-center -- printenv SHARED_SERVICE_ROUTE_PAYMENT_TEST
kubectl -n api-center exec deploy/api-center -- printenv SHARED_SERVICE_ROUTE_PAYMENT_LIVE
```

Check external references before deletion:

```powershell
rg -n "api-center-test\.itsandbox\.site|api-center-test" api-center api-shared-services apicenter-management docs -S
```

Historical archived plans may still mention the old lane. Do not treat archived
mentions as active dependencies; only current deployment docs, runbooks, env
files, DNS, Confluent connectors, and monitoring configuration should block
deletion.

## Namespace Deletion

Command run:

```powershell
kubectl delete namespace api-center-test
kubectl get ns api-center-test
```

Expected final verification: `api-center-test` is not found, while
`api-center` remains ready.

## Secret Manager Version Cleanup

Final metadata-only inventory on 2026-06-30:

| Secret | Enabled versions | Cleanup target |
| --- | --- | --- |
| `api-center-prod` | `10` enabled; `1`-`9` disabled | complete |
| `api-center-test` | `1`-`5` disabled | complete |
| `api-shared-services-prod` | `11` enabled; `1`-`10` disabled | complete |
| `api-shared-services-test` | `10` enabled; `1`-`9` disabled | complete |

No secret payloads were read or printed during cleanup.

Command shape used:

```powershell
$project = "apicenter-alpha-20260623"

1..9 | ForEach-Object {
  gcloud secrets versions disable $_ --secret=api-center-prod --project=$project --quiet
}

1..10 | ForEach-Object {
  gcloud secrets versions disable $_ --secret=api-shared-services-prod --project=$project --quiet
}

1..9 | ForEach-Object {
  gcloud secrets versions disable $_ --secret=api-shared-services-test --project=$project --quiet
}

1..5 | ForEach-Object {
  gcloud secrets versions disable $_ --secret=api-center-test --project=$project --quiet
}
```

Verification:

```powershell
$project = "apicenter-alpha-20260623"
foreach ($secret in @("api-center-prod", "api-center-test", "api-shared-services-prod", "api-shared-services-test")) {
  gcloud secrets versions list $secret --project=$project --format="table(name,state,createTime)"
}
```