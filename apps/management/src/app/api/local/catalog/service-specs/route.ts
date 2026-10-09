import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { managementRouteErrorResponse } from "@/lib/server/management-route-error";
import { requireManagementPlatformAdmin } from "@/lib/server/require-management-platform-admin";

export async function GET(request: Request) {
  try {
    await requireManagementPlatformAdmin(request);
    return await apiCenterAdminRequest("/api/v1/admin/catalog/service-specs");
  } catch (error) {
    return managementRouteErrorResponse(
      error,
      "Service specification catalog request failed.",
    );
  }
}
