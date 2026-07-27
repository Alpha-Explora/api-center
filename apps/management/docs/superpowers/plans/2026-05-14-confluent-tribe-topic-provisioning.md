# Confluent Tribe Topic Provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local management-console provisioning for Confluent Cloud tribe event topics and S3 sink inclusion, so adding a tribe does not require manual topic creation in Confluent Cloud.

**Architecture:** API Center remains the only runtime producer to Confluent Cloud. Tribes publish through API Center's governed Kafka API and SDK wrappers; they do not receive Confluent API keys. `apicenter-management` gets local-only server routes that use Confluent Cloud REST APIs to create/check topics, optionally create ACLs for platform service accounts, and update the existing S3 Sink connector topic list.

**Tech Stack:** Next.js 16 route handlers, Zod, Confluent Cloud Kafka REST API v3, Confluent Cloud Connect API, GCP Secret Manager docs/runbooks, existing API Center Kafka governance routes.

---

## Implementation Status

Code implementation is complete in `apicenter-management`. The route contract
accepts a `serviceId` and derives the only currently supported topic:

```text
tribe.<serviceId>.events
```

This intentionally avoids accepting arbitrary topic names from the browser.
Live Confluent verification remains pending until local `.env.local` contains
the Confluent Cloud and Kafka API credentials.

---

## Source Notes

Official Confluent docs confirm this is feasible:

- Kafka REST API v3 supports cluster admin operations, including listing, creating, and deleting topics, topic config, and ACL operations.
- Kafka REST endpoints are per cluster, for example `https://<cluster-host>:443`, and use Basic auth with a Kafka cluster API key/secret.
- Confluent Cloud Connect API supports reading and updating connector configuration through `GET` and `PUT /connect/v1/environments/<env-id>/clusters/<cluster-id>/connectors/<name>/config`.
- Connect API requests use a Cloud API key/secret. Connector configs can include the Kafka cluster API key/secret used by the connector.
- Confluent distinguishes Cloud API keys for management APIs from resource-specific Kafka API keys for Kafka cluster access.

## Product Decision

Do not create one Confluent API key per tribe for now.

Reason:

- Current API Center architecture intentionally keeps Confluent out of tribe-facing runtime paths.
- Tribes should use `@implementsprint/sdk` -> API Center -> Confluent.
- Giving tribes direct Kafka credentials increases cost, policy surface, and support complexity.
- The useful automation is topic/S3-sink provisioning, not direct tribe Kafka access.

If a future tribe needs direct Kafka produce/consume access, create a separate plan for per-tribe Confluent service accounts, ACLs, quotas, and credential delivery.

## Provisioning Contract

For a tribe service ID:

```text
smoke-tribe
```

Management provisions:

```text
tribe.smoke-tribe.events
```

Optional future topics:

```text
tribe.smoke-tribe.commands
tribe.smoke-tribe.audit
```

Default topic config:

```json
{
  "partitions_count": 1,
  "configs": [
    { "name": "cleanup.policy", "value": "delete" },
    { "name": "retention.ms", "value": "604800000" }
  ]
}
```

For audit or registry topics, keep the existing platform topic list in `api-center/docs/confluent-cloud-s3-sink-setup.md`.

## Environment Contract

Add these to local `apicenter-management/.env.local` only. Do not expose these through `NEXT_PUBLIC_*`.

```text
CONFLUENT_ENVIRONMENT_ID=<env-...>
CONFLUENT_KAFKA_CLUSTER_ID=<lkc-...>
CONFLUENT_KAFKA_REST_ENDPOINT=https://<cluster-rest-endpoint>:443
CONFLUENT_KAFKA_API_KEY=<cluster-api-key-with-topic-admin-permission>
CONFLUENT_KAFKA_API_SECRET=<cluster-api-secret>
CONFLUENT_CLOUD_API_KEY=<cloud-management-api-key>
CONFLUENT_CLOUD_API_SECRET=<cloud-management-api-secret>
CONFLUENT_S3_CONNECTOR_NAME=<existing-s3-sink-connector-name>
CONFLUENT_DEFAULT_RETENTION_MS=604800000
```

Optional later:

```text
CONFLUENT_CONNECTOR_TOPICS_MODE=explicit-list
CONFLUENT_CONNECTOR_INCLUDE_MODE=update-existing
```

## File Map

### `apicenter-management`

- Create: `src/lib/server/confluent-cloud.ts`
  - Holds Confluent auth helpers, fetch wrapper, topic create/check, connector config read/update, and safe response shaping.
- Modify: `src/lib/schemas.ts`
  - Adds request/response schemas for topic provisioning and connector inclusion.
- Modify: `src/lib/api-center-client.ts`
  - Adds browser client functions for local Confluent provisioning routes.
- Create: `src/app/api/local/confluent/topics/provision/route.ts`
  - Local route to create/check one tribe topic.
- Create: `src/app/api/local/confluent/s3-sink/include-topic/route.ts`
  - Local route to add a topic to the existing S3 Sink connector config.
- Create: `src/components/confluent-provisioning-card.tsx`
  - Tribe detail UI card that shows topic status and provisioning actions.
- Modify: `src/components/service-detail-client.tsx`
  - Renders Confluent provisioning card for `serviceType: "tribe"`.
- Modify: `src/components/event-mapping-panel.tsx`
  - Replaces manual-only copy with a link/action to provision/check Confluent topic.
- Modify: `docs/operations/local-smoke-testing.md`
  - Adds topic provisioning verification after tribe token smoke checks.
- Modify: `docs/superpowers/plans/2026-05-14-production-readiness-next-phases.md`
  - Moves Confluent provisioning into the production readiness path.

### `api-center`

- Modify: `docs/confluent-cloud-s3-sink-setup.md`
  - Adds the management-console provisioning workflow and explains which credentials are Cloud API keys vs Kafka cluster API keys.
- Modify: `docs/apicenter-platform-setup.md`
  - Adds the current rule: API Center owns Confluent credentials; tribes do not.
- Optional later: `src/kafka-governance/kafka-governance.service.ts`
  - No required change for topic provisioning. Only change later if governance catalog should return provisioning status.

---

## Phase 1: Confluent Config And Client

**Outcome:** The management server can call Confluent Cloud without exposing secrets to the browser.

- [x] **Step 1: Add schemas**

Modify `C:\Codes\apic\apicenter-management\src\lib\schemas.ts`.

Add:

```ts
export const confluentTopicProvisionRequestSchema = z.object({
  serviceId: z
    .string()
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/),
  topicName: z
    .string()
    .regex(/^tribe\.[a-z0-9][a-z0-9-]*\.(events|commands|audit)$/),
  partitionsCount: z.number().int().min(1).max(12).default(1),
  retentionMs: z.number().int().min(3600000).default(604800000),
});

export const confluentTopicProvisionResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    topicName: z.string(),
    existed: z.boolean(),
    created: z.boolean(),
    partitionsCount: z.number().optional(),
    retentionMs: z.number().optional(),
    clusterId: z.string(),
  }),
});

export const confluentS3SinkIncludeTopicRequestSchema = z.object({
  topicName: z.string().regex(/^tribe\.[a-z0-9][a-z0-9-]*\.(events|commands|audit)$/),
});

export const confluentS3SinkIncludeTopicResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    connectorName: z.string(),
    topicName: z.string(),
    alreadyIncluded: z.boolean(),
    updated: z.boolean(),
    topicCount: z.number(),
  }),
});
```

Export inferred types for the four schemas.

- [x] **Step 2: Create server client**

Create `C:\Codes\apic\apicenter-management\src\lib\server\confluent-cloud.ts`.

Implementation rules:

- Validate required env vars at request time.
- Never return API key/secret values in JSON responses.
- Use Kafka REST endpoint for topic check/create.
- Use Confluent Cloud Connect API endpoint for connector config.
- Normalize connector `topics` as a comma-separated string.
- Treat 409 topic already exists as success.
- Treat 404 connector not found as a clear operator error.

Required helper signatures:

```ts
export type ConfluentTopicInput = {
  topicName: string;
  partitionsCount: number;
  retentionMs: number;
};

export async function provisionConfluentTopic(
  input: ConfluentTopicInput,
): Promise<{
  topicName: string;
  existed: boolean;
  created: boolean;
  partitionsCount?: number;
  retentionMs?: number;
  clusterId: string;
}>;

export async function includeTopicInS3Sink(topicName: string): Promise<{
  connectorName: string;
  topicName: string;
  alreadyIncluded: boolean;
  updated: boolean;
  topicCount: number;
}>;
```

- [x] **Step 3: Add unit-test seam**

Keep `confluent-cloud.ts` functions small and dependency-inject `fetch` internally:

```ts
type FetchLike = typeof fetch;

export function createConfluentCloudClient(fetchImpl: FetchLike = fetch) {
  return {
    provisionConfluentTopic: (input: ConfluentTopicInput) =>
      provisionConfluentTopicWithFetch(fetchImpl, input),
    includeTopicInS3Sink: (topicName: string) =>
      includeTopicInS3SinkWithFetch(fetchImpl, topicName),
  };
}
```

This lets route tests mock Confluent without real credentials.

---

## Phase 2: Local Routes

**Outcome:** The local management app can provision topics and update S3 sink inclusion through server-only routes.

- [x] **Step 1: Create topic route**

Create `C:\Codes\apic\apicenter-management\src\app\api\local\confluent\topics\provision\route.ts`.

Route behavior:

```ts
export async function POST(request: Request) {
  const body = await request.json();
  const input = confluentTopicProvisionRequestSchema.parse(body);
  const result = await provisionConfluentTopic({
    topicName: input.topicName,
    partitionsCount: input.partitionsCount,
    retentionMs: input.retentionMs,
  });
  return NextResponse.json({ success: true, data: result });
}
```

- [x] **Step 2: Create S3 sink include route**

Create `C:\Codes\apic\apicenter-management\src\app\api\local\confluent\s3-sink\include-topic\route.ts`.

Route behavior:

```ts
export async function POST(request: Request) {
  const body = await request.json();
  const input = confluentS3SinkIncludeTopicRequestSchema.parse(body);
  const result = await includeTopicInS3Sink(input.topicName);
  return NextResponse.json({ success: true, data: result });
}
```

- [x] **Step 3: Add client functions**

Modify `C:\Codes\apic\apicenter-management\src\lib\api-center-client.ts`.

Add:

```ts
export async function provisionConfluentTopic(input: ConfluentTopicProvisionRequest) {
  const payload = confluentTopicProvisionRequestSchema.parse(input);
  const data = await request<unknown>("/api/local/confluent/topics/provision", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return confluentTopicProvisionResponseSchema.parse(data).data;
}

export async function includeConfluentTopicInS3Sink(input: ConfluentS3SinkIncludeTopicRequest) {
  const payload = confluentS3SinkIncludeTopicRequestSchema.parse(input);
  const data = await request<unknown>("/api/local/confluent/s3-sink/include-topic", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return confluentS3SinkIncludeTopicResponseSchema.parse(data).data;
}
```

---

## Phase 3: Management UI

**Outcome:** A local operator can provision a tribe's Confluent topic from the tribe detail page.

- [x] **Step 1: Create provisioning card**

Create `C:\Codes\apic\apicenter-management\src\components\confluent-provisioning-card.tsx`.

UI behavior:

- Show topic name `tribe.<serviceId>.events`.
- Show default retention as `7 days`.
- Button: `Provision topic`.
- Button: `Include in S3 sink`.
- Show result states:
  - topic existed
  - topic created
  - S3 sink already included topic
  - S3 sink config updated
- Show a warning that this does not give the tribe direct Kafka credentials.

- [x] **Step 2: Render card for tribes**

Modify `C:\Codes\apic\apicenter-management\src\components\service-detail-client.tsx`.

In the tribe-only section, render:

```tsx
<ConfluentProvisioningCard serviceId={service.serviceId} />
```

Place it near the existing `EventMappingPanel` or directly before it.

- [x] **Step 3: Update event mapping panel copy**

Modify `C:\Codes\apic\apicenter-management\src\components\event-mapping-panel.tsx`.

Replace manual checklist text with:

```text
Provision this topic from the Confluent provisioning card. The S3 sink must include the topic before records appear in the raw data lake.
```

---

## Phase 4: Permissions And Safety

**Outcome:** Provisioning can run without giving the management app broad accidental power.

- [x] **Step 1: Require local-only mode**

In both route handlers, reject requests when:

```ts
process.env.NEXT_PUBLIC_LOCAL_MANAGEMENT_MODE === "false"
```

Return HTTP `403`.

- [x] **Step 2: Validate topic ownership**

Only allow topics matching:

```text
tribe.<tribe-id>.events
tribe.<tribe-id>.commands
tribe.<tribe-id>.audit
```

Do not allow:

```text
api-center.*
__*
any topic with slash, whitespace, or wildcard
```

- [x] **Step 3: Do not create Confluent keys for tribes**

Add a note in the UI card:

```text
Tribes do not receive Confluent credentials. They publish through API Center Kafka governance.
```

- [x] **Step 4: Optional ACL path**

Only implement ACL creation if API Center or S3 connector service accounts need new topic-specific permissions. If the existing API Center producer and connector service accounts already have prefix ACLs on `tribe.`, skip ACL creation.

Recommended ACL model:

```text
API Center producer SA:
  WRITE, DESCRIBE on Topic prefix tribe.

S3 Sink connector SA:
  READ, DESCRIBE on Topic prefix tribe.
```

Do not create per-tribe ACLs unless Confluent prefix ACLs are unavailable or too broad for the compliance target.

---

## Phase 5: Docs

**Outcome:** Operators know where Confluent credentials come from and what each button does.

- [x] **Step 1: Update setup docs**

Modify `C:\Codes\apic\api-center\docs\apicenter-platform-setup.md`.

Add:

```text
Confluent topic provisioning is an operator-only management action. It creates tribe event topics and ensures the S3 Sink connector includes them. It does not create direct tribe Confluent credentials.
```

- [x] **Step 2: Update Confluent/S3 runbook**

Modify `C:\Codes\apic\api-center\docs\confluent-cloud-s3-sink-setup.md`.

Add:

- Required local management env vars.
- Difference between Cloud API key and Kafka cluster API key.
- Manual fallback commands using Confluent Console if the local route fails.
- Verification steps:
  - topic exists
  - connector config includes topic
  - API Center governed publish succeeds
  - S3 object appears under the expected topic prefix

- [x] **Step 3: Update local smoke docs**

Modify `C:\Codes\apic\apicenter-management\docs\operations\local-smoke-testing.md`.

After tribe secret verification, add:

```text
Provision the tribe event topic:
1. Open /tribes/<serviceId>.
2. Click Provision topic.
3. Click Include in S3 sink.
4. Publish a governed Kafka smoke event.
5. Confirm Confluent topic receives the event and S3 sink exports it.
```

---

## Phase 6: Verification

**Outcome:** `smoke-tribe` can be fully onboarded for API calls and data lake flow.

- [x] **Step 1: Local validation**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm run lint
npx tsc --noEmit
```

Expected:

```text
lint passes
typecheck passes
```

Result on 2026-05-14:

```text
npm run lint: passed
npx tsc --noEmit: passed
```

- [ ] **Step 2: Provision smoke topic**

Open:

```text
http://localhost:3000/tribes/smoke-tribe
```

Click:

```text
Provision topic
Include in S3 sink
```

Expected:

```text
tribe.smoke-tribe.events exists
S3 sink connector config includes tribe.smoke-tribe.events
```

- [ ] **Step 3: Governed publish smoke**

Request a smoke tribe token from:

```text
http://localhost:3000/smoke-tests?tribeId=smoke-tribe
```

Then call API Center:

```powershell
$base = "https://api-center.itsandbox.site"
$headers = @{ Authorization = "Bearer <smoke-tribe-token>" }
$body = @{
  topic = "tribe.smoke-tribe.events"
  eventType = "smoke.test"
  payload = @{ source = "apicenter-management"; ok = $true }
} | ConvertTo-Json -Depth 10
Invoke-RestMethod "$base/api/v1/kafka/publish" -Method Post -Headers $headers -ContentType "application/json" -Body $body
```

Expected:

```json
{
  "accepted": true,
  "topic": "tribe.smoke-tribe.events"
}
```

- [ ] **Step 4: S3 verification**

In AWS S3, confirm the connector exports an object under the configured topic directory for:

```text
tribe.smoke-tribe.events
```

If no object appears:

- Check Confluent connector status.
- Check connector task errors.
- Check S3 sink flush interval and file rotation settings.
- Confirm the connector config includes the topic.

---

## Non-Goals

- Do not expose Confluent API keys to browser JavaScript.
- Do not create direct Confluent credentials for tribes in this phase.
- Do not create or delete Confluent clusters.
- Do not change S3 bucket/IAM setup unless connector update fails because of AWS permissions.
- Do not auto-delete topics from Confluent when a tribe is deregistered; topic deletion should stay manual and audited.

---

## Recommended Execution Order

1. Implement Confluent server client and route schemas.
2. Implement topic provisioning route.
3. Implement S3 sink connector inclusion route.
4. Add tribe detail UI card.
5. Update docs.
6. Verify with `smoke-tribe`.
7. Commit and push `apicenter-management`.
8. Commit and push `api-center` docs.
