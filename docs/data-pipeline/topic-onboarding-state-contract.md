# Topic Onboarding State Contract

Topic onboarding state is evidence-derived. Operators can record observations,
but state must not advance just because a management route or connector update
returned successfully.

## Provider Mode

Management supports an explicit provider selector:

```text
TOPIC_ONBOARDING_STATE_PROVIDER=local-file | api-center
```

Current behavior:

| Provider | Status | Use |
| --- | --- | --- |
| `local-file` | Active fallback | Local operator evidence under `TOPIC_ONBOARDING_STATE_FILE` or `.local-state/topic-onboarding-states.json`. |
| `api-center` | Reserved | Durable API Center persistence. Management must fail clearly instead of silently writing local JSON when this is selected. |

`local-file` is acceptable for pilot and single-operator testing only. Shared
operator use needs the `api-center` provider before production onboarding.

## State Evidence Rules

| State | Required evidence |
| --- | --- |
| `Data classification ready` | Classification tier, data owner/steward, and approved reader group evidence are recorded. |
| `Policy ready` | Token policy and `external:kafka:write` scope are verified for the owner tribe. |
| `Topic provisioned` | Confluent topic describe succeeds for the exact physical topic. |
| `Sink included` | Connector config contains the topic and connector/task state is `RUNNING`. |
| `Publishing` | APICenter accepted a publish and Kafka metrics/logs confirm the physical topic. |
| `Raw observed` | S3 object exists under the exact physical topic prefix. |
| `Bronze cataloged` | Athena or Databricks Bronze query returns rows for the physical topic. |
| `Curated active` | Common Silver/Gold returns approved rows and the owner signs off. |

## Anti-Optimistic Update Rule

Management routes must not set later state inputs from write success alone.

Examples:

- S3 Sink include-topic success can record connector evidence, but cannot mark
  `s3SinkIncludesTopic=true` unless connector/task running evidence is present.
- Topic migration can record topic provision evidence from Confluent, but cannot
  mark `Sink included` unless the connector running check is recorded.
- Raw, Bronze, Silver, and Gold states require data-plane observations, not route
  responses.

## Required Observation Fields

Store each state observation with:

```text
physical_topic:
owner_tribe_id:
source_service_ids:
environment:
actor:
timestamp:
evidence_link:
state_inputs:
```

For data-plane states, include the concrete fields:

```text
latest_accepted_publish_at:
latest_kafka_observed_at:
latest_s3_object_key:
latest_s3_object_at:
latest_bronze_observed_at:
latest_common_silver_observed_at:
latest_gold_observed_at:
quality_error_count:
curated_signoff_at:
```

## Promotion Checklist

Before dashboard or BI exposure:

1. Confirm the state record provider is durable or explicitly approved as
   `local-file` pilot evidence.
2. Confirm `source_service_ids` contains every producing microservice.
3. Confirm the physical topic is in the Athena projection values file.
4. Confirm raw S3 evidence and Bronze query evidence point to the same physical
   topic.
5. Confirm result output uses governed Athena result prefixes, not raw S3 topic
   prefixes.
