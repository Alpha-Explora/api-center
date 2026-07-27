import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { managementRouteErrorResponse } from "@/lib/server/management-route-error";
import { requireManagementRouteAction } from "@/lib/server/require-management-action";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ policyId: string }> },
) {
  try {
    await requireManagementRouteAction({
      request,
      actionRisk: "state-write",
      actionId: "quotas.policies.delete",
    });

    const { policyId } = await context.params;

    return apiCenterAdminRequest(
      `/api/v1/quotas/policies/${encodeURIComponent(policyId)}`,
      { method: "DELETE" },
    );
  } catch (error) {
    return managementRouteErrorResponse(
      error,
      "Quota policy disable request failed.",
    );
  }
}
