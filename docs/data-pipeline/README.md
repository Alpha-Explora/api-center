# APICenter Data Pipeline

This is the starting point for APICenter raw-to-visualization work. Keep the
pipeline aligned to the north star:

```text
From tribe request to gateway decision to event export to visualization, can we
trace who called what, whether it was allowed, what happened, how much it cost,
and where the data landed?
```

## Current Scope

| Layer                   | Current source                                                               | Active docs                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Event ownership         | Tribe-owned topics per environment, with `sourceServiceId` in event metadata | `tribe-event-contract.md`, `new-tribe-s3-onboarding-runbook.md`                             |
| Raw landing             | Confluent S3 Sink to `s3://api-center-raw-data/topics/<physical_topic>/...`  | `actual-pipeline-runbook.md`, `raw-to-bronze-runbook.md`                                    |
| Athena catalog          | Partition projection over approved physical topics                           | `infra/aws-data-pipeline/README.md`, `infra/aws-data-pipeline/catalog/raw-topic-tables.sql` |
| Event schema governance | Approved `event_type` and `schema_version` decisions before prod publish     | `event-schema-governance.md`, `infra/aws-data-pipeline/catalog/event-schema-registry.sql`   |
| Athena results          | Governed result prefixes by purpose, environment, and tribe                  | `athena-results-runbook.md`                                                                 |
| Tribe AWS access        | IAM Identity Center and Athena handoff for tribe analytics/BI readers        | `tribe-platform-aws-access-handoff.md`, `bi-handoff-runbook.md`                              |
| Curated views           | Bronze lanes, common silver, gold platform health                            | `silver-gold-ownership-runbook.md`, `metric-dictionary.md`                                  |
| Tribe data products     | Repeatable Tribe Silver/Gold generation from Common Silver                   | `tribe-curated-data-product-runbook.md`, `tribe-data-governance-checklist.md`               |
| Tribe-facing manual     | Detailed product-tribe guide from setup and SDK publish through Common Silver, Silver/Gold, and BI handoff | `tribe-data-pipeline-manual.md`                                                            |
| Onboarding state        | Evidence-derived topic state, no optimistic advancement                      | `topic-onboarding-state-contract.md`                                                        |
| Data quality gates      | Required checks before BI, Gold, or decision-feedback use                    | `data-quality-gates.md`                                                                      |
| Retention/access/cost   | Raw platform-only, bounded scans, lifecycle controls                         | `retention-access-cost-controls.md`                                                         |

## Operator Flow

1. Approve the owner tribe and physical topic.
2. Add the physical topic to
   `infra/aws-data-pipeline/topic-projection-values.txt`.
3. Run the projection drift gate:

   ```powershell
   .\scripts\data-pipeline\check-topic-projection-drift.ps1 `
     -TopicsFile .\infra\aws-data-pipeline\topic-projection-values.txt `
     -ExpectedTopic <environment>.tribe.<ownerTribeId>.events
   ```

4. Generate the Athena projection enum:

   ```powershell
   node .\scripts\data-pipeline\resolve-athena-topic-projection.js `
     -TopicsFile .\infra\aws-data-pipeline\topic-projection-values.txt
   ```

5. Update the `projection.physical_topic.values` properties in
   `infra/aws-data-pipeline/catalog/raw-topic-tables.sql`.
6. Include the topic in the managed Confluent S3 Sink connector.
7. Add or approve the event schema record for the target environment.
8. Generate the tribe curated SQL dry-run when Silver/Gold is requested.
9. Publish a smoke event through APICenter.
10. Validate S3, Raw Athena, Bronze, Common Silver, and Gold evidence.

CI runs:

```powershell
npm run check:data-pipeline-projection
```

This fails if the tracked projection file is unsorted or out of sync with
`infra/aws-data-pipeline/catalog/raw-topic-tables.sql`.

Raw S3 remains platform-only. Do not grant BI users or tribes direct access to
`s3://api-center-raw-data/topics/`. Tribe-facing and BI access must use governed
Athena result prefixes or curated datasets.

## Active Runbooks

| Runbook                                         | Purpose                                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `apicenter-total-data-pipeline-architecture.md` | Full APICenter pipeline model across test, prod, tribes, shared services, and central governance. |
| `tribe-data-pipeline-manual.md`                 | Detailed tribe-facing manual for setup, SDK publishing, pipeline evidence, Common Silver, Tribe Silver, Gold, and BI handoff. |
| `actual-pipeline-runbook.md`                    | Current pilot evidence and end-to-end validation steps.                                           |
| `new-tribe-s3-onboarding-runbook.md`            | Checklist for onboarding a new owner tribe topic.                                                 |
| `topic-onboarding-state-contract.md`            | Evidence requirements for topic state transitions.                                                |
| `raw-to-bronze-runbook.md`                      | Raw landing and Bronze catalog validation.                                                        |
| `athena-results-runbook.md`                     | Result prefix resolver and cleanup rules.                                                         |
| `tribe-platform-aws-access-handoff.md`          | Exact AWS/IAM/Athena handoff model for tribe analytics and BI readers.                             |
| `bi-handoff-runbook.md`                         | Where Power BI, Looker, and analyst workspaces get governed data from test and prod.                |
| `data-quality-gates.md`                         | Gate checklist before a dataset is trusted for BI, Gold metrics, or feedback loops.                 |
| `event-schema-governance.md`                    | Event type, schema version, compatibility, and publish-gate rules.                                |
| `tribe-curated-data-product-runbook.md`         | Dry-run generator and approval flow for Tribe Silver/Gold data products.                          |
| `silver-gold-ownership-runbook.md`              | Curated view ownership and promotion rules.                                                       |
| `retention-access-cost-controls.md`             | Retention, IAM, scan cost, and cleanup controls.                                                  |
| `metric-dictionary.md`                          | Shared metric definitions for dashboards.                                                         |
| `pipeline-exception-request-template.md`        | Required template for per-service topic exceptions.                                               |
