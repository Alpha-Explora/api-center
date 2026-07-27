import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { confluentTopicProvisionRequestSchema } from "@/lib/schemas";
import {
  ConfluentCloudError,
  provisionConfluentTopic,
} from "@/lib/server/confluent-cloud";
import { createOperationPreview } from "@/lib/operation-preview";
import { getTribeEventTopic, resolveTribeTopicOwner } from "@/lib/event-topics";
import { getManagementAuthConfig } from "@/lib/server/management-auth";
import { requireManagementAction } from "@/lib/server/require-management-action";
import { requireManagementSession } from "@/lib/server/require-management-session";
import { updateTopicOnboardingStateRecord } from "@/lib/server/topic-onboarding-state-store";

export async function POST(request: Request) {
  if (process.env.NEXT_PUBLIC_LOCAL_MANAGEMENT_MODE === "false") {
    return NextResponse.json(
      { success: false, error: "Local management routes are disabled." },
      { status: 403 },
    );
  }

  try {
    const body = await request.json();
    const input = confluentTopicProvisionRequestSchema.parse(body);
    const environment = getManagementAuthConfig().environment;

    if (isPreviewRequest(body)) {
      await requireManagementSession({
        authorizationHeader: request.headers.get("authorization"),
      });

      return NextResponse.json({
        preview: createOperationPreview({
          actionId: "confluent.topic.provision",
          environment,
          risk: "provider-write",
          changes: [
            `Create or verify Kafka topic ${
              input.topicName ??
              getTribeEventTopic(resolveTribeTopicOwner(input))
            }`,
            `Set partitions to ${input.partitions}`,
            `Apply retention ${input.retentionMs ?? "environment default"} ms`,
          ],
        }),
      });
    }

    const session = await requireManagementSession({
      authorizationHeader: request.headers.get("authorization"),
    });
    await requireManagementAction({
      session,
      environment,
      actionRisk: "provider-write",
      actionId: "confluent.topic.provision",
      typedPhrase: input.confirmation?.typedPhrase,
      reason: input.confirmation?.reason,
    });

    const data = await provisionConfluentTopic(input);
    await updateTopicOnboardingStateRecord(data.topicName, {
      serviceId: data.serviceId,
      actor: session.email,
      timestamp: new Date().toISOString(),
      evidenceLink: `confluent://${data.clusterId}/topics/${data.topicName}`,
      stateInputs: {
        classificationApproved: true,
        hasScope: true,
        topicExists: true,
        s3SinkIncludesTopic: false,
      },
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return routeError(error);
  }
}

function routeError(error: unknown) {
  if (error instanceof ZodError) {
    return NextResponse.json(
      { success: false, error: error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  if (error instanceof ConfluentCloudError) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: error.status && error.status < 500 ? error.status : 500 },
    );
  }

  return NextResponse.json(
    {
      success: false,
      error: error instanceof Error ? error.message : "Confluent request failed.",
    },
    { status: 500 },
  );
}

function isPreviewRequest(body: unknown): body is { preview: true } {
  return Boolean(
    body &&
      typeof body === "object" &&
      "preview" in body &&
      (body as { preview?: unknown }).preview === true,
  );
}
