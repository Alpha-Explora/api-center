# Pipeline Feedback Action Contract

APICenter feedback actions are operator records tied to curated pipeline
evidence. They are used to record review, rerun, block, and fix-request
decisions without exposing raw S3 payloads to management.

## Actions

| Action | Purpose | Required fields | Status |
| --- | --- | --- | --- |
| `validation.rerun.requested` | Ask an operator or job to rerun bounded validation. | `environment`, `targetType`, `targetId`, `reason` | `pending` |
| `evidence.reviewed` | Mark pipeline evidence reviewed. | `environment`, `targetType`, `targetId`, `reason` | `reviewed` |
| `decision.false_positive.marked` | Mark a decision signal as false positive after operator review. | `environment`, `targetType=signal`, `targetId`, `evidenceLink`, `reason` | `closed` |
| `onboarding.state.opened` | Record that an operator opened the onboarding state record. | `environment`, `targetType`, `targetId`, `reason` | `reviewed` |
| `promotion.blocked` | Block promotion because evidence is unsafe. | `environment`, `targetType`, `targetId`, `reason` | `blocking` |
| `schema.fix.requested` | Request a tribe schema or payload fix. | `environment`, `targetType`, `targetId`, `ownerTribeId`, `reason` | `pending` |

## Target Types

```text
topic
tribe
service
event
signal
query
```

## Required Write Metadata

Every feedback write records:

```text
id
action
environment
targetType
targetId
ownerTribeId, when available
evidenceLink, when available
reason
actorId
actorRole
correlationId, when available
createdAt
status
```

Raw event payloads and AWS credentials must never be stored in feedback records.
Use curated evidence links, query IDs, or topic/service identifiers instead.

## API Contract

Create:

```text
POST /api/v1/data-pipeline/feedback-actions
```

Request:

```json
{
  "action": "promotion.blocked",
  "environment": "prod",
  "targetType": "topic",
  "targetId": "prod.tribe.logistics.events",
  "ownerTribeId": "logistics",
  "reason": "Quality error count exceeded threshold"
}
```

Response:

```json
{
  "success": true,
  "data": {
    "id": "5206456c-fa75-4730-b625-c843a07ad216",
    "action": "promotion.blocked",
    "environment": "prod",
    "targetType": "topic",
    "targetId": "prod.tribe.logistics.events",
    "ownerTribeId": "logistics",
    "reason": "Quality error count exceeded threshold",
    "actorId": "platform-admin",
    "actorRole": "platform-admin",
    "correlationId": "corr_phase9_reviewfix_smoke",
    "createdAt": "2026-05-21T00:00:00.000Z",
    "status": "blocking"
  }
}
```

List:

```text
GET /api/v1/data-pipeline/feedback-actions?environment=test&targetId=test.api-center.pipeline.athena-query-execution
```

## Durable Persistence

Feedback records are persisted in:

```text
api_center_ops.pipeline_feedback_actions
```

Migrations:

```text
prisma/migrations/20260521172000_add_pipeline_feedback_actions/migration.sql
prisma/migrations/20260521180500_add_pipeline_feedback_correlation_id/migration.sql
prisma/migrations/20260521235900_extend_pipeline_feedback_for_decision_signals/migration.sql
prisma/migrations/20260522003000_constrain_false_positive_feedback_target/migration.sql
supabase/migrations/20260521235900_extend_pipeline_feedback_for_decision_signals.sql
supabase/migrations/20260522003000_constrain_false_positive_feedback_target.sql
```

The API service uses this Postgres table when `DATABASE_ENABLED=true`. Local
or explicitly non-database mode keeps the same response shape with memory
storage, but deployed test/prod feedback evidence must come from Postgres. If
database mode is enabled and the Prisma client is not available, the service
fails closed instead of writing transient memory records.

Durability evidence from the Phase 9 blocker-fix slice:

```text
deployed_image: asia-southeast1-docker.pkg.dev/api-center-496422/api-center/api-center:data-pipeline-feedback-durable-reviewfix-d1eb7e6-20260521175948
cloud_build_id: 8451ea31-4885-4a60-b99c-a66b3b3fea34
smoke_record_id: 5206456c-fa75-4730-b625-c843a07ad216
api_smoke: POST 201 reviewed; GET 200 found=true; correlationId=corr_phase9_reviewfix_smoke
postgres_smoke: rows=1, environment=test, status=reviewed, correlationId=corr_phase9_reviewfix_smoke, targetId=test.api-center.pipeline.athena-query-execution
```

Decision-signal review-fix evidence:

```text
constraint_migration: supabase/migrations/20260521235900_extend_pipeline_feedback_for_decision_signals.sql applied
constraint_smoke: rollback insert accepted action=decision.false_positive.marked, target_type=signal, status=closed
deployed_image: asia-southeast1-docker.pkg.dev/api-center-496422/api-center/api-center:data-pipeline-decision-reviewfix-d1eb7e6-20260522001734
cloud_build_id: 9884dad4-96d9-4cd1-b669-43a780daf797
api_smoke: POST/GET feedback-actions succeeded for action=decision.false_positive.marked, targetType=signal, status=closed
```

Signal-only false-positive enforcement evidence:

```text
constraint_migration: supabase/migrations/20260522003000_constrain_false_positive_feedback_target.sql applied
constraint_smoke: rollback insert accepted action=decision.false_positive.marked with target_type=signal and rejected the same action with target_type=event
deployed_image: asia-southeast1-docker.pkg.dev/api-center-496422/api-center/api-center:data-pipeline-decision-reviewfix2-d1eb7e6-20260522003353
cloud_build_id: 9a6b5a94-ac35-4efc-aff3-d2a0a7a3cc84
api_smoke: valid signal false-positive POST/GET succeeded with status=closed; invalid event false-positive POST rejected with HTTP 400
```
