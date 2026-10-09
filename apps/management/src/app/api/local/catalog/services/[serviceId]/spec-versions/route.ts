import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { managementRouteErrorResponse } from "@/lib/server/management-route-error";
import { requirePlatformAdministrator } from "@/lib/server/organization-access";

type RouteContext = { params: Promise<{ serviceId: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    await requirePlatformAdministrator(request);
    const { serviceId } = await context!.params;
    return await apiCenterAdminRequest(
      `/api/v1/admin/catalog/services/${encodeURIComponent(serviceId)}/spec-versions`,
    );
  } catch (error) {
    return managementRouteErrorResponse(
      error,
      "Service specification versions request failed.",
    );
  }
}
