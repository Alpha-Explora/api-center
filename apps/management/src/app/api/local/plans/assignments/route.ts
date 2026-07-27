import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  assignTribePlanInputSchema,
  tribePlanAssignmentStatusSchema,
} from "@/lib/schemas";
import {
  isEnvironmentNameError,
  toPlanStorageEnvironment,
} from "@/lib/environment-names";
import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { managementRouteErrorResponse } from "@/lib/server/management-route-error";
import { requireManagementRouteAction } from "@/lib/server/require-management-action";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = new URLSearchParams();
  const ownerTribeId = url.searchParams.get("ownerTribeId");
  const environment = url.searchParams.get("environment");
  const status = url.searchParams.get("status");

  if (ownerTribeId) params.set("ownerTribeId", ownerTribeId);
  if (environment) {
    try {
      params.set("environment", toPlanStorageEnvironment(environment));
    } catch (error) {
      if (isEnvironmentNameError(error)) {
        return invalidRequest("Unsupported environment.");
      }
      throw error;
    }
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
    const input = assignTribePlanInputSchema.parse({
      ...body,
      environment: toPlanStorageEnvironment(body?.environment),
    });

    return apiCenterAdminRequest("/api/v1/plans/assignments", {
      method: "POST",
      body: JSON.stringify(input),
    });
  } catch (error) {
    if (error instanceof ZodError || isEnvironmentNameError(error)) {
      return invalidRequest(
        error instanceof ZodError
          ? (error.issues[0]?.message ?? "Invalid request.")
          : error.message,
      );
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
