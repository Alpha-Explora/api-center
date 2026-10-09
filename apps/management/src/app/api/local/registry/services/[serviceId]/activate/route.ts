import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { requireManagementRouteAction } from "@/lib/server/require-management-action";
import { authorizeService } from "@/lib/server/organization-access";
import { managementRouteErrorResponse } from "@/lib/server/management-route-error";

type Context = {
  params: Promise<{ serviceId: string }>;
};

export async function PATCH(request: Request, context: Context) {
  try {
    const { serviceId } = await context.params;
    await authorizeService(request, serviceId, "operator");
    await requireManagementRouteAction({ request, actionRisk: "state-write", actionId: "registry.service.activate" });
    return apiCenterAdminRequest(`/api/v1/registry/services/${encodeURIComponent(serviceId)}/activate`, { method: "PATCH" });
  } catch (error) {
    return managementRouteErrorResponse(error, "Registry service activation failed.");
  }
}
