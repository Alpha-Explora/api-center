import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { requireManagementRouteAction } from "@/lib/server/require-management-action";

type Context = {
  params: Promise<{ serviceId: string }>;
};

export async function POST(request: Request, context: Context) {
  const { serviceId } = await context.params;
  await requireManagementRouteAction({
    request,
    actionRisk: "destructive",
    actionId: "registry.service.retire",
  });

  return apiCenterAdminRequest(
    `/api/v1/registry/services/${encodeURIComponent(serviceId)}/retire`,
    { method: "POST" },
  );
}
