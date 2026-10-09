import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { managementRouteErrorResponse } from "@/lib/server/management-route-error";
import { requireManagementRouteAction } from "@/lib/server/require-management-action";
import { authorizeRegistrationRequest } from "@/lib/server/organization-access";
import {
  registryWriteRiskForEnvironment,
  resolveRegistrationRequestEnvironment,
} from "@/lib/server/registry-action-target";

type Context = { params: Promise<{ requestId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const { requestId } = await context.params;
    await authorizeRegistrationRequest(request, requestId, "operator");
    const targetEnvironment = await resolveRegistrationRequestEnvironment(requestId);
    await requireManagementRouteAction({
      request,
      environment: targetEnvironment,
      actionRisk: registryWriteRiskForEnvironment(targetEnvironment),
      actionId: "registry.registration-request.approve",
    });
    return apiCenterAdminRequest(
      `/api/v1/registry/registration-requests/${encodeURIComponent(requestId)}/approve`,
      { method: "POST", body: "{}" },
    );
  } catch (error) {
    return managementRouteErrorResponse(error, "Registration request approval failed.");
  }
}
