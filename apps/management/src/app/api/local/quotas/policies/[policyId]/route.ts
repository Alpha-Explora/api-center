import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { managementRouteErrorResponse } from "@/lib/server/management-route-error";
import { requireManagementRouteAction } from "@/lib/server/require-management-action";
import { authorizeQuotaPolicy } from "@/lib/server/organization-access";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ policyId: string }> },
) {
  try {
    const { policyId } = await context.params;
    await authorizeQuotaPolicy(request, policyId, "operator");
    await requireManagementRouteAction({
      request,
      actionRisk: "state-write",
      actionId: "quotas.policies.delete",
    });

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
