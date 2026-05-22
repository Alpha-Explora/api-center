# APICenter BI Handoff Runbook

This runbook defines where Power BI, Looker, and analyst workspaces get data
from after APICenter events land in S3. It applies to `test` and `prod`.

## Decision

BI consumers do not read Raw S3 directly.

The handoff path is:

1. Tribe service publishes governed events through APICenter.
2. Confluent S3 Sink writes raw JSON by physical topic.
3. Platform Athena/Glue catalogs Raw and validates Bronze.
4. Platform-owned Common Silver normalizes shared event facts.
5. Tribe-approved Silver or Gold datasets are exposed through a governed query
   layer.
6. Power BI, Looker, or analyst notebooks connect to the governed dataset or to
   Athena query results with scoped IAM access.

Raw and Bronze remain platform-operational layers. Tribe BI readers receive
Gold when a central platform metric is being reported, or approved Tribe Silver
when the tribe owns the analysis and has a data product approval.

## Environment Split

| Environment | Data source | BI use | Access stance |
| --- | --- | --- | --- |
| `test` | `test.tribe.<tribe>.events` topics and test Athena catalogs | Validation, dashboard buildout, data-quality checks | Non-prod readers only, no production decisions |
| `prod` | `prod.tribe.<tribe>.events` topics and prod Athena catalogs | Operational reporting and approved decision support | Explicit reader group, access review, cost controls |

Never point a prod BI report at test data, and never use prod data to validate
new dashboard logic unless the report is already approved.

## Dataset Ownership

| Dataset level | Owner | Examples | BI handoff rule |
| --- | --- | --- | --- |
| Raw | Central APICenter/platform | topic payload JSON, headers, ingest metadata | No BI access |
| Bronze | Central APICenter/platform | parsed topic rows, raw schema checks | No standard BI access |
| Common Silver | Central APICenter/platform | normalized calls, decisions, costs, landing status | Platform dashboards and source for tribe products |
| Tribe Silver | Owner tribe with platform guardrails | tribe-specific event facts | Approved tribe analysts and BI owners |
| Gold | Central platform or approved tribe product owner | north-star KPIs, executive metrics, compliance views | Approved BI reports and recurring refresh |

## Central Governing Tribe Role

APICenter acts as the control plane and governing tribe for:

- topic ownership approval;
- event schema approval;
- source-to-S3 lineage;
- query-layer access;
- cost and retention controls;
- evidence that events actually landed and were curated;
- cross-tribe visibility boundaries.

That means APICenter can see the full platform lineage, but tribes only see
datasets approved for their tribe or for shared platform reporting.

## Tribe Reader Handoff

For a tribe reader group, provide:

1. Environment: `test` or `prod`.
2. Owner tribe id.
3. Approved dataset name.
4. Query surface: Athena workgroup, view/table, or materialized output prefix.
5. Result prefix:
   `s3://<athena-results-bucket>/athena-results/<purpose>/<environment>/<tribe>/`.
6. Allowed refresh cadence and scan budget.
7. Data owner and steward.
8. Last validation evidence from the data-quality gate checklist.

Do not hand off bucket-wide S3 access. Use IAM Identity Center groups and
Athena workgroup controls.

## BI Connection Pattern

For Power BI or Looker:

1. Connect using the approved Athena connector or a governed warehouse export.
2. Select only the approved database/table/view.
3. Set the result location to the approved tribe or BI prefix.
4. Configure scheduled refresh with the approved cadence.
5. Keep import/direct-query mode aligned with the scan budget.
6. Add a visible environment label in non-prod reports.
7. Record the report owner and refresh schedule in the BI inventory.

If the BI tool cannot enforce scoped result prefixes or query limits, the data
must be materialized to an approved Gold output before handoff.

## Power BI Embed In Management Console

The management console may embed the approved APICenter north-star Power BI
report as a read-only operator view.

Embed approval checklist:

- The report uses Gold or materialized outputs as its dataset source.
- The report does not connect to Raw S3.
- The report has separate test and prod workspaces, datasets, or parameters.
- The visible report page labels the environment.
- Scheduled refresh cadence and scan budget are recorded in the BI inventory.
- The report owner and data steward are recorded.
- The management deployment stores only the report embed URL and report id.
- No Power BI client secret, AWS key, or Athena credential is exposed to the
  browser.

If any checklist item is not satisfied, leave
`POWERBI_NORTH_STAR_ENABLED=false` and use the native `/data-pipeline` views
until the report is approved.

## North-Star Mapping

The central platform dashboard should answer:

```text
From tribe request to gateway decision to event export to visualization, can we
trace who called what, whether it was allowed, what happened, how much it cost,
and where the data landed?
```

Minimum Gold fields for that view:

| Field | Source |
| --- | --- |
| `environment` | physical topic prefix and event metadata |
| `owner_tribe_id` | topic ownership registry |
| `source_service_id` | event payload/metadata |
| `caller_service_id` | gateway decision/event payload |
| `target_service_id` | gateway decision/event payload |
| `decision` | gateway decision event |
| `event_type` | event schema registry |
| `request_id` / `correlation_id` | publish metadata |
| `cost_estimate` | query/pipeline cost rollup |
| `raw_s3_prefix` | topic landing contract |
| `bronze_table` | Glue/Athena catalog |
| `curated_dataset` | Silver/Gold registry |
| `latest_landing_at` | data-quality gate evidence |

## Refresh Rules

| Report type | Recommended source | Cadence |
| --- | --- | --- |
| Pipeline health | Common Silver or platform Gold | 15-60 minutes in test, 15-30 minutes in prod if cost-approved |
| Tribe operational BI | Tribe Silver | Hourly or daily depending on volume |
| Executive north-star | Gold | Daily, or hourly for launch monitoring |
| Incident/debug report | Common Silver with temporary access | Time-boxed and removed after incident closure |

## Handoff Checklist

- Topic is in `infra/aws-data-pipeline/topic-projection-values.txt`.
- S3 Sink includes the physical topic.
- Event schema is approved for the environment.
- Raw landing has recent evidence.
- Bronze catalog/query succeeds.
- Common Silver or Tribe Silver query succeeds.
- Gold metric definition exists when the report is platform-owned.
- Athena result prefix is tribe/environment scoped.
- Reader group has least-privilege IAM access.
- Scan budget and refresh cadence are documented.
- Report owner and data steward are recorded.

## Improvement Path

1. Maintain a BI inventory file that maps reports to datasets, owners, refresh
   cadence, and access groups.
2. Add automatic freshness checks for all Gold datasets.
3. Materialize high-use Gold datasets to reduce Athena scan costs.
4. Add report-level lineage back to topic, schema version, and source service.
5. Add an approval workflow before a Tribe Silver dataset becomes a recurring
   BI source.
