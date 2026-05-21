# APICenter Platform Team AWS Access Guide

Date: 2026-05-21

You have been given AWS access for the APICenter platform data pipeline. This
access is for understanding, validating, and reviewing the APICenter analytics
flow across Athena, S3, Glue catalog metadata, Silver/Gold datasets, and BI
readiness.

Each team member has an individual AWS IAM user. Do not share accounts or
passwords.

## Login

AWS console URL:

```text
https://688717565427.signin.aws.amazon.com/console
```

Use your own UST email as the IAM username.

| Team member | IAM username |
| --- | --- |
| Charlize Marynette Elcano | `charlizemarynette.elcano.cics@ust.edu.ph` |
| Kharla Ven Mapue | `kharlaven.mapue.cics@ust.edu.ph` |
| Mikhaella Audrey Bugayong | `mikhaellaaudrey.bugayong.cics@ust.edu.ph` |
| Jamaica Valdez | `jamaica.valdez.cics@ust.edu.ph` |

Your temporary password will be provided separately. AWS will require you to set
a new password on first login.

## Your Access

All four team members have the same access through:

```text
group: apicenter-platform-team
policy: APICenterPlatformTeamMember
account: 688717565427
region: ap-southeast-2
```

This role lets you:

- open Athena;
- query APICenter platform validation, management, and tribe workgroups;
- inspect Glue catalog metadata for the APICenter pipeline;
- read raw S3 topic folders for validation;
- read Bronze, Common Silver, Tribe Silver, and Gold datasets through Athena;
- read and write Athena query results under APICenter result prefixes;
- inspect curated S3 outputs;
- validate BI/dashboard source datasets.

This role does not let you:

- create IAM users, groups, or policies;
- create or update Athena workgroups;
- create or update Glue tables/databases;
- change S3 bucket policies, lifecycle rules, or encryption;
- delete S3 objects;
- write to the raw S3 data lake;
- manage Confluent Cloud or the S3 Sink connector;
- use your account as a PowerBI/Looker service credential;
- share your account with another person.

## What APICenter Pipeline You Are Reviewing

Use this mental model:

```text
tribe backend
  -> APICenter SDK publish
  -> APICenter governance
  -> Confluent topic
  -> S3 raw topic folder
  -> Athena raw table
  -> Bronze parsed events
  -> Common Silver envelope
  -> Tribe Silver / Gold
  -> BI, dashboard, or governed Athena result
```

The platform team's job is to verify that this flow is understandable,
traceable, and governed. Raw S3 is for validation only. Dashboards and BI should
use Silver or Gold datasets.

## Workgroups You Can Use

Use environment-specific workgroups for new checks:

```text
api-center-platform-validation-test
api-center-platform-validation-prod
api-center-management-test
api-center-management-prod
api-center-tribe-<tribe_id>-test
api-center-tribe-<tribe_id>-prod
```

## First Things To Do

1. Log in with your IAM username.
2. Change your temporary password.
3. Open Amazon Athena.
4. Set the region to:

   ```text
   ap-southeast-2
   ```

5. Select this workgroup for initial validation:

   ```text
   api-center-platform-validation-prod
   ```

6. Run the first safe query below.

## First Safe Queries

Pipeline health:

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

Common Silver sample:

```sql
SELECT
  environment,
  tribe_id,
  source_service_id,
  event_type,
  schema_version,
  occurred_at,
  ingested_at
FROM common_silver.tribe_event_envelope
WHERE environment = 'prod'
  AND year = '2026'
  AND month = '05'
  AND day = '21'
LIMIT 100;
```

Raw validation must always be bounded by topic and date:

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

Replace `<tribe_id>` with the target tribe ID before running raw validation.

## Query Rules

- Always check that you are in the correct region: `ap-southeast-2`.
- Always select the right workgroup before running a query.
- Always filter by `environment`.
- Raw table checks must include topic and date filters.
- Prefer Gold for dashboard/BI validation.
- Use Common Silver when you need event-level details.
- Do not use raw S3 as a dashboard source.
- Do not run broad unbounded scans.

## Main Data Layers

| Layer | Purpose | Your use |
| --- | --- | --- |
| Raw S3 | Connector landing zone and replay/audit source | Validate arrival only |
| `api_center_raw.topic_records` | Athena raw table over exported topics | Bounded validation queries |
| Bronze | Parsed event views and quality checks | Check parsing and invalid records |
| Common Silver | Standard event envelope across tribes | Compare events consistently |
| Tribe Silver | Tribe-specific domain rows | Review tribe-owned semantics |
| Gold | Metrics and dashboard-ready outputs | BI and platform reporting validation |

## Important Boundaries

You can read raw data for validation, but raw data is not the normal consumer
source.

Use:

```text
Gold -> dashboards and BI
Tribe Silver -> tribe-specific analysis
Common Silver -> event-level validation
Raw/Bronze -> platform validation and troubleshooting
```

Do not:

```text
share credentials
create access keys
delete S3 objects
change Glue tables
change Athena workgroups
use raw S3 for BI
use your human account as a scheduled refresh account
```

## If You Need More Access

If a task requires creating/updating Athena workgroups, changing result bucket
controls, updating Glue catalog objects, or changing AWS infrastructure, ask for
temporary provisioning access.

Temporary provisioning access is separate from your normal role:

```text
APICenterPlatformProvisionerTemporary
```

It should only be used for an approved change and removed after the task.

## Local AWS CLI Use

Console access is enough for basic Athena checks. If you need CLI access, set up
your own named profile. Do not use another teammate's profile.

Example profile name:

```text
apic-<your-name>
```

Do not create long-lived access keys unless the platform owner explicitly asks
for it. Human team members should normally use console access only.

## Reference Docs

Start with these repo docs:

```text
api-center/docs/data-pipeline/README.md
api-center/docs/data-pipeline/apicenter-total-data-pipeline-architecture.md
api-center/docs/data-pipeline/athena-results-runbook.md
api-center/docs/data-pipeline/retention-access-cost-controls.md
api-center/docs/data-pipeline/metric-dictionary.md
api-center/docs/data-pipeline/platform-team-north-star-bi-plan.md
api-center/docs/data-pipeline/tribe-curated-data-product-runbook.md
api-center/docs/data-pipeline/silver-gold-ownership-runbook.md
```

## Support

If login fails, you cannot change your password, or Athena says access is denied,
send the exact error message and the workgroup/query you were using to the
platform owner.
