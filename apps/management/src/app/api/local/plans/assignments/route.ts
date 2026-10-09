import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  assignTribePlanInputSchema,
  tribePlanAssignmentStatusSchema,
  tribePlanEnvironmentSchema,
} from "@/lib/schemas";
import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { managementRouteErrorResponse } from "@/lib/server/management-route-error";
import { authorizeProject, managementOrganizationFilter } from "@/lib/server/organization-access";
import { requireManagementRouteAction } from "@/lib/server/require-management-action";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const params = new URLSearchParams();
    const organizationId = await managementOrganizationFilter(request);
    if (organizationId) params.set("organizationId", organizationId);

    for (const key of ["ownerTribeId", "projectId"]) {
      const value = url.searchParams.get(key);
      if (value) params.set(key, value);
    }
    const environment = url.searchParams.get("environment");
    if (environment) {
      const parsed = tribePlanEnvironmentSchema.safeParse(environment);
      if (!parsed.success) return invalidRequest("Unsupported environment.");
      params.set("environment", parsed.data);
    }
    const status = url.searchParams.get("status");
    if (status) {
      const parsed = tribePlanAssignmentStatusSchema.safeParse(status);
      if (!parsed.success) return invalidRequest("Unsupported status.");
      params.set("status", status);
    }

    const suffix = params.size ? "?" + params.toString() : "";
    return apiCenterAdminRequest("/api/v1/plans/assignments" + suffix);
  } catch (error) {
    return managementRouteErrorResponse(error, "Plan assignment list failed.");
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input = assignTribePlanInputSchema.parse(body);
    await authorizeProject(request, input.projectId, "operator");
    await requireManagementRouteAction({ request, actionRisk: "state-write", actionId: "plans.assignments.create" });
    return apiCenterAdminRequest("/api/v1/plans/assignments", {
      method: "POST",
      body: JSON.stringify(input),
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return invalidRequest(error.issues[0]?.message ?? "Invalid request.");
    }
    return managementRouteErrorResponse(error, "Plan assignment request failed.");
  }
}

function invalidRequest(error: string) {
  return NextResponse.json({ success: false, error }, { status: 400 });
}
