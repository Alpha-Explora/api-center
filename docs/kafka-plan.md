# Kafka on GKE: Full Implementation Plan

> Current production direction: Confluent Cloud. The self-hosted Strimzi/GKE Kafka plan below is historical fallback context. Use `docs/developer/confluent-cloud-migration-plan.md` as the active implementation plan.

## 1. Purpose and Outcome

This document defines a production-ready plan to run a self-hosted Apache Kafka cluster on Google Kubernetes Engine (GKE) for APICenter workloads.

Target outcomes:
- Reliable event streaming with clear RTO and RPO targets.
- Secure-by-default cluster access (private network, TLS, authn, authz).
- Predictable operations with monitoring, alerting, backup, and DR procedures.
- Safe rollout and migration path from current integrations.

## 2. Scope

In scope:
- Kafka cluster design and deployment in GKE.
- Capacity and storage planning.
- Security controls, network model, IAM, and secrets.
- Observability, SRE runbooks, and incident response.
- Rollout and migration strategy.

Out of scope:
- Application-level schema redesign.
- Downstream consumer business logic changes.
- Multi-cloud active-active architecture.

## 3. Assumptions

- Environment runs in GCP with GKE available.
- Workloads communicate through private VPC networking.
- At least 3 availability zones are available in target region.
- APICenter services can be configured for Kafka bootstrap and SASL/TLS.
- Team can operate Kubernetes, Helm, and GitHub Actions deployment workflows.

## 4. High-Level Architecture

Recommended architecture:
- Kafka operator: Strimzi (KRaft mode, no ZooKeeper).
- Cluster topology:
  - 3 Kafka controller nodes.
  - 3 Kafka broker nodes minimum (scale to 5+ as needed).
- Regional GKE cluster spread across 3 zones.
- Dedicated Kafka node pool with taints and labels.
- Persistent SSD disks per broker via StatefulSet PVCs.
- Internal listeners only by default.
- Optional external access through private load balancer and IP allowlist.

Data durability baseline:
- Topic replication factor: 3.
- Min in-sync replicas: 2.
- Producer acks: all.
- Unclean leader election: disabled.

## 5. Decision Record

Primary decisions and rationale:

1. Use Strimzi over manual StatefulSet
- Reduces operational risk with opinionated CRDs, upgrades, and certificate lifecycle.

2. Use KRaft mode
- Removes ZooKeeper operational overhead and aligns with Kafka roadmap.

3. Internal-only listeners by default
- Minimizes network exposure and simplifies security posture.

4. Regional cluster + zone-aware broker placement
- Improves resilience to zone failure and maintenance events.

5. Separate Kafka node pool
- Prevents noisy neighbor impact from API and worker workloads.

## 6. Capacity Planning Model

Estimate capacity using peak throughput and retention:

Inputs:
- `T_in`: peak inbound throughput (MB/s).
- `T_out`: peak outbound throughput (MB/s).
- `R`: retention duration (seconds).
- `RF`: replication factor.
- `H`: overhead factor (index, compaction, protocol overhead), default 1.25.

Storage estimate:

$$
Storage_{raw} = T_{in} \times R
$$

$$
Storage_{total} = Storage_{raw} \times RF \times H
$$

Per-broker storage:

$$
Storage_{broker} = \frac{Storage_{total}}{N_{brokers}}
$$

Planning rules:
- Keep disk utilization under 70% steady state.
- Alert at 75%, page at 85%.
- Reserve at least 30% headroom for rebalancing and incident recovery.

Partition planning guidelines:
- Start with 12 to 24 partitions for medium traffic domains.
- Avoid over-partitioning early; increase only when needed.
- Cap partition growth with quarterly review and load-test evidence.

## 7. GKE Foundation Plan

### 7.1 Cluster

- Use regional GKE Standard (not Autopilot for Kafka stateful workloads).
- Enable Workload Identity.
- Enable VPC-native/IP aliasing.
- Enable network policy enforcement.
- Prefer private cluster and authorized networks for control plane access.

### 7.2 Node Pools

Create dedicated node pool for Kafka:
- Machine family: memory-optimized or compute-optimized based on benchmark.
- Disk type: `pd-ssd`.
- Node taint: `kafka=true:NoSchedule`.
- Node label: `workload=kafka`.
- Disable frequent disruption settings; use controlled upgrade windows.

Optional pools:
- Operator/system components pool.
- Monitoring components pool.

### 7.3 Scheduling Controls

- Pod anti-affinity for brokers and controllers.
- Topology spread constraints by zone.
- PodDisruptionBudget for brokers and controllers.
- PriorityClass for Kafka critical pods.

## 8. Security and Compliance Plan

### 8.1 Identity and Access

- Use Kubernetes service accounts with Workload Identity mappings.
- Limit Strimzi operator RBAC to Kafka namespace where possible.
- Separate admin, platform, and app-team permissions.

### 8.2 Encryption

- TLS enabled for all broker listeners.
- TLS for inter-broker communication.
- Rotate certificates on defined schedule.
- Encrypt PVCs using GCP-managed or CMEK keys.

### 8.3 Authentication and Authorization

- Use SASL SCRAM-SHA-512 for clients.
- Optional mTLS for highly sensitive producers/consumers.
- Enforce ACLs by service principal and topic prefix.
- Deny wildcard ACLs in production.

### 8.4 Network Controls

- Internal load balancer listeners only by default.
- NetworkPolicy allow only approved namespaces and ports.
- Egress restrictions to required dependencies only.
- No public broker endpoints unless approved exception exists.

### 8.5 Secrets

- Store credentials in Secret Manager.
- Sync to Kubernetes Secret via approved secret sync mechanism.
- Never place plaintext secrets in Git repositories.

## 9. Strimzi Deployment Plan

### 9.1 Install Sequence

1. Create `kafka` namespace.
2. Install Strimzi CRDs and operator.
3. Apply baseline RBAC and network policies.
4. Deploy Kafka cluster CR (controllers first, then brokers).
5. Deploy Kafka users and topic templates.
6. Deploy exporters and dashboards.

### 9.2 Kafka Cluster Baseline Configuration

Cluster baseline values (starting point):
- Kafka version: current stable supported by Strimzi.
- Controllers: 3.
- Brokers: 3.
- JVM heap: start at 6 to 8 GB (tune after benchmarks).
- Log retention: by topic class (hot/warm/cold).
- `min.insync.replicas=2`.
- `default.replication.factor=3`.
- `num.partitions=12` default only for non-critical topics.

Reliability settings:
- `unclean.leader.election.enable=false`
- `auto.create.topics.enable=false`
- `controlled.shutdown.enable=true`

### 9.3 Topic Governance

Define classes and defaults:

1. Critical topics
- Replication factor 3, retention 7 to 30 days.
- Compaction where idempotent key semantics are needed.

2. Standard topics
- Replication factor 3, retention 3 to 7 days.

3. Ephemeral topics
- Replication factor 2 or 3 by risk profile, retention less than 24 hours.

Naming convention:
- `<domain>.<entity>.<event>.<version>`
- Example: `tribe.user.created.v1`

## 10. Application Integration Plan (APICenter)

Configuration contract for services:
- `KAFKA_BOOTSTRAP_SERVERS`
- `KAFKA_SECURITY_PROTOCOL` (`SASL_SSL`)
- `KAFKA_SASL_MECHANISM` (`SCRAM-SHA-512`)
- `KAFKA_SASL_USERNAME`
- `KAFKA_SASL_PASSWORD`
- `KAFKA_CLIENT_ID`

Producer defaults:
- `acks=all`
- `enable.idempotence=true`
- `retries` high
- `max.in.flight.requests.per.connection<=5`
- Delivery timeout tuned to SLO

Consumer defaults:
- Explicit consumer groups
- Bounded concurrency per partition
- Retry with backoff
- Dead-letter topic pattern for poison records

## 11. Observability Plan

### 11.1 Metrics

Required broker and cluster metrics:
- Offline partitions count
- Under-replicated partitions
- ISR shrink/expand rate
- Produce and fetch request latency (P95/P99)
- Network throughput in/out
- Disk usage and segment growth
- Consumer lag by group and topic

### 11.2 Logging

- Centralize logs from Kafka brokers, controllers, and Strimzi operator.
- Keep 14 days searchable logs minimum.
- Add correlation IDs in application logs for producer/consumer tracing.

### 11.3 Alerts

P1 alerts:
- Offline partitions > 0
- Under-replicated partitions sustained > threshold
- Controller quorum instability

P2 alerts:
- Disk usage > 75%
- Lag growth sustained > threshold
- Auth failures burst

P3 alerts:
- Rebalance frequency above baseline
- Non-critical topic lag spikes

## 12. Backup and Disaster Recovery

### 12.1 Backups

- Back up Kafka CRs, users, topics, and ACL manifests (Git + periodic snapshots).
- Back up critical metadata exports daily.
- Keep immutable backup copies in separate GCS bucket with retention policy.

### 12.2 Cross-Region DR

- Deploy warm standby Kafka cluster in secondary region.
- Use MirrorMaker 2 for selected critical topics.
- Define failover criteria and manual approval flow.

### 12.3 Recovery Targets

- Initial target: RPO <= 15 minutes for critical topics.
- Initial target: RTO <= 60 minutes for critical pipeline restoration.

### 12.4 DR Drills

- Quarterly failover simulation.
- Measure and publish actual RTO and RPO.
- Track follow-up actions from each drill.

## 13. Performance and Resilience Testing Plan

Load tests before production:
- Test normal peak and 2x peak traffic.
- Validate latency SLO under sustained load.
- Validate consumer lag recovery after spikes.

Failure tests:
- Kill one broker pod.
- Drain one Kafka node.
- Simulate one zone outage.
- Rotate certificates and secrets during load.

Acceptance criteria:
- No data loss beyond agreed RPO.
- Recovery within RTO.
- No critical alerts sustained post-recovery.

## 14. Rollout Plan

### 14.1 Environments

1. Dev
- Functional verification and client connectivity.

2. Staging
- Load tests, chaos tests, runbook validation.

3. Production
- Canary producers and consumers first.
- Batch migration by service group.

### 14.2 Migration Sequence

1. Provision cluster and baseline topics.
2. Deploy dual-write for selected producers (if feasible).
3. Start shadow consumers and compare outputs.
4. Shift read path to new cluster.
5. Disable old path after stable window.

### 14.3 Go/No-Go Gates

- Security controls validated.
- Monitoring and paging validated.
- Runbooks tested.
- Staging load test passed.
- Rollback path documented and tested.

## 15. Operations Runbook Summary

Daily checks:
- Cluster health, ISR, offline partitions
- Top lagging consumer groups
- Disk and memory trends

Weekly checks:
- Partition distribution and skew
- Rebalance events
- Topic retention compliance

Monthly checks:
- Capacity forecast update
- ACL audit
- Certificate expiry review
- Patch/upgrade planning

Incident severity model:
- Sev1: data loss risk, cluster unavailable
- Sev2: partial degradation with workaround
- Sev3: non-critical degradation

## 16. Risk Register

1. Disk saturation
- Mitigation: strict alerting, autoscaling playbook, retention controls.

2. Misconfigured ACLs blocking production traffic
- Mitigation: staged ACL rollout, canary principals, break-glass admin flow.

3. Zone outage causing insufficient ISR
- Mitigation: multi-zone spread, min ISR tuning, rapid broker recovery runbook.

4. Operator upgrade regression
- Mitigation: pre-prod upgrade rehearsal and version pinning.

5. Unbounded partition growth
- Mitigation: topic governance policy and review board.

## 17. Work Breakdown and Timeline

Suggested timeline (6 weeks):

Week 1:
- Finalize requirements and sizing.
- Confirm security and compliance controls.

Week 2:
- Build GKE foundation and node pools.
- Install Strimzi in dev.

Week 3:
- Deploy Kafka in dev and integrate first service.
- Implement dashboards and alert rules.

Week 4:
- Deploy staging and execute load/failure tests.
- Validate DR replication and runbooks.

Week 5:
- Production readiness review.
- Enable canary migration.

Week 6:
- Progressive production rollout.
- Post-implementation review and action items.

## 18. Ownership Model

Platform team owns:
- Cluster, operator, security controls, upgrades, backups, observability.

Application teams own:
- Topic contracts, schema evolution, retry/DLQ behavior, consumer lag hygiene.

SRE/on-call owns:
- Incident response, paging triage, reliability reporting.

## 19. Acceptance Checklist

Technical:
- [ ] Kafka cluster deployed in KRaft mode across 3 zones.
- [ ] All broker traffic encrypted with TLS.
- [ ] SASL authn and ACL authz enforced.
- [ ] Monitoring dashboards and alerts active.
- [ ] Backup and DR replication configured.

Operational:
- [ ] Runbooks approved and tested.
- [ ] On-call training completed.
- [ ] Failover drill completed with documented results.

Business:
- [ ] Critical event pipelines migrated.
- [ ] SLOs met for 2 consecutive weeks.
- [ ] Stakeholder sign-off completed.

## 20. Next Implementation Deliverables

After this plan is approved, produce:

1. Strimzi manifest pack:
- Namespace, operator install, Kafka CR, users, topics, policies.

2. Security manifest pack:
- NetworkPolicy, RBAC, secret sync templates.

3. Observability pack:
- Prometheus rules, Grafana dashboard JSON, alert routing config.

4. Migration pack:
- Service onboarding checklist, rollback playbook, cutover SOP.

5. DR pack:
- MirrorMaker 2 manifests and failover runbook.
