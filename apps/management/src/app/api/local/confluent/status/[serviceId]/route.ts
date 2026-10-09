import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  ConfluentCloudError,
  getConfluentPipelineStatus,
  getConfluentPipelineStatusForTopic,
} from "@/lib/server/confluent-cloud";
import { confluentTopicNameSchema } from "@/lib/schemas";
import { normalizeTopicIdentifier } from "@/lib/event-topics";
import { platformAdministratorResponse } from "@/lib/server/organization-access";

const SERVICE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

type Context = {
  params: Promise<{ serviceId: string }>;
};

export async function GET(request: Request, context: Context) {
  const denied = await platformAdministratorResponse(request);
  if (denied) return denied;
  if (process.env.NEXT_PUBLIC_LOCAL_MANAGEMENT_MODE === "false") {
    return NextResponse.json(
      { success: false, error: "Local management routes are disabled." },
      { status: 403 },
    );
  }

  const { serviceId } = await context.params;

  if (!SERVICE_ID_PATTERN.test(serviceId)) {
    return NextResponse.json(
      { success: false, error: "Invalid service ID." },
      { status: 400 },
    );
  }

  try {
    const searchParams = new URL(request.url).searchParams;
    const topicName = searchParams.get("topicName");
    const ownerTribeId = searchParams.get("ownerTribeId") ?? undefined;

    if (ownerTribeId) {
      try {
        normalizeTopicIdentifier(ownerTribeId);
      } catch {
        return NextResponse.json(
          { success: false, error: "Invalid owner tribe ID." },
          { status: 400 },
        );
      }
    }

    const parsedTopicName = topicName
      ? confluentTopicNameSchema.parse(topicName)
      : undefined;
    const data = parsedTopicName
      ? await getConfluentPipelineStatusForTopic(serviceId, parsedTopicName)
      : await getConfluentPipelineStatus(serviceId, ownerTribeId);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { success: false, error: error.issues[0]?.message ?? "Invalid topic." },
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
        error:
          error instanceof Error
            ? error.message
            : "Confluent status check failed.",
      },
      { status: 500 },
    );
  }
}
