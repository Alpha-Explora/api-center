import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { confluentS3SinkRemoveTopicRequestSchema } from "@/lib/schemas";
import {
  ConfluentCloudError,
  removeConfluentTopicFromS3Sink,
} from "@/lib/server/confluent-cloud";
import { createOperationPreview } from "@/lib/operation-preview";
import { getManagementAuthConfig } from "@/lib/server/management-auth";
import { requireManagementAction } from "@/lib/server/require-management-action";
import { requireManagementSession } from "@/lib/server/require-management-session";
import { platformAdministratorResponse } from "@/lib/server/organization-access";

export async function POST(request: Request) {
  if (process.env.NEXT_PUBLIC_LOCAL_MANAGEMENT_MODE === "false") {
    return NextResponse.json(
      { success: false, error: "Local management routes are disabled." },
      { status: 403 },
    );
  }
  const denied = await platformAdministratorResponse(request);
  if (denied) return denied;

  try {
    const body = await request.json();
    const input = confluentS3SinkRemoveTopicRequestSchema.parse(body);
    const environment = getManagementAuthConfig().environment;

    if (isPreviewRequest(body)) {
      await requireManagementSession({
        authorizationHeader: request.headers.get("authorization"),
      });

      return NextResponse.json({
        preview: createOperationPreview({
          actionId: "confluent.s3-sink.remove-topic",
          environment,
          risk: "provider-write",
          changes: [
            `Read the managed S3 Sink connector configuration`,
            `Remove ${input.topicName} from the connector topic list if present`,
            "Preserve Kafka topic and historical S3 data",
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
      actionId: "confluent.s3-sink.remove-topic",
      typedPhrase: input.confirmation?.typedPhrase,
      reason: input.confirmation?.reason,
    });

    const data = await removeConfluentTopicFromS3Sink(input.topicName);

    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: error.issues[0]?.message ?? "Invalid request.",
        },
        { status: 400 },
      );
    }

    if (error instanceof ConfluentCloudError) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
        },
        { status: error.status ?? 500 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: "Confluent S3 sink update failed.",
      },
      { status: 500 },
    );
  }
}

function isPreviewRequest(body: unknown): body is { preview: true } {
  return Boolean(
    body &&
    typeof body === "object" &&
    "preview" in body &&
    (body as { preview?: unknown }).preview === true,
  );
}
