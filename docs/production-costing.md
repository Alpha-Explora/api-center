# API Center Production Costing

Date: 2026-05-16

This document estimates production and maintenance costs for the current API
Center platform. All numbers are approximate USD estimates before taxes. Billing
consoles and pricing calculators remain the source of truth.

```text
GKE Autopilot API Center
  -> internal shared-service runtimes
  -> Redis / Memorystore
  -> optional Supabase Postgres control-plane + shared-service schemas
  -> Confluent Cloud Kafka
  -> Confluent S3 Sink Connector
  -> AWS S3 raw data lake
```

## Executive Summary

The current live platform is still expensive for a low-credit/student budget,
but it is much cheaper than the previous shape.

| View | Estimate |
| --- | ---: |
| Old GCP-side monthly cost | `315-400 USD/month` |
| Current GCP-side monthly cost | `180-240 USD/month` |
| Estimated GCP-side savings | `155-180 USD/month` |
| Practical cloud/provider budget | `220-330 USD/month` |
| Maintenance labor | `4-8 engineering hours/month` |

The biggest savings already completed:

1. Removed old self-managed Kafka/Strimzi from GKE.
2. Consolidated Redis from two Memorystore instances to one.
3. Reduced API Center from min 3 pods to min 2 and lowered CPU request.

The current cost drivers are GKE baseline cost, Redis, load balancing,
networking, observability, Confluent/S3 usage, and provider API usage.

## Current Live State

Verified on 2026-05-13.

| Component | Current state |
| --- | --- |
| GCP project | `api-center-496422` |
| Region | `asia-southeast1` |
| Cluster | GKE Autopilot cluster `api-center` |
| Namespace | `api-center` |
| Public entrypoint | HTTPS GKE Ingress for `api-center.itsandbox.site` |
| API Center | HPA min `2`, max `3`; request `150m` CPU, `256Mi` memory |
| Shared services | `payment`, `sms`, `email`, `gauth`, `otp`, `geo`; each HPA min `1`, max `3` |
| Shared-service exposure | internal `ClusterIP` only, no public load balancers |
| Redis | one 1 GiB Basic Memorystore instance: `api-center-cache` at `10.88.197.107:6379` |
| Kafka | Confluent Cloud, not self-managed Kafka in GKE |
| Data lake | Confluent S3 Sink Connector to AWS S3 |
| Legacy Kafka | `kafka` and `strimzi-operator` namespaces deleted |
| Supabase Postgres | planned but not live; database feature flags should remain disabled until migrations and cutover checks are complete |

Live verification:

| Check | Result |
| --- | --- |
| API Center readiness | public `/api/v1/health/ready` returned `200` |
| API Center pods | `2/2` ready |
| Shared-service pods | all six `1/1` ready |
| Shared-service registry | all six active in API Center |
| In-cluster shared-service health | API Center pod received HTTP `200` from all six `/health` endpoints |
| Redis consolidation | API Center cache and rate-limit URLs both point to `10.88.197.107:6379` |
| Shared-service Redis | `api-shared-services-prod` `REDIS_URL` points to the same Redis endpoint |
| Legacy Kafka persistent volume | no `api-center-kafka` persistent volume remains |

## Current Monthly Cost

This is the current live shape after cleanup and shared-service deployment.

| Area | Current shape | Rough monthly cost |
| --- | --- | ---: |
| GKE cluster fee | one Autopilot cluster | about `73/month` before any free-tier offset |
| API Center workload | 2 pods idle minimum, `150m` CPU and `256Mi` each | about `16.73/month` |
| Shared-service workloads | 6 pods idle minimum, `50m` CPU and `128Mi` each | about `18.03/month` |
| Redis / Memorystore | one 1 GiB Basic instance | about `35.77/month` |
| HTTPS load balancer | one public GKE HTTPS ingress | about `18.25/month` plus traffic |
| Self-managed Kafka in GKE | removed | `0/month` |
| Secret Manager | active secret versions and access operations | usually `<1/month` |
| Artifact Registry | retained container images | usually `<1-5/month` |
| Logging / Monitoring | logs, metrics, alerts, uptime checks | `0-25+/month` at current scale |
| Networking / NAT / LB data | egress and load-balancer traffic | `20-50+/month` at current scale |
| Supabase Postgres | not wired into runtime yet | `0/month` current if using an existing free project; add plan cost only when usage/features require it |

Current GCP-side planning range:

```text
180-240 USD/month
```

If all six shared services are raised from 1 replica to 2 replicas, add roughly:

```text
18 USD/month
```

## Old Monthly Cost

This was the previous live shape before cleanup.

| Area | Old shape | Rough monthly cost |
| --- | --- | ---: |
| API Center workload | HPA min `3`, max `6`; `250m` CPU request | about `39/month` at idle minimum |
| Redis / Memorystore | two 1 GiB Basic instances: cache + rate-limit | about `71.54/month` |
| Self-managed Kafka in GKE | Strimzi operator, Kafka broker, entity operator, exporter, 10 GiB PV | about `120/month` at list prices |
| HTTPS load balancer | one public GKE HTTPS ingress | about `18.25/month` plus traffic |
| Shared services | not deployed yet | `0/month` |
| Logging / Monitoring / Networking | live platform overhead | variable |

Old GCP-side planning range:

```text
315-400 USD/month
```

Why the old shape was expensive:

1. Strimzi and Kafka were still running after the platform had moved to Confluent.
2. Two Redis instances doubled the fixed Memorystore cost.
3. API Center kept more idle pod capacity than current traffic needs.

## Cleanup Savings

| Change | Status | Estimated monthly impact |
| --- | --- | ---: |
| Remove self-managed Kafka/Strimzi from GKE | done | saves about `120/month` |
| Consolidate Redis to one Memorystore instance | done | saves about `35.77/month` |
| Right-size API Center HPA and CPU request | done | saves about `22/month` while idle |
| Add six shared-service pods | done | adds about `18/month` while idle |

Net current savings:

```text
155-180 USD/month
```

Billing views can lag behind live resource deletion, so removed resources may
still appear in reports briefly after deletion.

## External Costs

These are outside the core GCP workload estimate.

### Confluent Cloud and AWS S3

| Item | Estimate | Notes |
| --- | ---: | --- |
| Confluent Basic Kafka cluster | starts at `0/month` | First eCKU included, then usage-based charges. |
| Kafka data in/out | about `0.05/GB` on Basic | Applies as traffic grows. |
| Kafka retained storage | about `0.08/GB-month` | Keep Kafka retention short; S3 is the long-term archive. |
| S3 Sink Connector, 1 task | `12.41-25.33/month` | Based on one connector task running all month. |
| Connector transfer | about `0.025/GB` | Billed by Confluent, pre-compression. |
| AWS S3 Standard storage | usage-based | Low at small volume; grows with raw retention. |
| AWS S3 requests | usage-based | File rotation and flush size affect object count. |
| Athena scans | usage-based | Keep validation bounded and dashboards on curated Gold/Silver outputs. |
| Athena query results | usage-based S3 storage | Apply lifecycle cleanup to the result prefix. |

Data pipeline cost guardrails:

| Guardrail | Monthly cost effect |
| --- | --- |
| Raw test retention `30-90` days | Prevents test topics from becoming permanent archive cost. |
| Raw prod retention `180-365` days | Keeps replay/audit storage explicit instead of unlimited. |
| Bronze retention `365` days | Preserves operational replay without making raw data the BI source. |
| Curated retention metric-specific | Lets approved metrics keep longer history without retaining every raw event. |
| Athena workgroup byte limits | Caps accidental broad scans before scheduled dashboards exist. |
| Separated Athena result prefixes | Lets lifecycle and IAM cleanup target query artifacts without touching raw S3. |
| Manual or daily BI refresh during pilot | Avoids high-frequency query cost before usage is proven. |

### Provider APIs

| Provider | Used by | Cost shape |
| --- | --- | --- |
| Descope | API Center auth | Free tier may be enough; paid plans can be much higher. |
| Google OAuth | `gauth` shared service | OAuth itself is not the main cost; consent/project setup matters. |
| Google Maps / Geocoding | `geo` shared service | Pay-as-you-go by SKU; set quotas. |
| Resend | `email` shared service | Free tier for low volume; paid once email grows. |
| SMS provider | `sms` shared service | Per-message usage; keep OTP retry limits strict. |
| PayMongo | `payment` shared service | Transaction fees; no always-on infrastructure fee from PayMongo itself. |

## Maintenance Cost

| Task | Cadence | Expected effort |
| --- | --- | ---: |
| Billing review and budget alerts | weekly | `15-30 min/week` |
| GKE deployment and readiness check | each deploy | `15-30 min/deploy` |
| Dependency and security update sweep | monthly | `2-4 hours/month` |
| Secret rotation review | quarterly or after exposure | `1-2 hours/rotation` |
| Confluent lag, S3 sink, and topic retention review | monthly | `30-60 min/month` |
| Redis memory and key cardinality review | monthly | `30 min/month` |
| Incident response | as needed | variable |

At a light production pace, budget:

```text
4-8 engineering hours/month
```

## Cost Controls

Keep these controls in place:

1. Keep API Center HPA at min `2`, max `3` until traffic proves it needs more.
2. Keep shared services at HPA min `1`, max `3` while traffic is low.
3. Raise an individual shared service to min `2` only when it needs no-downtime restarts.
4. Keep shared services internal only; do not add public load balancers per service.
5. Keep one Redis instance while traffic is low.
6. Keep Kafka topic retention short because S3 is the durable archive.
7. Keep Confluent S3 Sink at one task until lag requires more.
8. Keep readiness, Kafka, and failure alerts.
9. Reduce noisy request logs before disabling metrics or alerts.
10. Set budgets in GCP, Confluent, AWS, Google Maps, Resend, SMS provider, and PayMongo.
11. Set Athena workgroup scan limits before any scheduled dashboard refresh.
12. Apply S3 lifecycle rules to raw test prefixes and Athena result prefixes.
13. Keep Raw S3 restricted to platform operators; BI users should not receive raw bucket access.

For the tribe analytics pipeline, use
`docs/data-pipeline/retention-access-cost-controls.md` as the detailed control
sheet. It defines Raw S3, Bronze, Common Silver, Tribe Silver, Gold, Athena
workgroup, Databricks job cluster, publish quota, max event size, BI refresh,
and approved reader group guardrails.

## Test And Live Environment Cost Shape

The current environment split keeps costs lower by sharing the expensive managed
data-plane resources:

```text
test namespace + prod namespace
  -> one GKE Autopilot cluster
  -> one Redis instance
  -> one Confluent cluster
  -> one S3 sink connector
  -> one S3 bucket
```

Data is separated with Kafka topic prefixes:

```text
test.* -> s3://api-center-raw-data/topics/test.*
prod.* -> s3://api-center-raw-data/topics/prod.*
```

Incremental cost of the current split:

| Item | Incremental cost |
| --- | ---: |
| Test API Center pod, min 1 | low Autopilot workload cost |
| Six test shared-service pods, min 1 each | similar to current shared-service idle cost |
| Second HTTPS load balancer for `api-center-test.itsandbox.site` | another load-balancer fixed cost plus traffic |
| Extra Kafka topics | no direct topic line item, but more partitions can increase eCKU usage |
| Same S3 sink connector | no second connector task yet |
| Same S3 bucket | only extra stored data and requests |

Do not create a second GKE cluster, second Redis, second Confluent cluster, or
second S3 sink connector until live traffic requires hard isolation.

## Next Cost Risks

| Risk | Why it matters | Control |
| --- | --- | --- |
| Shared services scaled to min `2` each | Adds idle pod cost | Raise only critical services. |
| Google Maps traffic | Can grow quickly per request | Set API quotas and alerts. |
| SMS/OTP abuse | Per-message cost can spike | Rate limit OTP generation and retries. |
| Confluent connector lag | More tasks add task-hour cost | Scale tasks only when lag requires it. |
| Supabase Postgres introduced too early | Adds operational complexity before runtime cutover | Keep DB feature flags disabled until migration/backfill work is ready. |
| Cloud Logging noise | Probe/request logs can create ingestion cost | Keep probe/audit noise filtered. |
| Unused GCP networking resources | Static IPs, forwarding rules, NAT can quietly bill | Review monthly before deleting anything active. |

## Pricing Sources

- [Google Kubernetes Engine pricing](https://cloud.google.com/kubernetes-engine/pricing)
- [Memorystore for Redis pricing](https://cloud.google.com/memorystore/docs/redis/pricing)
- [Cloud Load Balancing pricing](https://cloud.google.com/load-balancing/pricing)
- [Google Cloud Observability pricing](https://cloud.google.com/stackdriver/pricing)
- [Secret Manager pricing](https://cloud.google.com/secret-manager/pricing)
- [Artifact Registry pricing](https://cloud.google.com/artifact-registry/pricing)
- [Confluent Cloud pricing](https://www.confluent.io/pricing/)
- [Confluent fully managed connector pricing](https://www.confluent.io/confluent-cloud/connect-pricing/)
- [Confluent Amazon S3 Sink Connector docs](https://docs.confluent.io/cloud/current/connectors/cc-s3-sink.html)
- [AWS S3 pricing](https://aws.amazon.com/s3/pricing/)
- [Google Maps Platform pricing overview](https://developers.google.com/maps/billing-and-pricing/overview)
- [Geocoding API usage and billing](https://developers.google.com/maps/documentation/geocoding/usage-and-billing)
- [Resend pricing](https://resend.com/pricing)
- [Descope pricing](https://www.descope.com/pricing)
- [Supabase pricing](https://supabase.com/pricing)
