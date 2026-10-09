import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { pipelineFeedbackActionRequestSchema } from "@/lib/schemas";
import { managementRouteErrorResponse } from "@/lib/server/management-route-error";
import { requireManagementRouteAction } from "@/lib/server/require-management-action";
import { platformAdministratorResponse } from "@/lib/server/organization-access";

export async function POST(request: Request) {
  const denied = await platformAdministratorResponse(request);
  if (denied) return denied;
  try {
    await requireManagementRouteAction({
      request,
      actionRisk: "state-write",
      actionId: "data-pipeline.feedback-actions.create",
    });

    const payload = pipelineFeedbackActionRequestSchema.parse(
      await request.json(),
    );
    return apiCenterAdminRequest("/api/v1/data-pipeline/feedback-actions", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  } catch (error) {
    return feedbackErrorResponse(error, "Feedback action failed.");
  }
}

export async function GET(request: Request) {
  const denied = await platformAdministratorResponse(request);
  if (denied) return denied;
  const search = new URL(request.url).search;
  return apiCenterAdminRequest(
    `/api/v1/data-pipeline/feedback-actions${search}`,
  );
}

function feedbackErrorResponse(error: unknown, fallback: string) {
  if (error instanceof ZodError) {
    return NextResponse.json(
      { success: false, error: error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  return managementRouteErrorResponse(error, fallback);
}
