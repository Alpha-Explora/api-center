# APICenter Athena Account Next Steps

Use this guide after your AWS/Athena account has already been created and your
temporary password has been sent to you separately.

This is the member-side checklist. Follow it in order. Do not skip to Power BI,
Looker, or raw S3 before the Athena validation steps pass.

## What This Access Is For

Your Athena access is for APICenter data-pipeline validation and BI readiness.
You are checking that APICenter events can be traced through the governed
analytics path:

```text
tribe backend
  -> APICenter SDK publish
  -> APICenter governance
  -> Confluent topic
  -> S3 raw topic folder
  -> Athena raw table
  -> Bronze parsed events
  -> Common Silver envelope
  -> Tribe Silver or Gold
  -> BI, dashboard, or governed Athena result
```

For normal dashboard and reporting work, start from Gold, Tribe Silver, or
Common Silver. Do not use Raw S3 as the BI source.

## Before You Start

You should have:

| Item | What it means |
| --- | --- |
| AWS console URL | The APICenter AWS login page. |
| IAM username | Usually your own UST email address. |
| Temporary password | Sent separately by the platform owner. |
| Target environment | `test` or `prod`. Use `prod` only for approved reporting. |
| Target date | The `year`, `month`, and `day` you are allowed to query. |
| Target dataset | Usually `gold_platform.pipeline_health_daily` first. |

If you are missing the login URL, username, or temporary password, ask for those
three items only. Do not ask for raw S3 access.

## Step 1: Log In To AWS

1. Open the AWS console URL:

   ```text
   https://688717565427.signin.aws.amazon.com/console
   ```

2. Enter your IAM username.

   Use your own username only. Do not share usernames or passwords.

3. Enter the temporary password.

4. When AWS asks for a new password, set your own password.

5. Save the new password in your own password manager.

6. Do not send your new password to anyone.

Done when:

- you can open the AWS console;
- your temporary password has been changed;
- you are logged in under your own IAM user.

## Step 2: Set The Correct AWS Region

1. In the top-right AWS region selector, choose:

   ```text
   ap-southeast-2
   ```

2. Stay in this region for all Athena checks in this guide.

Done when:

- the AWS console region shows `ap-southeast-2`.

If you use the wrong region, Athena may appear empty or show the wrong
workgroups.

## Step 3: Open Athena

1. In the AWS console search bar, search for:

   ```text
   Athena
   ```

2. Open **Amazon Athena**.

3. If Athena asks which experience to use, open the query editor.

Done when:

- you can see the Athena query editor;
- you can see a workgroup selector.

## Step 4: Select The Right Workgroup

Use an environment-specific workgroup. For the first validation, select:

```text
api-center-platform-validation-prod
```

Other workgroups you may see:

| Workgroup | Use |
| --- | --- |
| `api-center-platform-validation-test` | Non-production validation. |
| `api-center-platform-validation-prod` | Production validation and approved checks. |
| `api-center-management-test` | Management UI/API test queries. |
| `api-center-management-prod` | Management UI/API production queries. |
| `api-center-tribe-<tribe_id>-test` | Tribe-scoped non-production reader workgroup. |
| `api-center-tribe-<tribe_id>-prod` | Tribe-scoped production reader workgroup. |

Done when:

- Athena shows `api-center-platform-validation-prod` as the selected workgroup
  for the first check.

If a query fails with an output-location or result-bucket error, first confirm
the workgroup. Do not debug table names first.

## Step 5: Confirm The Expected Databases Exist

Run:

```sql
SHOW DATABASES;
```

You should expect to see databases such as:

```text
api_center_raw
bronze
common_silver
gold_platform
materialized_platform
governance
```

What each database means:

| Database | Purpose | Normal member use |
| --- | --- | --- |
| `api_center_raw` | Raw Athena table over S3 topic exports. | Validation only, with strict topic/date filters. |
| `bronze` | Parsed and validated raw events. | Platform troubleshooting. |
| `common_silver` | Standard APICenter event envelope across tribes. | Event-level validation and mapping. |
| `gold_platform` | Dashboard-ready platform metrics. | Primary starting point for BI and reporting. |
| `materialized_platform` | Parquet-backed snapshots for repeated refreshes. | Preferred for repeated Power BI refreshes. |
| `governance` | Schema and governance metadata. | Reference checks when approved. |

Done when:

- you can see `gold_platform`;
- you can see `common_silver`;
- you can see `materialized_platform`.

If you cannot see these databases, capture a screenshot and send the selected
region and workgroup to the platform owner.

## Step 6: Run The First Safe Gold Query

Use Gold first. This checks dashboard-ready pipeline health without touching
raw S3 directly.

Run:

```sql
SELECT
  environment,
  tribe_id,
  source_service_id,
  event_type,
  event_day,
  event_count,
  latest_ingested_at
FROM gold_platform.pipeline_health_daily
WHERE environment = 'prod'
  AND year = '2026'
  AND month = '05'
  AND day = '20'
ORDER BY event_day DESC, tribe_id, source_service_id, event_type
LIMIT 50;
```

What to check:

| Field | What to look for |
| --- | --- |
| `environment` | Should match the environment you selected, usually `prod`. |
| `tribe_id` | The owner tribe that produced the event. |
| `source_service_id` | The producing service or app inside the tribe. |
| `event_type` | The business or platform event type. |
| `event_day` | The date bucket being reported. |
| `event_count` | Number of events counted for that grouping. |
| `latest_ingested_at` | Most recent time the pipeline observed the event. |

Done when:

- the query succeeds;
- rows appear, or the query returns zero rows without an error;
- you save the query ID;
- you capture the result or screenshot.

Send back:

```text
Gold query status: succeeded
Workgroup: api-center-platform-validation-prod
Database/table: gold_platform.pipeline_health_daily
Environment: prod
Date filter: 2026-05-20
Query ID: <paste query id>
Rows returned: <number>
```

If the query succeeds with zero rows, that is not automatically an access
problem. It may mean the selected date has no data. Try the approved date from
the platform owner.

## Step 7: Run The Common Silver Event-Level Query

Use Common Silver when you need event-level detail behind the Gold numbers.
If your account is a tribe-scoped reader, keep the query inside your approved
topic. Do not run discovery queries such as `SELECT DISTINCT tribe_id FROM
common_silver.tribe_event_envelope` because that asks Athena to plan across the
shared raw table and can be denied by the raw S3 bucket policy.

For a tribe-scoped reader, replace `<tribe_id>`, `<environment>`, and the date
before running:

```sql
SELECT
  source_topic,
  environment,
  tribe_id,
  source_service_id,
  event_type,
  schema_version,
  occurred_at,
  ingested_at,
  year,
  month,
  day
FROM common_silver.tribe_event_envelope
WHERE source_topic = '<environment>.tribe.<tribe_id>.events'
  AND environment = '<environment>'
  AND year = '2026'
  AND month = '05'
  AND day = '21'
ORDER BY source_service_id, event_type, occurred_at
LIMIT 100;
```

Example for the Smurf Village test reader:

```sql
SELECT DISTINCT tribe_id
FROM common_silver.tribe_event_envelope
WHERE source_topic = 'test.tribe.smurf-village.events'
  AND environment = 'test'
  AND year = '2026'
  AND month = '05'
LIMIT 20;
```

What to check:

| Field | What to look for |
| --- | --- |
| `source_topic` | The approved physical topic for your tribe and environment. |
| `tribe_id` | Your approved tribe value. |
| `source_service_id` | Same source services you saw in Gold. |
| `event_type` | Events that can be mapped to dashboard metrics. |
| `schema_version` | The event contract version. |
| `occurred_at` | When the event happened in the producer system. |
| `ingested_at` | When APICenter analytics received it. |
| `year`, `month`, `day` | Partition columns. These must stay filtered. |

Done when:

- the query succeeds;
- you can identify at least one `tribe_id`, `source_service_id`, and
  `event_type` mapping;
- you save the query ID.

Send back:

```text
Common Silver query status: succeeded
Workgroup: <approved workgroup>
Database/table: common_silver.tribe_event_envelope
Source topic: <environment>.tribe.<tribe_id>.events
Environment: <environment>
Date filter: 2026-05-21
Query ID: <paste query id>
Rows returned: <number>
Sample mapping:
- tribe_id: <value>
- source_service_id: <value>
- event_type: <value>
```

## Step 8: Use Raw Only For Bounded Validation

Raw is not the dashboard source. Use raw only when you need to prove that a
specific physical topic landed in S3.

Only run this if the platform owner gives you a target tribe/topic.

Replace `<tribe_id>` before running:

```sql
SELECT
  physical_topic,
  year,
  month,
  day,
  COUNT(*) AS record_count
FROM api_center_raw.topic_records
WHERE physical_topic = 'prod.tribe.<tribe_id>.events'
  AND year = '2026'
  AND month = '05'
  AND day = '21'
GROUP BY 1, 2, 3, 4;
```

Rules for raw validation:

- Always filter by `physical_topic`.
- Always filter by `year`, `month`, and `day`.
- Do not run `SELECT *` on raw.
- Do not use raw as a Power BI or Looker source.
- Do not ask for bucket-wide raw S3 access.

Done when:

- the query confirms whether the selected topic has records for the selected
  date;
- you save the query ID.

Send back:

```text
Raw validation status: succeeded
Physical topic: prod.tribe.<tribe_id>.events
Date filter: 2026-05-21
Query ID: <paste query id>
Record count: <number>
```

## Step 9: Decide What Dataset BI Should Use

Use this decision table before building a report:

| Need | Use |
| --- | --- |
| Dashboard or platform reporting | `gold_platform.*` or materialized equivalent. |
| Repeated Power BI refresh | `materialized_platform.*`. |
| Event-level validation | `common_silver.tribe_event_envelope`. |
| Tribe-specific analysis | Approved `silver_<tribe_id>.*` or `gold_<tribe_id>.*`, if available. |
| Raw landing proof | `api_center_raw.topic_records` with topic/date filters only. |

Default rule:

```text
Exploration = Gold with strict filters.
Repeated dashboard refresh = materialized_platform.
Event-level trace = Common Silver.
Raw = validation only.
```

If you are not sure what to use, start from
`gold_platform.pipeline_health_daily` and write down the exact metric you are
trying to show.

## Step 10: What You Need Before Building Power BI Or Looker

Before creating a report, collect this handoff packet:

```text
environment: test or prod
tribe_id:
approved dataset/table:
Athena workgroup:
result prefix:
allowed refresh cadence:
scan budget:
report owner:
data steward:
approved date range:
```

Example:

```text
environment: prod
tribe_id: logistics
approved dataset/table: materialized_platform.gold_platform_pipeline_health_daily_prod_20260520
Athena workgroup: api-center-platform-validation-prod
result prefix: s3://api-center-athena-results/athena-results/platform/validation/prod/
allowed refresh cadence: daily
scan budget: approved by platform owner
report owner: <name>
data steward: <name>
approved date range: 2026-05-20
```

Do not create recurring BI refreshes until the dataset, cadence, and owner are
approved.

## Step 11: Connect Power BI Or Looker

Use the approved Athena connector or a governed warehouse/export provided by
the platform owner.

Connection rules:

1. Select only the approved database/table/view.
2. Use the approved workgroup.
3. Use the approved result prefix.
4. Keep the report environment clear: `test` reports must visibly say `test`.
5. Use import/direct-query mode only if it matches the approved scan budget.
6. Record the report owner and refresh cadence.
7. Do not use raw S3 as the source.
8. Do not use your personal human IAM user as a scheduled refresh credential.

If the BI tool cannot enforce scoped result prefixes or query limits, ask the
platform owner for a `materialized_platform.*` table or another governed export
before scheduling refresh.

## Step 12: Evidence You Must Send Back

After your first validation pass, send this in one message:

```text
AWS login: succeeded
Region: ap-southeast-2
Athena workgroup: api-center-platform-validation-prod

SHOW DATABASES:
- gold_platform visible: yes/no
- common_silver visible: yes/no
- materialized_platform visible: yes/no

Gold query:
- table: gold_platform.pipeline_health_daily
- environment: prod
- date: 2026-05-20
- query id:
- rows returned:

Common Silver query:
- table: common_silver.tribe_event_envelope
- environment: prod
- date: 2026-05-21
- query id:
- rows returned:

BI target:
- Power BI / Looker / notebook / none yet
- intended dataset:
- intended refresh cadence:
```

Attach screenshots only if a query fails or if the platform owner asks for
visual evidence.

## What Not To Do

Do not:

- share your AWS account;
- share your password;
- create access keys unless the platform owner explicitly approves it;
- create, edit, or delete Athena workgroups;
- edit Glue tables or databases;
- delete S3 objects;
- ask for bucket-wide raw S3 access;
- run broad raw scans;
- run `SELECT *` on large Gold or raw tables without date filters;
- use raw S3 for Power BI or Looker;
- use your human AWS account as the scheduled refresh account;
- point a production report at test data;
- use production data to experiment with unapproved dashboard logic.

## Common Problems And Fixes

### I Can Log In, But Athena Looks Empty

Check:

1. Region is `ap-southeast-2`.
2. Workgroup is `api-center-platform-validation-prod` or the approved
   environment-specific workgroup.
3. You are using the Athena query editor, not another AWS service page.

Send back:

```text
Issue: Athena looks empty
Region shown:
Workgroup selected:
Screenshot attached: yes/no
```

### I See Databases, But Queries Fail

Check the selected workgroup first. Query failures often come from workgroup or
result-output configuration, not from missing databases.

Send back:

```text
Issue: Query failed
Workgroup:
Query ID:
Exact error message:
SQL used:
```

### The Query Returns Zero Rows

Zero rows can be valid. Check:

1. Are you using the approved `environment`?
2. Are `year`, `month`, and `day` correct?
3. Did the platform owner give you a different validation date?
4. Are you querying a tribe that had events on that date?

Do not remove filters to "find data." Ask for the correct date or tribe.

### I Need Data For A Dashboard

Use this order:

1. Try approved Gold table with strict filters.
2. If the dashboard refreshes repeatedly, ask for a `materialized_platform.*`
   table.
3. Use Common Silver only for event-level details.
4. Do not use raw S3.

### I Need A Tribe-Specific Dataset

Ask for:

```text
tribe_id:
approved Tribe Silver table:
approved Tribe Gold table:
data owner:
data steward:
allowed readers:
refresh cadence:
```

If no Tribe Silver or Tribe Gold exists yet, start from Common Silver for
validation and request a tribe data-product approval before recurring BI use.

### Power BI Or Looker Needs Scheduled Refresh

Do not use your human AWS account for scheduled refresh.

Ask the platform owner for:

```text
approved service credential or governed connector path
approved dataset/table
approved result prefix
approved refresh cadence
scan budget
report owner
data steward
```

If the report is repeated or slow, request a materialized table.

## Quick Reference

Use:

```text
Gold -> dashboards and platform BI
materialized_platform -> repeated dashboard refresh
Tribe Silver or Tribe Gold -> approved tribe-specific BI
Common Silver -> event-level validation
Raw/Bronze -> platform troubleshooting only
```

Avoid:

```text
Raw S3 -> dashboards
human IAM account -> scheduled refresh
unbounded queries -> validation
test data -> production dashboard
production data -> unapproved dashboard experiment
```

## Final Done State

You are done with the first Athena account validation when:

- you changed your temporary password;
- AWS region is `ap-southeast-2`;
- Athena opens successfully;
- the approved workgroup is selected;
- `gold_platform`, `common_silver`, and `materialized_platform` are visible;
- the Gold query has a query ID;
- the Common Silver query has a query ID;
- you know whether BI should use Gold, Tribe Silver, or
  `materialized_platform`;
- you sent the evidence block back to the platform owner.
