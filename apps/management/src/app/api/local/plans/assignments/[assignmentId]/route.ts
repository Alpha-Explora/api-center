import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { managementRouteErrorResponse } from "@/lib/server/management-route-error";
import { requireManagementRouteAction } from "@/lib/server/require-management-action";
import { authorizePlanAssignment } from "@/lib/server/organization-access";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ assignmentId: string }> },
) {
  try {
    const { assignmentId } = await context.params;
    await authorizePlanAssignment(request, assignmentId, "operator");
    await requireManagementRouteAction({
      request,
      actionRisk: "state-write",
      actionId: "plans.assignments.update",
    });
    return apiCenterAdminRequest(
      `/api/v1/plans/assignments/${encodeURIComponent(assignmentId)}`,
      { method: "PATCH", body: await request.text() },
    );
  } catch (error) {
    return managementRouteErrorResponse(error, "Plan assignment update failed.");
  }
}
