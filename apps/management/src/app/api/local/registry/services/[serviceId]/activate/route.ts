import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { requireManagementRouteAction } from "@/lib/server/require-management-action";

type Context = {
  params: Promise<{ serviceId: string }>;
};

export async function PATCH(request: Request, context: Context) {
  const { serviceId } = await context.params;
  await requireManagementRouteAction({
    request,
    actionRisk: "state-write",
    actionId: "registry.service.activate",
  });

  return apiCenterAdminRequest(
    `/api/v1/registry/services/${encodeURIComponent(serviceId)}/activate`,
    { method: "PATCH" },
  );
}
