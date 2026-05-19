# Tribe Data Governance Checklist

Complete this checklist before moving a tribe topic to production reporting.

## RACI

| Gate | Responsible | Accountable | Consulted | Informed | Evidence |
| --- | --- | --- | --- | --- | --- |
| Data classification ready | Tribe event owner | Platform data steward | Security/privacy owner | BI owner | Event catalog, PII list, retention tier |
| Policy ready | Platform operator | Platform API owner | Tribe tech lead | Tribe product owner | Manifest diff, scopes, topic resolver output, quota |
| Topic provisioned | Platform operator | Platform data-platform owner | Confluent admin | Tribe tech lead | Confluent topic name, partitions, retention |
| Sink included | Platform operator | Platform data-platform owner | Security owner | Tribe tech lead | Connector config snapshot, ACL check |
| Raw observed | Platform data engineer | Platform data-platform owner | Tribe tech lead | BI owner | Kafka count, S3 path, connector flush evidence |
| Bronze cataloged | Platform data engineer | Platform data-platform owner | Tribe event owner | BI owner | Athena/Bronze query output |
| Production Metrics Approval | Tribe domain owner | Tribe product owner and platform BI owner | Platform data steward | Platform operator | Metric dictionary, validation query, dashboard sign-off |

## Data Classification

```text
owner_tribe_id:
source_service_ids:
event_owner:
data_steward:
event_purpose:
classification_tier:
pii_fields:
redaction_or_tokenization_method:
allowed_consumers:
approved_reader_groups:
retention_tier:
expected_daily_events:
max_event_size_bytes:
publish_quota:
review_date:
```

## Policy Gate

```text
registered_service_ids:
owner_tribe_id:
logical_topic:
physical_topic:
token_scope_external_kafka_write:
topic_resolver_output:
quota:
classification_approval_link:
```

## Production Metrics Approval

```text
metric_name:
metric_definition:
source_tables:
validation_query:
validation_result:
dashboard_url:
approved_reader_groups:
tribe_domain_owner:
platform_bi_owner:
signoff_date:
next_review_date:
```

Production Metrics Approval is required before any Gold metric is labeled as
production reporting.
