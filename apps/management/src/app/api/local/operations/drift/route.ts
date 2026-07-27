import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { managementRouteErrorResponse } from "@/lib/server/management-route-error";
import { requireManagementRouteAction } from "@/lib/server/require-management-action";

export async function POST(request: Request) {
  try {
    await requireManagementRouteAction({
      request,
      actionRisk: "state-write",
      actionId: "operations.drift.compare",
    });

    const body = await request.text();
    return apiCenterAdminRequest("/api/v1/admin/operations/drift/compare", {
      method: "POST",
      body,
    });
  } catch (error) {
    return managementRouteErrorResponse(error, "Drift comparison failed.");
  }
}
