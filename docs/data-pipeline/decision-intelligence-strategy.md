# Decision Intelligence Strategy

APICenter decision intelligence starts with deterministic rules over governed
Gold data. It does not score raw S3 and it does not mutate tribe state.

## Contract

```text
signal_id
environment
tribe_id
source_service_id
signal_type
severity
metric_name
observed_value
expected_value
recommendation
evidence_query_id
evidence_window_start
evidence_window_end
created_at
status
```

## Deterministic Signals

Phase 11 v1 uses deterministic threshold rules only. The signal names keep the
future operational language, but the first deployed view does not calculate
rolling baselines or historical rates yet.

| Signal | Source | Rule |
| --- | --- | --- |
| `pipeline_stale` | `gold_platform.pipeline_health_daily` | Missing latest ingested timestamp. |
| `bronze_quality_regression` | `gold_platform.event_quality_daily` | `quality_error_count > 0`. |
| `athena_cost_spike` | `gold_platform.athena_query_cost_daily` | `max_bytes_scanned > 1073741824`. |
| `gateway_denial_spike` | `gold_platform.gateway_decision_daily` | `denied_count > 0`. |
| `shared_service_error_spike` | `gold_platform.shared_service_usage_daily` | `failure_count > 0`. |

Next maturity step after 30 days of stable Gold history:

- Replace count-only quality and provider checks with rates against total volume.
- Compare gateway denials and shared-service failures against rolling baselines.
- Use the freshness window from the approved metric dictionary instead of the
  current missing-timestamp stale rule.

## API

```text
GET /api/v1/data-pipeline/decision-signals?environment=test
GET /api/v1/data-pipeline/decision-signals?environment=prod
```

The API reads `gold_platform.decision_signals_daily` through the environment
platform validation workgroup. Optional `year`, `month`, and `day` query
parameters pin the evidence partition.

Catalog and query files:

```text
infra/aws-data-pipeline/catalog/gold-platform-decision-signals.sql
infra/aws-data-pipeline/queries/decision-signals-daily.sql
```

## Operating Rules

- Treat every signal as a recommendation for operator review.
- Use feedback actions to acknowledge, mark false positive, request tribe fix,
  or block promotion.
- Do not use ML until at least 30 days of stable approved Gold data exists for
  the target metric.
- Keep test and prod scoring separated by `environment`, workgroup, and result
  prefix.
