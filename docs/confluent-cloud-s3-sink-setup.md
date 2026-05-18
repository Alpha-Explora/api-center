# API Center Confluent Cloud to AWS S3 Setup

This document records the current API Center data pipeline setup:

```text
GCP API Gateway / API Center shared services
  -> Confluent Cloud Kafka topics
  -> Confluent Amazon S3 Sink Connector
  -> AWS S3 raw data lake
```

## Architecture Roles

| Component | Responsibility |
|---|---|
| GCP API Gateway | Public/front-door gateway for API traffic |
| API Center / shared services | Auth, routing, service registry, policy checks, event publishing |
| Confluent Cloud | Managed Kafka cluster, topics, and connector runtime |
| Amazon S3 Sink Connector | Reads Kafka topics and writes records to AWS S3 |
| AWS S3 | Final durable source of truth for raw event/data records |

Confluent Cloud is not in the synchronous proxy path for tribe-to-tribe calls. API Center still handles live service routing through the registry and proxy layer. Confluent is the asynchronous event/data backbone.

## Ownership Alignment

The long-running ownership model is documented in
`docs/superpowers/plans/2026-05-19-tribe-data-pipeline-ownership.md`.

Use that plan as the source of truth for tribes that are not in S3 yet:

- platform owns Confluent, S3 Sink, raw S3, Glue/Athena, Databricks infrastructure, Bronze, common Silver, governance, and access control
- tribes own event semantics, business transformations, tribe-specific Silver/Gold models, and domain dashboard metrics
- ordinary tribes publish through APICenter and the SDK; they do not receive Confluent or AWS S3 writer credentials
- separate tribe-owned full pipelines are exception cases, not the default operating model

## Current Active Target

Use this Confluent target for API Center producer credentials and S3 sink validation:

```text
Environment: api-ingestion
Cluster display name: api-center-gcp-dev-main
Cluster ID: lkc-850n9q
Cloud/provider: AWS
Region: ap-southeast-2
Kafka bootstrap endpoint: pkc-ldvj1.ap-southeast-2.aws.confluent.cloud:9092
S3 sink connector: api-center-s3-sink
S3 bucket: api-center-raw-data
Connector state captured during setup: RUNNING
```

The earlier `api-center-gcp-dev` / `lkc-vgdkm5` cluster in `ap-southeast-3` is historical. Do not point new API Center deployments at it.

## Test And Live Topic Split

The current low-cost test/live split uses one Confluent cluster and one S3 sink
connector, but separates records by Kafka topic prefix:

```text
test API Center -> test.* Kafka topics -> api-center-s3-sink -> s3://api-center-raw-data/topics/test.*
prod API Center -> prod.* Kafka topics -> api-center-s3-sink -> s3://api-center-raw-data/topics/prod.*
```

API Center reads `KAFKA_TOPIC_PREFIX` at runtime:

```text
KAFKA_TOPIC_PREFIX=test.
KAFKA_TOPIC_PREFIX=prod.
```

The app validates events against the base schema topic name, then publishes to
the physical prefixed topic:

```text
base schema topic: api-center.shared.payment.events
test physical topic: test.api-center.shared.payment.events
prod physical topic: prod.api-center.shared.payment.events
```

Implemented prefixed topics include:

```text
test.api-center.*
test.api-center.shared.*
test.tribe.smoke-tribe.events
test.tribe.servease.events
prod.api-center.*
prod.api-center.shared.*
prod.tribe.servease.events
```

New tribe topics should follow the same pattern:

```text
test.tribe.<tribeId>.events
prod.tribe.<tribeId>.events
```

Microservices do not get separate event topics by default. A service registered
with `serviceId=logistics-orders` and `ownerTribeId=logistics` publishes to the
owning tribe topic `tribe.logistics.events` and carries `sourceServiceId` for
microservice attribution.

Only create separate Confluent clusters and separate S3 buckets when production
traffic, compliance, or blast-radius requirements justify the extra fixed cost.

## User Setup After Repo Fix

1. Create or choose a dedicated API Center producer service account/API key scoped to `lkc-850n9q`.
2. Grant producer permissions to `api-center.*` and required `tribe.*` topics.
3. Store `KAFKA_BROKERS`, `KAFKA_SASL_USERNAME`, and `KAFKA_SASL_PASSWORD` in the deployment secret store, not in Git.
4. Redeploy API Center with Confluent SASL/SSL enabled.
5. Send a real API Center event and verify it appears in Confluent.
6. Verify the S3 sink exports records to `s3://api-center-raw-data/topics/...`.
7. Retire the old `ap-southeast-3` cluster only after API Center and S3 export validation pass.

## Local Management Topic Provisioning

New tribe event topics no longer need to be created manually in the Confluent UI
when the local `apicenter-management` console is configured with Confluent
management credentials.

Add these to `apicenter-management/.env.local`. Do not use `NEXT_PUBLIC_*` for
any of these values.

```text
CONFLUENT_ENVIRONMENT_ID=<env-id>
CONFLUENT_KAFKA_CLUSTER_ID=lkc-850n9q
CONFLUENT_KAFKA_REST_ENDPOINT=https://pkc-ldvj1.ap-southeast-2.aws.confluent.cloud:443
CONFLUENT_KAFKA_API_KEY=<cluster-scoped Kafka API key>
CONFLUENT_KAFKA_API_SECRET=<cluster-scoped Kafka API secret>
CONFLUENT_CLOUD_API_KEY=<cloud management API key>
CONFLUENT_CLOUD_API_SECRET=<cloud management API secret>
CONFLUENT_S3_CONNECTOR_NAME=api-center-s3-sink
CONFLUENT_DEFAULT_RETENTION_MS=604800000
```

Credential meanings:

```text
CONFLUENT_KAFKA_API_KEY / SECRET
  Kafka cluster API key used against the Kafka REST API to check/create topics.

CONFLUENT_CLOUD_API_KEY / SECRET
  Cloud management API key used against the Connect API to read/update the S3
  Sink connector config.
```

Operator flow:

1. Open `http://localhost:3000/tribes/<serviceId>`.
2. In **Confluent data pipeline**, click **Provision topic**. If the service has
   `ownerTribeId`, the console provisions `tribe.<ownerTribeId>.events`.
3. Click **Add to S3 sink**.
4. Publish through API Center's governed Kafka wrapper.
5. Confirm the topic receives messages and the S3 sink exports them under the
   configured topic prefix.

If the console detects a legacy service-scoped topic such as
`tribe.<serviceId>.events`, use **Upgrade legacy topic**. The action creates or
verifies `tribe.<ownerTribeId>.events`, adds the new topic to the S3 Sink, and
keeps the old topic until all producers have moved to the owner-tribe topic.

Manual fallback:

1. In Confluent Cloud, open cluster `lkc-850n9q`.
2. Create topic `tribe.<ownerTribeId>.events` for tribe-owned microservices, or
   `tribe.<serviceId>.events` when the service itself is the tribe principal.
3. Use 1 partition and `retention.ms=604800000`.
4. Open connector `api-center-s3-sink`.
5. Add that tribe event topic to the connector topic list.
6. Restart the connector only if Confluent requires it after config update.

Tribes still do not receive Confluent credentials. They publish through API
Center and the SDK; API Center is the runtime Confluent producer.

## Completed Setup

### 1. Historical Initial Confluent Environment and Cluster

This was the first cluster created during setup and is now superseded by the active target above.

Created Confluent Cloud environment:

```text
api-ingestion
```

Created Confluent Cloud cluster:

```text
api-center-gcp-dev
```

Cluster details captured during setup:

```text
Cluster type: Basic
Provider: AWS
Region: ap-southeast-3
Cluster ID: lkc-vgdkm5
```

### 2. Topics Created

Created the original 22 Kafka topics with 1 partition each. The current
shared-service export design adds 6 more platform topics, for a target S3 sink
coverage set of 28 topics plus any newly registered `tribe.<id>.events` topics.

Core API Center topics:

```text
api-center.gateway.request
api-center.gateway.response
api-center.gateway.error
api-center.external.request
api-center.audit.log
api-center.shared.sms.events
api-center.shared.email.events
api-center.shared.payment.events
api-center.shared.otp.events
api-center.shared.geo.events
api-center.shared.gauth.events
api-center.auth.token-issued
api-center.auth.token-refreshed
api-center.auth.token-revoked
api-center.registry.service-registered
api-center.registry.service-deregistered
api-center.registry.service-deprecated
api-center.registry.service-retired
api-center.registry.service-version-changed
api-center.registry.service-health-changed
api-center.tribe.request
api-center.tribe.response
```

Tribe event topics:

```text
tribe.campusone.events
tribe.trinithrive.events
tribe.smurfvillage.events
tribe.pakiapps.events
tribe.shoteam.events
tribe.greenovate.events
```

Shared-service export topics:

```text
api-center.shared.sms.events
api-center.shared.email.events
api-center.shared.payment.events
api-center.shared.otp.events
api-center.shared.geo.events
api-center.shared.gauth.events
```

These shared-service topics contain sanitized platform export events emitted by
API Center after `/api/v1/shared/:serviceId/*` calls. They are not tribe-owned
topics and should not include raw OTP codes, OAuth tokens, API keys, email
bodies, SMS bodies, raw email addresses, raw phone numbers, or provider secrets.

Recommended topic settings:

```text
Partitions: 1
Cleanup policy: Delete
Retention size: Infinite
Infinite retention: Off
Maximum message size: 2097164 bytes
```

Retention guidance:

```text
Most topics: 1 week
api-center.audit.log: 1 month if available
api-center.registry.*: 1 month if available
```

The topic list and settings are also tracked in:

```text
docs/confluent-topic-settings.csv
```

### 3. AWS IAM Role Started

Created/started AWS IAM role for Confluent S3 Sink:

```text
ConfluentS3SinkRole
```

This is the role Confluent Cloud will assume to write Kafka topic data into the target S3 bucket.

This role is separate from the earlier DataSync role. DataSync is not part of the final architecture.

## Current Step: Provider Integration Mapping

On the Confluent provider integration screen:

```text
AWS ARN: arn:aws:iam::<account-id>:role/ConfluentS3SinkRole
Provider integration name: api-center-s3-sink-aws
```

Use this provider integration name:

```text
api-center-s3-sink-aws
```

Then click:

```text
Continue
```

Confluent will generate or show the final trust relationship values. After that, update the AWS role trust policy.

Generated trust relationship values captured during setup:

```text
Confluent trust principal: arn:aws:iam::851725421142:role/cspi-13ok3
External ID: 4eeb746e-05f4-42fe-b8c4-ac77d524cdf7
```

Next action:

```text
AWS IAM -> Roles -> ConfluentS3SinkRole -> Trust relationships -> Edit trust policy
```

Paste the Confluent-generated trust policy, save it, then return to Confluent and click `Continue`.

## AWS Permission Policy for S3

Attach a bucket-scoped policy to `ConfluentS3SinkRole`.

Replace `YOUR_BUCKET_NAME` with the real S3 bucket name:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "BucketAccessForConfluentS3Sink",
      "Effect": "Allow",
      "Action": [
        "s3:GetBucketLocation",
        "s3:ListBucket",
        "s3:ListBucketMultipartUploads"
      ],
      "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME"
    },
    {
      "Sid": "ObjectWriteAccessForConfluentS3Sink",
      "Effect": "Allow",
      "Action": [
        "s3:AbortMultipartUpload",
        "s3:PutObject",
        "s3:PutObjectTagging",
        "s3:GetObject",
        "s3:ListMultipartUploadParts"
      ],
      "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/*"
    }
  ]
}
```

If the bucket uses SSE-S3 encryption, no KMS policy is needed. If the bucket uses SSE-KMS, add KMS permissions for the key.

## AWS Trust Policy Flow

During initial role creation, Confluent may ask for a temporary deny trust policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Deny",
      "Principal": {
        "AWS": "*"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

After the role is mapped in Confluent, Confluent provides the final principal and external ID. Replace the temporary trust policy with Confluent's final trust policy. It should have this shape:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "<CONFLUENT_IAM_ROLE_ARN>"
      },
      "Action": "sts:AssumeRole",
      "Condition": {
        "StringEquals": {
          "sts:ExternalId": "<CONFLUENT_EXTERNAL_ID>"
        }
      }
    }
  ]
}
```

Use the exact values shown by Confluent. Do not keep placeholder values.

## S3 Sink Connector Settings

After the provider integration is active, create the Amazon S3 Sink connector.

Recommended settings:

```text
Connector: Amazon S3 Sink
Topics: all API Center, shared-service export, and tribe event topics
Kafka credentials: Service account
Service account name: api-center-s3-sink-connector
AWS S3 region: same region as the S3 bucket
Store URL: blank
Authentication method: IAM Roles
Provider integration: api-center-s3-sink-aws
S3 bucket name: target AWS bucket name
Input format: JSON
Output format: JSON
Tasks: 1
Time interval: HOURLY
```

Connector configuration screen values:

```text
Input Kafka record value format: JSON
Output message format: JSON
Partitioner Class: TimeBasedPartitioner
Locale: en
Flush size: 1000
Timezone: UTC
Path format: 'year'=YYYY/'month'=MM/'day'=dd/'hour'=HH
Time interval: HOURLY
```

Keep `Output message format` as JSON for the initial setup because API Center publishes JSON records today. Move to Parquet later only after schemas are stable and analytics tooling is ready.

Connector sizing screen values:

```text
Topics selected: 28 plus any newly registered tribe event topics
Partitions selected from topics: 28 plus any newly registered tribe event topics
Tasks: 1
Estimated task cost shown during setup: $0.043/hr + $0.03125/GB usage
Throughput shown during setup: up to 5 MBps
Max partitions shown during setup: 100
```

One task is sufficient for the current setup because the initial topic set is
well below 100 partitions, and Confluent shows one task can handle up to 100
partitions for this connector. Revisit task count only when connector lag or
partition count requires it.

Connector review screen captured values:

```text
Connector class: S3_SINK
Connector name shown: S3_SINKConnector_0
Data format: JSON
Key format: BYTES
Output message format: JSON
Time interval: HOURLY
Flush size: 1000
Number of tasks: 1
Kafka auth mode: SERVICE_ACCOUNT
Kafka service account id: sa-8wZQrq
Authentication method: IAM Roles
Provider integration id: cspi-13ok3
S3 region: ap-southeast-2
S3 bucket name: api-center-raw-data
Partitioner class: TimeBasedPartitioner
Topics directory: topics
Path format: 'year'=YYYY/'month'=MM/'day'=dd/'hour'=HH
Locale: en
Timezone: UTC
Pricing shown: $0.043/hr + $0.03125/GB usage
```

Recommended connector name before launch:

```text
api-center-s3-sink
```

The generated name `S3_SINKConnector_0` works, but `api-center-s3-sink` is clearer for operations and documentation.

Important region note:

```text
The S3 bucket should be in the same AWS region required by the connector/cluster.
```

During setup, verify the Confluent cluster region and the AWS S3 bucket region match the connector requirements.

## API Center Producer Configuration

Point API Center to Confluent Cloud using KafkaJS-compatible settings:

```env
KAFKA_BROKERS=<confluent-bootstrap-server>:9092
KAFKA_SSL_ENABLED=true
KAFKA_SSL_REJECT_UNAUTHORIZED=true
KAFKA_SASL_MECHANISM=plain
KAFKA_SASL_USERNAME=<confluent-api-key>
KAFKA_SASL_PASSWORD=<confluent-api-secret>
KAFKA_CLIENT_ID=api-center
KAFKA_GROUP_ID=api-center-group
```

This API key is for API Center producing events. It is separate from the connector service account key used by the S3 Sink connector.

## Verification Checklist

After connector launch:

```text
1. Provider integration status is active/ready.
2. S3 Sink connector status is running.
3. API Center can connect to Confluent Cloud.
4. A test request causes API Center to publish Kafka events.
5. Confluent topics show produced messages.
6. S3 bucket receives exported objects from the connector.
7. Objects are grouped by topic/prefix as expected.
```

## Troubleshooting Notes

If the connector says no provider integrations are available:

```text
1. Finish creating the AWS Provider Integration.
2. Refresh the connector setup page.
3. Confirm the integration exists in the same Confluent environment as the cluster.
4. Confirm your Confluent user has permission to use the integration.
```

If AWS role validation fails:

```text
1. Confirm the AWS role ARN is correct.
2. Confirm the final trust policy uses Confluent's exact principal and external ID.
3. Confirm the S3 permission policy is attached to the role.
4. Confirm the bucket name and region match the connector configuration.
```

## Connector Failure Log

### Failed to build credentials provider

Observed connector status after launch:

```text
Status: Failed
Messages processed: 0
Error field: s3.bucket.name
Error: Validation failed: Failed to build credentials provider
```

Meaning:

```text
The connector failed before processing messages. This points to AWS credential/provider-integration setup, not Kafka topic data.
```

Checks to perform:

```text
1. Confirm AWS Provider Integration is active/ready in Confluent.
2. Confirm the connector uses Authentication method = IAM Roles.
3. Confirm the selected Provider Integration is api-center-s3-sink-aws / cspi-13ok3.
4. Confirm AWS IAM role ConfluentS3SinkRole trust policy was updated with the Confluent-generated trust policy.
5. Confirm the trust policy Principal is arn:aws:iam::851725421142:role/cspi-13ok3.
6. Confirm the trust policy External ID is 4eeb746e-05f4-42fe-b8c4-ac77d524cdf7.
7. Confirm the S3 bucket name has no leading/trailing spaces.
8. Confirm the S3 bucket region matches the connector s3.region value.
9. Confirm the S3 permission policy is attached to ConfluentS3SinkRole.
```

Repeated failure observed after renaming connector to:

```text
api-center-s3-sink
```

Error remains:

```text
s3.bucket.name: Validation failed: Failed to build credentials provider
Messages processed: 0
```

Next troubleshooting order:

```text
1. Open connector Settings and verify provider.integration.id is present and equals cspi-13ok3.
2. Open Confluent Provider integrations and confirm cspi-13ok3 is Active/Ready.
3. In AWS IAM, confirm ConfluentS3SinkRole trust policy contains both sts:AssumeRole with ExternalId and sts:TagSession for arn:aws:iam::851725421142:role/cspi-13ok3.
4. In AWS IAM, confirm ConfluentS3SinkRole has the S3 bucket permission policy attached.
5. In Confluent connector Settings, confirm s3.bucket.name is exactly api-center-raw-data with no trailing space.
6. Confirm S3 bucket region and connector s3.region match. The connector was configured as ap-southeast-2.
7. Open connector Logs and capture the first stack/error line if the status remains Failed.
```

Root cause confirmed in AWS IAM:

```text
Role: ConfluentS3SinkRole
Trust policy: present and correct
Permissions policies: 0
```

Fix:

```text
AWS IAM -> Roles -> ConfluentS3SinkRole -> Permissions -> Add permissions -> Create inline policy
```

Attach the bucket-scoped S3 policy for:

```text
arn:aws:s3:::api-center-raw-data
arn:aws:s3:::api-center-raw-data/*
```

After saving the policy, restart the Confluent connector.

If the connector still fails after S3 permissions were added:

```text
1. Confirm the inline S3 policy is visible under ConfluentS3SinkRole -> Permissions.
2. Confirm Confluent Provider Integration api-center-s3-sink-aws / cspi-13ok3 is Active/Ready, not just created.
3. Confirm the connector Settings still show authentication.method = IAM Roles and provider.integration.id = cspi-13ok3.
4. Confirm the S3 bucket name in connector Settings is exactly api-center-raw-data with no trailing space.
5. Confirm the Confluent cluster region and S3 bucket region meet the S3 Sink connector requirement.
```

Historical region facts from the first, now-superseded `ap-southeast-3` setup:

```text
Confluent cluster region captured earlier: ap-southeast-3
S3 bucket region confirmed in AWS: ap-southeast-2
```

At that time, the possible fixes were:

```text
Option A: Create a new S3 bucket in ap-southeast-3 and update the connector to that bucket/region.
Option B: Recreate the Confluent cluster in ap-southeast-2 and recreate the topics/connector there.
```

Option B was chosen and completed. The active cluster is now `lkc-850n9q` in `ap-southeast-2`; do not follow Option A for new setup.

User note:

```text
Region mismatch is not expected to be the root cause.
```

Updated troubleshooting focus:

```text
Prioritize credentials/provider-integration checks before changing regions:
1. Confirm the connector Settings JSON contains provider.integration.id = cspi-13ok3.
2. Confirm the provider integration resource is for Amazon S3 Sink, not another connector type.
3. Confirm ConfluentS3SinkRole has S3 permissions attached and not only the trust policy.
4. Confirm no stale connector configuration still references Access Keys instead of IAM Roles.
5. Use the connector Logs tab to capture the concrete credential-provider failure.
```

## Tooling Note

The user asked whether Confluent MCP could be used to fix the connector directly.

Confluent MCP installation status:

```text
Registered in Codex user config as mcp_servers.confluent.
Command: npx -y @confluentinc/mcp-confluent -e C:\Codes\api-center\.codex\confluent-mcp.env
Package help command verified successfully with npx.
```

Created env template:

```text
C:\Codes\api-center\.codex\confluent-mcp.env.example
```

Next required local step:

```text
Copy .codex\confluent-mcp.env.example to .codex\confluent-mcp.env and fill in Confluent credentials.
Restart Codex so the newly registered MCP server is loaded.
```

Do not commit the filled env file or paste API secrets into chat.

If a Confluent MCP or authenticated Confluent CLI/API workflow becomes available later, the useful operations would be:

```text
1. Read connector config for api-center-s3-sink.
2. Confirm authentication.method and provider.integration.id.
3. Confirm provider integration resource mapping.
4. Patch connector config if stale or wrong.
5. Restart connector.
6. Fetch connector/task errors directly.
```

Do not paste Confluent API secrets into chat. Use local environment variables, MCP credentials, or the Confluent UI/CLI credential store.

## Confluent API Diagnosis

After adding `C:\Codes\api-center\.codex\confluent-mcp.env`, Codex queried the Confluent Cloud APIs directly.

Connector list:

```text
api-center-s3-sink
```

Connector status:

```text
state: FAILED
validation error: s3.bucket.name: Validation failed: Failed to build credentials provider
messages processed: 0
```

Provider integration check:

```text
provider integration id: cspi-13ok3
display name: api-center-s3-sink-aws
customer IAM role ARN: arn:aws:iam::688717565427:role/ConfluentS3SinkRole
Confluent IAM role ARN: arn:aws:iam::851725421142:role/cspi-13ok3
external ID: 4eeb746e-05f4-42fe-b8c4-ac77d524cdf7
usage: connector=api-center-s3-sink
```

Connector config check:

```text
authentication.method: IAM Roles
provider.integration.id: cspi-13ok3
s3.bucket.name: api-center-raw-data
s3.bucket.name whitespace check: clean, exact match
s3.region: ap-southeast-2
kafka.region: ap-southeast-3
kafka.endpoint: pkc-oz2po.ap-southeast-3.aws.confluent.cloud:9092
```

Historical diagnosis before the `ap-southeast-2` replacement cluster was created:

```text
The Confluent provider integration and connector IAM settings are present.
The S3 bucket name is correct and has no trailing whitespace.
The remaining confirmed mismatch is region: Confluent cluster ap-southeast-3 vs S3 bucket ap-southeast-2.
```

Confluent documentation states that the fully managed Amazon S3 Sink connector is designed for resources in the same cloud provider and region as the Confluent cluster, and cross-region/cross-cloud use requires Confluent Support enablement.

Historical recommendation at that point, not the current active path:

```text
Create a new S3 bucket in ap-southeast-3, update ConfluentS3SinkRole permissions for that bucket, then update/recreate the connector with s3.region=ap-southeast-3 and the new bucket name.
```

Alternative fix that became the active path:

```text
Keep the existing S3 bucket in Sydney ap-southeast-2 and create a new Confluent Cloud cluster in AWS ap-southeast-2 instead.
```

Implications:

```text
1. Existing S3 bucket api-center-raw-data can stay unchanged.
2. Existing AWS IAM role ConfluentS3SinkRole and S3 permissions can remain scoped to api-center-raw-data.
3. Recreate the API Center, shared-service export, and tribe Kafka topics in
   the new Sydney Confluent cluster.
4. Create a new S3 Sink connector in the new Sydney cluster.
5. Point API Center env vars to the new Sydney cluster bootstrap/REST endpoint and API key.
6. The old ap-southeast-3 cluster can be deleted after validation to avoid duplicate cost.
```

Historical candidate new cluster name:

```text
api-center-aws-sydney-dev
```

Actual replacement cluster created through Confluent Cloud API:

```text
Display name: api-center-gcp-dev-main
Cluster ID: lkc-850n9q
Cloud: AWS
Region: ap-southeast-2
Availability: LOW
Cluster type: Basic
HTTP endpoint: https://pkc-ldvj1.ap-southeast-2.aws.confluent.cloud:443
Kafka bootstrap endpoint: SASL_SSL://pkc-ldvj1.ap-southeast-2.aws.confluent.cloud:9092
Initial phase: PROVISIONING
Created at: 2026-05-10T18:26:17Z UTC
```

For API Center `KAFKA_BROKERS`, strip the Confluent UI protocol prefix and store
only the host and port:

```text
KAFKA_BROKERS=pkc-ldvj1.ap-southeast-2.aws.confluent.cloud:9092
```

The old cluster remains:

```text
Display name: api-center-gcp-dev
Cluster ID: lkc-vgdkm5
Region: ap-southeast-3
```

Do not delete the old cluster until the new cluster has topics, an active S3 Sink connector, and API Center has been repointed and tested.

New cluster provisioning result:

```text
Cluster ID: lkc-850n9q
Phase: PROVISIONED
```

Initial new cluster topic creation result:

```text
22 topics created successfully
22 topics verified through Kafka REST API
```

Current target topic set after adding shared-service export topics:

```text
28 baseline topics:
- 16 core API Center topics
- 6 shared-service export topics
- 6 original tribe event topics

Newly registered tribes add one topic each:
tribe.<tribeId>.events
```

New cluster Kafka API key:

```text
API key id: SCOLYOE22JLWT6BS
Purpose: mcp-api-center-main-admin
Scope: lkc-850n9q
Secret: stored locally only, not documented
```

New S3 Sink connector created:

```text
Connector name: api-center-s3-sink
Cluster ID: lkc-850n9q
Kafka region: ap-southeast-2
S3 region: ap-southeast-2
S3 bucket: api-center-raw-data
Provider integration: cspi-13ok3
Kafka service account: sa-8wz0rqm
```

Initial new connector failure:

```text
Missing read permission on the source topics.
s3.bucket.name: Failed to build aws sts client.
tasks.max: Unable to check whether topic exists.
```

Fix applied:

```text
Granted service account User:sa-8wz0rqm READ and DESCRIBE ACLs on topic prefixes:
- api-center.
- tribe.

Granted GROUP READ ACL on *
Granted CLUSTER DESCRIBE ACL on kafka-cluster
```

Second new connector failure:

```text
This connector requires access to a dead letter queue topic.
Grant ACLs to create and write to topic dlq-lcc-z0dov7.
```

Fix applied:

```text
Granted service account User:sa-8wz0rqm ACLs on topic dlq-lcc-z0dov7:
- CREATE
- WRITE
- DESCRIBE
- READ
```

Final connector status after restart:

```text
Connector state: RUNNING
Task 0 state: RUNNING
Validation errors: none
```

Test event produced:

```text
Topic: api-center.audit.log
Cluster ID: lkc-850n9q
Partition: 0
Offset: 0
Timestamp: 2026-05-10T18:37:39.188Z UTC
Key: campusone
Correlation ID: manual-main-cluster-test-001
```

Post-test connector status:

```text
Connector state: RUNNING
Task 0 state: RUNNING
Validation errors: none
```

Local MCP/API env files:

```text
Original env file was locked by another process:
C:\Codes\api-center\.codex\confluent-mcp.env

New main-cluster env file created:
C:\Codes\api-center\.codex\confluent-mcp-main.env
```

Codex user config was updated to point the Confluent MCP server at:

```text
C:\Codes\api-center\.codex\confluent-mcp-main.env
```

Codex must be restarted before the MCP server is exposed as a live tool in the session.

## Next Steps After Connector Running

Current good state:

```text
New cluster: api-center-gcp-dev-main / lkc-850n9q
Connector: api-center-s3-sink
Connector state: RUNNING
Task 0 state: RUNNING
```

Next checklist:

```text
1. Verify S3 output appears in api-center-raw-data.
2. Create or choose a dedicated API Center producer service account/API key for lkc-850n9q.
3. Grant API Center producer permissions to write to the API Center,
   shared-service export, and tribe topics.
4. Update API Center/GCP environment variables to use the new cluster bootstrap/API key.
5. Redeploy or restart API Center.
6. Trigger real API Center traffic.
7. Verify messages appear in Confluent topics.
8. Verify connector exports topic records to S3.
9. Only after validation, retire/delete the old ap-southeast-3 cluster.
```

S3 export timing note:

```text
The connector currently uses flush.size=1000 and time.interval=HOURLY.
One manual test event may not immediately create an S3 object. For faster validation, either produce more records or temporarily reduce flush size if Confluent allows it.
```

## Partition Scaling Notes

Kafka topic partitions can be increased later, but they cannot be decreased in place. If a topic is increased from 1 partition to 3 partitions, returning to 1 partition requires creating a replacement topic and migrating producers/consumers.

Current setup:

```text
28 baseline topics x 1 partition = 28 leader partitions
```

If every topic is increased to 3 partitions:

```text
28 baseline topics x 3 partitions = 84 leader partitions
```

Confluent Cloud does not bill partitions as a separate line item on the current eCKU pricing model, but partition count can affect eCKU usage. Confluent's Basic cluster guideline is 30 pre-replication partitions per Basic eCKU.

Approximate partition-driven eCKU estimate for Basic:

```text
28 partitions -> fits within 1 Basic eCKU under the 30-partition guideline
84 partitions -> may require about 3 Basic eCKUs by partition capacity
```

Confluent's public pricing says the first Basic eCKU is free, then additional Basic eCKUs are $0.14/eCKU-hour. If 84 partitions cause the cluster to use 3 eCKUs, the incremental eCKU cost estimate is:

```text
2 paid eCKUs x $0.14/hr = $0.28/hr
$0.28/hr x 24 = $6.72/day
$0.28/hr x 730 = about $204.40/month
```

Connector cost does not increase just from moving to 84 partitions because the S3 Sink connector setup shows 1 task can handle up to 100 partitions. Connector cost remains the shown:

```text
$0.043/hr + $0.03125/GB usage
```

Recommendation: keep all topics at 1 partition during setup. Increase only busy topics later, such as gateway, audit, or a specific tribe event topic, when monitoring shows throughput or consumer parallelism needs it.
