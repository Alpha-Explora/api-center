import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { topicMigrationRequestSchema } from "@/lib/schemas";
import { planTopicMigration } from "@/lib/topic-migration";
import {
  ConfluentCloudError,
  includeConfluentTopicInS3Sink,
  provisionConfluentTopic,
} from "@/lib/server/confluent-cloud";
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
    const input = topicMigrationRequestSchema.parse(await request.json());
    const environment = getManagementAuthConfig().environment;
    const session = await requireManagementSession({
      authorizationHeader: request.headers.get("authorization"),
    });

    await requireManagementAction({
      session,
      environment,
      actionRisk: "provider-write",
      actionId: "confluent.topic.migrate",
      typedPhrase: input.confirmation?.typedPhrase,
      reason: input.confirmation?.reason,
    });

    const plan = planTopicMigration(input);
    const topic = await provisionConfluentTopic({
      serviceId: input.serviceId,
      ownerTribeId: plan.ownerTribeId,
      topicName: plan.targetTopic,
      partitions: 1,
    });
    const sink = await includeConfluentTopicInS3Sink(plan.targetTopic);
    await updateTopicOnboardingStateRecord(plan.targetTopic, {
      serviceId: plan.serviceId,
      actor: session.email,
      timestamp: new Date().toISOString(),
      evidenceLink: `confluent://topic-migration/${plan.targetTopic}`,
      stateInputs: {
        classificationApproved: true,
        hasScope: true,
        topicExists: topic.created || topic.existed,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        serviceId: plan.serviceId,
        ownerTribeId: plan.ownerTribeId,
        legacyTopic: plan.legacyTopic,
        targetTopic: plan.targetTopic,
        migrationNeeded: plan.migrationNeeded,
        topicProvisioned: topic.created || topic.existed,
        sinkIncluded: sink.updated || sink.alreadyIncluded,
        oldTopicPreserved: true,
      },
    });
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
        { status: error.status && error.status < 500 ? error.status : 500 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Topic migration failed.",
      },
      { status: 500 },
    );
  }
}
