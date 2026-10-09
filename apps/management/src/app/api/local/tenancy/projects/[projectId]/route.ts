import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { updateTenancyStatusInputSchema } from "@/lib/schemas";
import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { managementRouteErrorResponse } from "@/lib/server/management-route-error";
import { requireManagementRouteAction } from "@/lib/server/require-management-action";
import { authorizeProject } from "@/lib/server/organization-access";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    await authorizeProject(request, projectId, "admin");
    await requireManagementRouteAction({
      request,
      actionRisk: "state-write",
      actionId: "tenancy.projects.update",
    });
    const input = updateTenancyStatusInputSchema.parse(await request.json());
    return apiCenterAdminRequest(
      `/api/v1/tenancy/projects/${encodeURIComponent(projectId)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { success: false, error: error.issues[0]?.message ?? "Invalid request." },
        { status: 400 },
      );
    }
    return managementRouteErrorResponse(error, "Project update failed.");
  }
}
