import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { managementRouteErrorResponse } from "@/lib/server/management-route-error";
import { requireManagementSession } from "@/lib/server/require-management-session";

export async function GET(request: Request) {
  try {
    await requireManagementSession({
      authorizationHeader: request.headers.get("authorization"),
    });
    return await apiCenterAdminRequest("/api/v1/admin/catalog/service-specs");
  } catch (error) {
    return managementRouteErrorResponse(
      error,
      "Service specification catalog request failed.",
    );
  }
}
