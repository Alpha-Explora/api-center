import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { confluentS3SinkIncludeTopicRequestSchema } from "@/lib/schemas";
import {
  ConfluentCloudError,
  includeConfluentTopicInS3Sink,
} from "@/lib/server/confluent-cloud";
import { createOperationPreview } from "@/lib/operation-preview";
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
    const input = confluentS3SinkIncludeTopicRequestSchema.parse(body);
    const environment = getManagementAuthConfig().environment;

    if (isPreviewRequest(body)) {
      await requireManagementSession({
        authorizationHeader: request.headers.get("authorization"),
      });

      return NextResponse.json({
        preview: createOperationPreview({
          actionId: "confluent.s3-sink.include-topic",
          environment,
          risk: "provider-write",
          changes: [
            `Read the managed S3 Sink connector configuration`,
            `Add ${input.topicName} to the connector topic list if missing`,
            "Update the connector without creating the Kafka topic",
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
      actionId: "confluent.s3-sink.include-topic",
      typedPhrase: input.confirmation?.typedPhrase,
      reason: input.confirmation?.reason,
    });

    const data = await includeConfluentTopicInS3Sink(input.topicName);
    await updateTopicOnboardingStateRecord(data.topicName, {
      serviceId: inferOwnerServiceIdFromTopic(data.topicName),
      actor: session.email,
      timestamp: new Date().toISOString(),
      evidenceLink: `confluent://s3-sink/${data.connectorName}`,
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return routeError(error);
  }
}

function inferOwnerServiceIdFromTopic(topicName: string) {
  const parts = topicName.split(".");
  const tribeIndex = parts.indexOf("tribe");
  const sharedIndex = parts.indexOf("shared");
  const eventsIndex = parts.lastIndexOf("events");

  if (tribeIndex >= 0 && eventsIndex > tribeIndex + 1) {
    return parts.slice(tribeIndex + 1, eventsIndex).join(".");
  }

  if (sharedIndex >= 0 && eventsIndex > sharedIndex + 1) {
    return parts.slice(sharedIndex + 1, eventsIndex).join(".");
  }

  return "api-center";
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
