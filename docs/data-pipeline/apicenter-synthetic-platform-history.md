# APICenter Synthetic Platform History

Use this in test when the management dashboard needs APICenter platform metrics that look like a 30-day history. The publisher only writes `test.api-center.*` topics; it does not write `test.tribe.*` topics.

## Topics

- `test.api-center.gateway.request`
- `test.api-center.gateway.response`
- `test.api-center.shared.payment.events`
- `test.api-center.pipeline.athena-query-execution`

## Dry Run

```powershell
node scripts/data-pipeline/publish-apicenter-platform-history.js --days 30 --total 4000 --run-id apicenter-platform-history-YYYYMMDD-test-flush
```

## Publish

```powershell
node scripts/data-pipeline/publish-apicenter-platform-history.js --days 30 --total 4000 --run-id apicenter-platform-history-YYYYMMDD-test-flush --execute
```

`--total 4000` gives each of the four APICenter topics 1000 records. That size matches the current S3 sink flush threshold used in test, so each topic has enough volume to produce files for Athena-backed dashboard reads.

## Dashboard Read

After the sink and Athena jobs catch up, use the management dashboard data-pipeline date picker on the final generated date and keep the governance window at `30 days`. The management proxy forwards `windowDays=30` to API Center for:

- quality
- shared-service usage
- gateway decisions
- Athena cost
- decision signals

Traceability health remains a single partition read.

## Verification

```powershell
node scripts/data-pipeline/publish-apicenter-platform-history.test.js
npm test -- --runInBand src/data-pipeline/pipeline-governance.service.spec.ts src/data-pipeline/decision-signals.service.spec.ts
```

The dashboard should show the governance and cost panels across the 30-day event window once the downstream data plane has materialized the seeded events.
