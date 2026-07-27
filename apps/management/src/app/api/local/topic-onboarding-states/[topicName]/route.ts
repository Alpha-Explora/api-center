import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { confluentTopicNameSchema } from "@/lib/schemas";
import { normalizeTopicIdentifier } from "@/lib/event-topics";
import { getOrCreateTopicOnboardingStateRecord } from "@/lib/server/topic-onboarding-state-store";

const SERVICE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

type Context = {
  params: Promise<{ topicName: string }>;
};

export async function GET(request: Request, context: Context) {
  if (process.env.NEXT_PUBLIC_LOCAL_MANAGEMENT_MODE === "false") {
    return NextResponse.json(
      { success: false, error: "Local management routes are disabled." },
      { status: 403 },
    );
  }

  try {
    const { topicName: encodedTopicName } = await context.params;
    const topicName = confluentTopicNameSchema.parse(
      decodeURIComponent(encodedTopicName),
    );
    const searchParams = new URL(request.url).searchParams;
    const serviceId = searchParams.get("serviceId");
    const ownerTribeId = searchParams.get("ownerTribeId") ?? undefined;

    if (!serviceId || !SERVICE_ID_PATTERN.test(serviceId)) {
      return NextResponse.json(
        { success: false, error: "Invalid service ID." },
        { status: 400 },
      );
    }

    if (ownerTribeId) {
      normalizeTopicIdentifier(ownerTribeId);
    }

    const data = await getOrCreateTopicOnboardingStateRecord({
      serviceId,
      ownerTribeId,
      physicalTopic: topicName,
    });

    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { success: false, error: error.issues[0]?.message ?? "Invalid topic." },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Topic onboarding state lookup failed.",
      },
      { status: 500 },
    );
  }
}
