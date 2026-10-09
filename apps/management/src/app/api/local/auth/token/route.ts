import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { serviceTokenRequestSchema } from "@/lib/schemas";
import { requireManagementRouteAction } from "@/lib/server/require-management-action";
import { authorizeService } from "@/lib/server/organization-access";
import { managementRouteErrorResponse } from "@/lib/server/management-route-error";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input = serviceTokenRequestSchema.parse(body);
    await authorizeService(request, input.serviceId, "operator");
    await requireManagementRouteAction({
      request,
      actionRisk: "low-write",
      actionId: "auth.token.issue",
    });

    return apiCenterAdminRequest("/api/v1/auth/token", {
      method: "POST",
      body: JSON.stringify(input),
    });
  } catch (error) {
    return managementRouteErrorResponse(error, "Service token issuance failed.");
  }
}
