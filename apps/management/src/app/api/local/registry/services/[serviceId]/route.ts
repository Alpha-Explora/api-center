import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { createManagementProxyGET } from "@/lib/server/management-proxy-route";
import { managementRouteErrorResponse } from "@/lib/server/management-route-error";
import { requireManagementRouteAction } from "@/lib/server/require-management-action";
import { authorizeService } from "@/lib/server/organization-access";

type Context = {
  params: Promise<{ serviceId: string }>;
};

export const GET = createManagementProxyGET<Context>({
  upstreamPath: async (_request, context) => {
    const { serviceId } = await context!.params;
    return `/api/v1/registry/services/${encodeURIComponent(serviceId)}`;
  },
  beforeRequest: async (request, context) => {
    const { serviceId } = await context!.params;
    await authorizeService(request, serviceId);
  },
  fallbackError: "Registry service detail request failed.",
});

export async function DELETE(request: Request, context: Context) {
  try {
    const { serviceId } = await context.params;
    await authorizeService(request, serviceId, "operator");
    await requireManagementRouteAction({ request, actionRisk: "destructive", actionId: "registry.service.delete" });
    return apiCenterAdminRequest(`/api/v1/registry/services/${encodeURIComponent(serviceId)}`, { method: "DELETE" });
  } catch (error) {
    return managementRouteErrorResponse(error, "Registry service delete failed.");
  }
}
