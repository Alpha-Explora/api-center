import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { managementRouteErrorResponse } from "@/lib/server/management-route-error";
import { requireManagementRouteAction } from "@/lib/server/require-management-action";
import { authorizeRegistrationRequest } from "@/lib/server/organization-access";

type Context = { params: Promise<{ requestId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const { requestId } = await context.params;
    await authorizeRegistrationRequest(request, requestId, "operator");
    await requireManagementRouteAction({ request, actionRisk: "state-write", actionId: "registry.registration-request.reject" });
    return apiCenterAdminRequest(
      `/api/v1/registry/registration-requests/${encodeURIComponent(requestId)}/reject`,
      { method: "POST", body: await request.text() },
    );
  } catch (error) {
    return managementRouteErrorResponse(error, "Registration request rejection failed.");
  }
}
