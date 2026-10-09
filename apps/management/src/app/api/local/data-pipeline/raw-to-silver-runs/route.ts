import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { rawToSilverRunRequestSchema } from "@/lib/schemas";
import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { managementRouteErrorResponse } from "@/lib/server/management-route-error";
import { requireManagementRouteAction } from "@/lib/server/require-management-action";
import { platformAdministratorResponse } from "@/lib/server/organization-access";

export const maxDuration = 180;

export async function POST(request: Request) {
  const denied = await platformAdministratorResponse(request);
  if (denied) return denied;
  try {
    await requireManagementRouteAction({
      request,
      actionRisk: "state-write",
      actionId: "data-pipeline.raw-to-silver-runs.create",
    });

    const body = await request.json();
    const input = rawToSilverRunRequestSchema.parse(body);

    return apiCenterAdminRequest("/api/v1/data-pipeline/raw-to-silver-runs", {
      method: "POST",
      timeoutMs: 180_000,
      body: JSON.stringify(input),
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { success: false, error: error.issues[0]?.message ?? "Invalid request." },
        { status: 400 },
      );
    }

    return managementRouteErrorResponse(
      error,
      "Raw to Common Silver run failed.",
    );
  }
}
