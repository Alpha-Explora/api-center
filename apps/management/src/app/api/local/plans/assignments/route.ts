import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  assignTribePlanInputSchema,
  tribePlanAssignmentStatusSchema,
  tribePlanEnvironmentSchema,
} from "@/lib/schemas";
import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { managementRouteErrorResponse } from "@/lib/server/management-route-error";
import { requireManagementRouteAction } from "@/lib/server/require-management-action";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = new URLSearchParams();
  const ownerTribeId = url.searchParams.get("ownerTribeId");
  const projectId = url.searchParams.get("projectId");
  const environment = url.searchParams.get("environment");
  const status = url.searchParams.get("status");

  if (ownerTribeId) params.set("ownerTribeId", ownerTribeId);
  if (projectId) params.set("projectId", projectId);
  if (environment) {
    const result = tribePlanEnvironmentSchema.safeParse(environment);
    if (!result.success) return invalidRequest("Unsupported environment.");
    params.set("environment", result.data);
  }
  if (status) {
    const result = tribePlanAssignmentStatusSchema.safeParse(status);
    if (!result.success) return invalidRequest("Unsupported status.");
    params.set("status", status);
  }

  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiCenterAdminRequest(`/api/v1/plans/assignments${suffix}`);
}

export async function POST(request: Request) {
  try {
    await requireManagementRouteAction({
      request,
      actionRisk: "state-write",
      actionId: "plans.assignments.create",
    });

    const body = await request.json();
    const input = assignTribePlanInputSchema.parse(body);

    return apiCenterAdminRequest("/api/v1/plans/assignments", {
      method: "POST",
      body: JSON.stringify(input),
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return invalidRequest(error.issues[0]?.message ?? "Invalid request.");
    }

    return managementRouteErrorResponse(
      error,
      "Plan assignment request failed.",
    );
  }
}

function invalidRequest(error: string) {
  return NextResponse.json({ success: false, error }, { status: 400 });
}
