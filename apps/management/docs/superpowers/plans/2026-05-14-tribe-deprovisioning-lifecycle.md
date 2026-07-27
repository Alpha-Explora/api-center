# Tribe Deprovisioning Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe tribe deprovisioning workflow that makes registry deregistration separate from external cleanup, and makes Confluent topic provisioning versus S3 sink inclusion unambiguous.

**Implementation Status:** App-side implementation completed on 2026-05-14. Lint, typecheck, and production build passed. Cloud-side deletion still needs an explicit IAM update for `secretmanager.secrets.delete` before the UI can delete tribe credential secrets in GCP.

**Architecture:** Keep the current `Deregister service` action registry-only and add a separate `Deprovision tribe` flow for external resources. Deprovisioning is explicit, checkbox-driven, and typed-confirmed; it supports non-destructive defaults first, with destructive Confluent topic deletion left off unless specifically enabled later.

**Tech Stack:** Next.js 16 route handlers, React 19, TanStack Query, Zod, GCP Secret Manager via local provisioner impersonation, Confluent Cloud Kafka REST API v3, Confluent Cloud Connect API.

---

## Current Behavior

- `Deregister service` calls API Center registry delete only.
- `Provision topic` creates or verifies `tribe.<serviceId>.events` in Confluent Cloud.
- `Add to S3 sink` updates the Confluent S3 Sink connector `topics` config so the already-created topic is exported to S3.
- No current UI action removes Secret Manager tribe credentials, removes a topic from the S3 sink connector, or deletes a Confluent topic.

## Target Behavior

For each tribe detail page:

1. The lifecycle card clearly says registry actions do not clean up external resources.
2. The Confluent card clearly separates:
   - topic creation/check
   - S3 sink connector inclusion
3. A new `Deprovision tribe` panel offers explicit actions:
   - disable or delete per-tribe Secret Manager secret
   - remove the tribe event topic from the S3 sink connector
   - deregister from API Center registry
   - optional future: delete Confluent topic after retention/export confirmation
4. The default deprovision path should be:
   - disable credentials
   - remove topic from S3 sink only if ingestion should stop
   - deregister registry entry
   - preserve Confluent topic and S3 historical data

## File Map

- Modify: `C:\Codes\apic\apicenter-management\src\lib\schemas.ts`
  - Add request/response schemas for Secret Manager disable/delete and S3 sink topic removal.
- Modify: `C:\Codes\apic\apicenter-management\src\lib\server\gcp-secret-manager.ts`
  - Add per-tribe secret status/read and disable/delete helper functions.
- Modify: `C:\Codes\apic\apicenter-management\src\lib\server\confluent-cloud.ts`
  - Add S3 sink topic removal and connector topic-list read helper.
- Create: `C:\Codes\apic\apicenter-management\src\app\api\local\tribe-secrets\[serviceId]\route.ts`
  - `GET` checks secret existence/status.
  - `DELETE` destroys or disables the tribe secret based on explicit request mode.
- Create: `C:\Codes\apic\apicenter-management\src\app\api\local\confluent\s3-sink\remove-topic\route.ts`
  - Removes one topic from the S3 sink connector topic list.
- Modify: `C:\Codes\apic\apicenter-management\src\lib\api-center-client.ts`
  - Add browser-safe client functions for new routes.
- Create: `C:\Codes\apic\apicenter-management\src\components\tribe-deprovisioning-card.tsx`
  - Checkbox-driven UI for external cleanup and registry deregistration.
- Modify: `C:\Codes\apic\apicenter-management\src\components\service-detail-client.tsx`
  - Render deprovisioning card for tribe services.
  - Update lifecycle copy so `Deregister` is explicitly registry-only.
- Modify: `C:\Codes\apic\apicenter-management\src\components\confluent-provisioning-card.tsx`
  - Improve labels and add status copy explaining topic creation and S3 sink inclusion are different.
- Modify: `C:\Codes\apic\apicenter-management\docs\operations\apicenter-management-runbook.md`
  - Add deprovisioning workflow, default retention policy, and manual fallback.
- Modify: `C:\Codes\apic\apicenter-management\docs\operations\local-smoke-testing.md`
  - Add cleanup notes for smoke/local tribes.

---

## Phase 1: Clarify Current Lifecycle And Pipeline Actions

**Outcome:** Operators understand that deregistration is registry-only, and that Confluent topic provisioning and S3 sink inclusion are separate actions.

- [x] **Step 1: Update lifecycle copy**

Modify `C:\Codes\apic\apicenter-management\src\components\service-detail-client.tsx`.

Change lifecycle description from:

```tsx
These actions call API Center registry endpoints through the local
server proxy.
```

To:

```tsx
Registry lifecycle actions only update API Center registration state.
They do not delete Secret Manager secrets, Confluent topics, S3 sink
configuration, or tribe deployments.
```

- [x] **Step 2: Update deregister dialog copy**

In the same file, change the `ConfirmAction` for deregistration:

```tsx
<ConfirmAction
  serviceId={serviceId}
  title="Deregister service"
  description="Deregistering removes this service from API Center registry storage only. External resources stay in place until you run a deprovision action."
  actionLabel="Deregister registry entry"
  consumers={consumers}
  pending={deregisterMutation.isPending}
  onConfirm={() => deregisterMutation.mutate()}
  destructive
/>
```

- [x] **Step 3: Clarify Confluent card copy**

Modify `C:\Codes\apic\apicenter-management\src\components\confluent-provisioning-card.tsx`.

Change the card description to:

```tsx
Create the tribe event topic first, then add that topic to the managed
Confluent S3 Sink connector so records are exported to S3.
```

Change `PipelineStep` copy:

```tsx
<PipelineStep
  title="1. Create or verify topic"
  description="Creates the Kafka topic that API Center publishes tribe events into."
  ...
>
```

```tsx
<PipelineStep
  title="2. Add topic to S3 sink"
  description="Updates the existing S3 Sink connector topic list. This does not create the Kafka topic."
  ...
>
```

- [x] **Step 4: Verify copy-only changes**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm run lint
npx tsc --noEmit
```

Expected: both commands pass.

---

## Phase 2: Add Read And Cleanup Server Capabilities

**Outcome:** The management backend can check and clean up external provisioning artifacts through local-only routes.

- [x] **Step 1: Add schemas**

Modify `C:\Codes\apic\apicenter-management\src\lib\schemas.ts`.

Add:

```ts
export const tribeSecretStatusResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    serviceId: z.string(),
    secretId: z.string(),
    exists: z.boolean(),
    state: z.string().optional(),
  }),
});

export const tribeSecretDeleteRequestSchema = z.object({
  mode: z.enum(["disable", "delete"]),
  confirmServiceId: z.string(),
});

export const tribeSecretDeleteResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    serviceId: z.string(),
    secretId: z.string(),
    action: z.enum(["disabled", "deleted", "not-found"]),
  }),
});

export const confluentS3SinkRemoveTopicRequestSchema = z.object({
  topicName: z.string().min(1),
});

export const confluentS3SinkRemoveTopicResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    topicName: z.string(),
    connectorName: z.string(),
    removed: z.boolean(),
    wasIncluded: z.boolean(),
    topics: z.array(z.string()),
  }),
});
```

Export inferred types near the bottom:

```ts
export type TribeSecretStatusResponse = z.infer<
  typeof tribeSecretStatusResponseSchema
>;
export type TribeSecretDeleteRequest = z.infer<
  typeof tribeSecretDeleteRequestSchema
>;
export type TribeSecretDeleteResponse = z.infer<
  typeof tribeSecretDeleteResponseSchema
>;
export type ConfluentS3SinkRemoveTopicRequest = z.infer<
  typeof confluentS3SinkRemoveTopicRequestSchema
>;
export type ConfluentS3SinkRemoveTopicResponse = z.infer<
  typeof confluentS3SinkRemoveTopicResponseSchema
>;
```

- [x] **Step 2: Add Secret Manager helper functions**

Modify `C:\Codes\apic\apicenter-management\src\lib\server\gcp-secret-manager.ts`.

Add helpers that use the existing local gcloud impersonation token:

```ts
export async function getTribeSecretStatus(input: {
  projectId: string;
  serviceId: string;
  secretId: string;
  secretName: string;
}) {
  const accessToken = await getSecretManagerAccessToken();
  const secret = await secretManagerFetch<{ name?: string; state?: string }>(
    `https://secretmanager.googleapis.com/v1/${input.secretName}`,
    {
      method: "GET",
      accessToken,
      allowNotFound: true,
    },
  );

  return {
    serviceId: input.serviceId,
    secretId: input.secretId,
    exists: Boolean(secret),
    state: secret?.state,
  };
}

export async function disableOrDeleteTribeSecret(input: {
  projectId: string;
  serviceId: string;
  secretId: string;
  secretName: string;
  mode: "disable" | "delete";
}) {
  const accessToken = await getSecretManagerAccessToken();
  const existing = await secretManagerFetch(
    `https://secretmanager.googleapis.com/v1/${input.secretName}`,
    {
      method: "GET",
      accessToken,
      allowNotFound: true,
    },
  );

  if (!existing) {
    return {
      serviceId: input.serviceId,
      secretId: input.secretId,
      action: "not-found" as const,
    };
  }

  if (input.mode === "delete") {
    await secretManagerFetch(
      `https://secretmanager.googleapis.com/v1/${input.secretName}`,
      {
        method: "DELETE",
        accessToken,
      },
    );

    return {
      serviceId: input.serviceId,
      secretId: input.secretId,
      action: "deleted" as const,
    };
  }

  await secretManagerFetch(
    `https://secretmanager.googleapis.com/v1/${input.secretName}:disable`,
    {
      method: "POST",
      accessToken,
      body: {},
    },
  );

  return {
    serviceId: input.serviceId,
    secretId: input.secretId,
    action: "disabled" as const,
  };
}
```

If Secret Manager does not support disabling the secret itself in this API shape, use delete-only in implementation and keep UI label as `Delete tribe credential secret`.

- [x] **Step 3: Add Confluent S3 sink removal helper**

Modify `C:\Codes\apic\apicenter-management\src\lib\server\confluent-cloud.ts`.

Add to `createConfluentCloudClient`:

```ts
removeTopicFromS3Sink: (topicName: string) =>
  removeTopicFromS3Sink(topicName, fetchImpl),
```

Add export:

```ts
export async function removeConfluentTopicFromS3Sink(topicName: string) {
  return createConfluentCloudClient().removeTopicFromS3Sink(topicName);
}
```

Add implementation:

```ts
async function removeTopicFromS3Sink(
  topicName: string,
  fetchImpl: FetchLike,
): Promise<ConfluentS3SinkRemoveTopicResponse["data"]> {
  const config = getConfluentConfig();
  const connectorUrl = connectorConfigUrl(config);
  const response = await fetchImpl(connectorUrl, {
    method: "GET",
    headers: cloudHeaders(config),
    cache: "no-store",
  });

  if (!response.ok) {
    throw await confluentError("Failed to read S3 sink connector config", response);
  }

  const connectorConfig = normalizeConnectorConfig(await response.json());
  const topics = parseTopics(connectorConfig.topics);

  if (!topics.includes(topicName)) {
    return {
      topicName,
      connectorName: config.s3ConnectorName,
      removed: false,
      wasIncluded: false,
      topics,
    };
  }

  const nextTopics = topics.filter((topic) => topic !== topicName).sort();
  const update = await fetchImpl(connectorUrl, {
    method: "PUT",
    headers: cloudHeaders(config),
    cache: "no-store",
    body: JSON.stringify({
      ...connectorConfig,
      topics: nextTopics.join(","),
    }),
  });

  if (!update.ok) {
    throw await confluentError("Failed to remove topic from S3 sink", update);
  }

  return {
    topicName,
    connectorName: config.s3ConnectorName,
    removed: true,
    wasIncluded: true,
    topics: nextTopics,
  };
}
```

- [x] **Step 4: Verify server type consistency**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npx tsc --noEmit
```

Expected: typecheck passes.

---

## Phase 3: Add Local Routes And Client Functions

**Outcome:** Browser components can call local server routes for cleanup without exposing provider credentials.

- [x] **Step 1: Create tribe secret status/delete route**

Create `C:\Codes\apic\apicenter-management\src\app\api\local\tribe-secrets\[serviceId]\route.ts`.

Implementation:

```ts
import { NextResponse } from "next/server";
import { tribeSecretDeleteRequestSchema } from "@/lib/schemas";
import {
  disableOrDeleteTribeSecret,
  getProjectId,
  getSecretManagerAuthReadiness,
  getTribeSecretStatus,
} from "@/lib/server/gcp-secret-manager";

const DEFAULT_SECRET_PREFIX = "api-center-tribe-secret-";

type RouteContext = {
  params: Promise<{ serviceId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { serviceId } = await context.params;
  const setup = getSecretSetup(serviceId);
  if ("response" in setup) return setup.response;

  const data = await getTribeSecretStatus(setup);
  return NextResponse.json({ success: true, data });
}

export async function DELETE(request: Request, context: RouteContext) {
  const { serviceId } = await context.params;
  const body = await request.json();
  const input = tribeSecretDeleteRequestSchema.parse(body);

  if (input.confirmServiceId !== serviceId) {
    return NextResponse.json(
      { success: false, error: "Confirmation did not match service ID." },
      { status: 400 },
    );
  }

  const setup = getSecretSetup(serviceId);
  if ("response" in setup) return setup.response;

  const data = await disableOrDeleteTribeSecret({
    ...setup,
    mode: input.mode,
  });

  return NextResponse.json({ success: true, data });
}

function getSecretSetup(serviceId: string) {
  const projectId = getProjectId();
  if (!projectId) {
    return {
      response: NextResponse.json(
        { success: false, error: "GOOGLE_CLOUD_PROJECT is required." },
        { status: 500 },
      ),
    };
  }

  const auth = getSecretManagerAuthReadiness();
  if (!auth.ok) {
    return {
      response: NextResponse.json(
        { success: false, error: auth.message },
        { status: 500 },
      ),
    };
  }

  const prefix = process.env.TRIBE_SECRET_GCP_PREFIX || DEFAULT_SECRET_PREFIX;
  const secretId = `${prefix}${serviceId}`;

  return {
    projectId,
    serviceId,
    secretId,
    secretName: `projects/${projectId}/secrets/${secretId}`,
  };
}
```

- [x] **Step 2: Create S3 sink topic removal route**

Create `C:\Codes\apic\apicenter-management\src\app\api\local\confluent\s3-sink\remove-topic\route.ts`.

Implementation:

```ts
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { confluentS3SinkRemoveTopicRequestSchema } from "@/lib/schemas";
import {
  ConfluentCloudError,
  removeConfluentTopicFromS3Sink,
} from "@/lib/server/confluent-cloud";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input = confluentS3SinkRemoveTopicRequestSchema.parse(body);
    const data = await removeConfluentTopicFromS3Sink(input.topicName);

    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { success: false, error: error.issues[0]?.message ?? "Invalid request." },
        { status: 400 },
      );
    }

    if (error instanceof ConfluentCloudError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: error.status ?? 500 },
      );
    }

    return NextResponse.json(
      { success: false, error: "Confluent S3 sink update failed." },
      { status: 500 },
    );
  }
}
```

- [x] **Step 3: Add client functions**

Modify `C:\Codes\apic\apicenter-management\src\lib\api-center-client.ts`.

Add imports for new schemas and types, then add:

```ts
export async function getTribeSecretStatus(serviceId: string) {
  const data = await request<unknown>(
    `/api/local/tribe-secrets/${encodeURIComponent(serviceId)}`,
  );

  return tribeSecretStatusResponseSchema.parse(data).data;
}

export async function deleteTribeSecret(
  serviceId: string,
  input: TribeSecretDeleteRequest,
) {
  const payload = tribeSecretDeleteRequestSchema.parse(input);
  const data = await request<unknown>(
    `/api/local/tribe-secrets/${encodeURIComponent(serviceId)}`,
    {
      method: "DELETE",
      body: JSON.stringify(payload),
    },
  );

  return tribeSecretDeleteResponseSchema.parse(data).data;
}

export async function removeConfluentTopicFromS3Sink(
  input: ConfluentS3SinkRemoveTopicRequest,
) {
  const payload = confluentS3SinkRemoveTopicRequestSchema.parse(input);
  const data = await request<unknown>(
    "/api/local/confluent/s3-sink/remove-topic",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );

  return confluentS3SinkRemoveTopicResponseSchema.parse(data).data;
}
```

- [x] **Step 4: Verify routes compile**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm run lint
npx tsc --noEmit
```

Expected: both commands pass.

---

## Phase 4: Add Deprovisioning UI

**Outcome:** Operators have one deliberate place to clean up tribe resources without confusing it with registry deregistration.

- [x] **Step 1: Create deprovisioning component**

Create `C:\Codes\apic\apicenter-management\src\components\tribe-deprovisioning-card.tsx`.

Component behavior:

- Shows current target resource names:
  - `api-center-tribe-secret-<serviceId>`
  - `tribe.<serviceId>.events`
  - S3 sink connector topic membership
- Provides checkboxes:
  - `Delete tribe credential secret`
  - `Remove topic from S3 sink connector`
  - `Deregister API Center registry entry`
- Keeps `Delete Confluent topic` out of the first implementation.
- Requires typing the service ID before running selected actions.
- Runs actions sequentially in this order:
  1. delete tribe secret
  2. remove topic from S3 sink
  3. deregister registry entry
- Shows a final success summary.

Initial skeleton:

```tsx
"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2Icon } from "lucide-react";
import {
  deleteTribeSecret,
  deregisterService,
  removeConfluentTopicFromS3Sink,
} from "@/lib/api-center-client";
import { getServiceEventTopics } from "@/lib/event-topics";
import { queryKeys } from "@/lib/query-keys";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

export function TribeDeprovisioningCard({
  serviceId,
  onDeregistered,
}: {
  serviceId: string;
  onDeregistered: () => void;
}) {
  const queryClient = useQueryClient();
  const [deleteSecret, setDeleteSecret] = useState(false);
  const [removeFromSink, setRemoveFromSink] = useState(false);
  const [deregister, setDeregister] = useState(false);
  const [confirm, setConfirm] = useState("");
  const topicName = useMemo(
    () => getServiceEventTopics(serviceId).tribeEvents,
    [serviceId],
  );

  const mutation = useMutation({
    mutationFn: async () => {
      const results: string[] = [];

      if (deleteSecret) {
        const result = await deleteTribeSecret(serviceId, {
          mode: "delete",
          confirmServiceId: serviceId,
        });
        results.push(`secret:${result.action}`);
      }

      if (removeFromSink) {
        const result = await removeConfluentTopicFromS3Sink({ topicName });
        results.push(result.removed ? "s3-sink:removed" : "s3-sink:not-included");
      }

      if (deregister) {
        await deregisterService(serviceId);
        results.push("registry:deregistered");
      }

      return results;
    },
    onSuccess: async (results) => {
      toast.success("Deprovisioning actions completed", {
        description: results.join(", "),
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.services });
      if (deregister) onDeregistered();
    },
    onError: () => {
      toast.error("Deprovisioning failed", {
        description: "Check provider permissions and retry the failed action.",
      });
    },
  });

  const hasAction = deleteSecret || removeFromSink || deregister;
  const canRun = hasAction && confirm === serviceId && !mutation.isPending;

  return (
    <Card className="border-destructive/25">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trash2Icon data-icon="inline-start" />
          Deprovision tribe
        </CardTitle>
        <CardDescription>
          Cleanup external resources explicitly. Historical S3 data is not deleted.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Alert>
          <AlertTitle>Deregister is registry-only</AlertTitle>
          <AlertDescription>
            Use this panel when you also need to remove credentials or stop S3 export.
          </AlertDescription>
        </Alert>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={deleteSecret} onCheckedChange={(value) => setDeleteSecret(Boolean(value))} />
          Delete tribe credential secret
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={removeFromSink} onCheckedChange={(value) => setRemoveFromSink(Boolean(value))} />
          Remove {topicName} from S3 sink connector
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={deregister} onCheckedChange={(value) => setDeregister(Boolean(value))} />
          Deregister API Center registry entry
        </label>
        <Input
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          placeholder={`Type ${serviceId} to confirm`}
        />
        <Button
          type="button"
          variant="destructive"
          disabled={!canRun}
          onClick={() => mutation.mutate()}
        >
          Run selected cleanup
        </Button>
      </CardContent>
    </Card>
  );
}
```

- [x] **Step 2: Render component on tribe detail pages**

Modify `C:\Codes\apic\apicenter-management\src\components\service-detail-client.tsx`.

Import:

```tsx
import { TribeDeprovisioningCard } from "@/components/tribe-deprovisioning-card";
```

Render after `ConfluentProvisioningCard`:

```tsx
<TribeDeprovisioningCard
  serviceId={service.serviceId}
  onDeregistered={() => router.push("/tribes")}
/>
```

- [x] **Step 3: Keep destructive UI restrained**

Make sure:

- The card appears below provisioning/observability, not above normal onboarding.
- No option deletes the Confluent topic in this phase.
- The button stays disabled until at least one checkbox is selected and the typed service ID matches.

- [x] **Step 4: Browser-check the UI**

Open:

```text
http://localhost:3000/tribes/servease
```

Verify:

- `Deregister registry entry` copy says registry-only.
- `Deprovision tribe` card is visible for tribe services.
- Cleanup button is disabled until confirmation matches.
- Confluent card shows step numbers and separate meanings.

---

## Phase 5: Tests, Docs, And Manual Runbook

**Outcome:** The workflow is documented, and route behavior is protected by focused tests or compile-time checks.

- [x] **Step 1: Add route-level tests if test harness exists**

Search:

```powershell
cd C:\Codes\apic\apicenter-management
rg -n "vitest|jest|describe\\(" src tests
```

If a route test harness exists, add tests for:

- `GET /api/local/tribe-secrets/[serviceId]` returns `exists:false` for missing secrets.
- `DELETE /api/local/tribe-secrets/[serviceId]` rejects mismatched confirmation.
- S3 sink removal leaves connector config unchanged if topic is absent.
- S3 sink removal updates `topics` if topic exists.

If no harness exists yet, record the gap in this plan and rely on `npm run lint`, `npx tsc --noEmit`, and manual route checks for this phase.

Current result: no dedicated route test harness exists yet in this Next app, so this pass relies on lint, typecheck, production build, and browser/server route checks.

- [x] **Step 2: Update management runbook**

Modify `C:\Codes\apic\apicenter-management\docs\operations\apicenter-management-runbook.md`.

Add section:

```md
## Tribe Deprovisioning

Use **Deregister registry entry** only when you want API Center to stop listing or routing a tribe but you want external artifacts preserved.

Use **Deprovision tribe** when you also need to clean up external artifacts.

Recommended default:

1. Delete the per-tribe Secret Manager secret to stop new token issuance.
2. Remove the tribe event topic from the S3 sink if future exports should stop.
3. Deregister the API Center registry entry.
4. Preserve the Confluent topic and S3 objects unless there is a separate data-retention approval.

`Provision topic` creates `tribe.<serviceId>.events`.
`Add topic to S3 sink` only updates the existing managed S3 Sink connector so that topic exports to S3.
```

- [x] **Step 3: Update local smoke testing doc**

Modify `C:\Codes\apic\apicenter-management\docs\operations\local-smoke-testing.md`.

Add cleanup note:

```md
## Local Tribe Cleanup

For test tribes, prefer deprovisioning in this order:

1. Delete the tribe credential secret.
2. Remove the topic from the S3 sink connector if it was added only for the test.
3. Deregister the API Center registry entry.

Do not delete Confluent topics or S3 objects as part of routine smoke cleanup.
```

- [x] **Step 4: Final verification**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm run lint
npx tsc --noEmit
npm run build
```

Expected:

- lint passes
- typecheck passes
- build passes

If `npm run build` fails because the local dev server has locked `.next`, stop the dev server and rerun build.

---

## Phase 6: Future Hardening Not In This Pass

These are intentionally excluded from the first implementation:

- Delete Confluent topics from the UI.
- Delete S3 historical objects.
- Delete tribe Kubernetes deployments.
- Add automatic cascading cleanup when clicking `Deregister`.
- Give tribes direct Confluent credentials.

Future plan if needed:

- Add deprovision audit events.
- Add provider-side status checks before every destructive action.
- Add Confluent topic delete only behind a separate `ALLOW_CONFLUENT_TOPIC_DELETE=true` env flag.
- Add S3 object retention/legal-hold confirmation before any data-lake deletion feature.

---

## Self-Review

- Spec coverage: plan separates registry deregistration from external cleanup, clarifies topic versus S3 sink, and adds explicit deprovisioning.
- Placeholder scan: no TBD or open-ended implementation steps are required for the main workflow.
- Type consistency: route/client/schema names use `tribeSecret*` and `confluentS3SinkRemoveTopic*` consistently.
