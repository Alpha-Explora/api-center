# Pipeline Exception Request Template

Use this only when a tribe needs a separate full pipeline or nonstandard export
destination. The default remains APICenter-governed publishing into the shared
Confluent-to-S3 pipeline.

## Request

```text
requesting_tribe:
request_owner:
business_reason:
technical_reason:
target_destination_architecture:
whether_APICenter_remains_publish_path:
security_review_owner:
data_classification:
access_model:
retention_policy:
cost_owner:
incident_owner:
audit_obligations:
expiry_or_review_date:
rollback_or_rejoin_path:
approvers:
approval_date:
```

## Required Decision

```text
exception_status: pending | approved | rejected | expired
accepted_risk:
replacement_control:
next_review_date:
```

If a waiver allows anything other than APICenter-governed publishing, the waiver
must explicitly name the risk accepted and the control that replaces APICenter
governance.

Exception approvals must expire or be reviewed on a defined date.
