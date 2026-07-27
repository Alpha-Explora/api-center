import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { requireManagementRouteAction } from "@/lib/server/require-management-action";
import {
  registryWriteRiskForEnvironment,
  resolveRegistrationRequestEnvironment,
} from "@/lib/server/registry-action-target";

type Context = {
  params: Promise<{ requestId: string }>;
};

export async function POST(request: Request, context: Context) {
  const { requestId } = await context.params;
  const targetEnvironment = await resolveRegistrationRequestEnvironment(requestId);
  await requireManagementRouteAction({
    request,
    environment: targetEnvironment,
    actionRisk: registryWriteRiskForEnvironment(targetEnvironment),
    actionId: "registry.registration-request.approve",
  });

  return apiCenterAdminRequest(
    `/api/v1/registry/registration-requests/${encodeURIComponent(requestId)}/approve`,
    {
      method: "POST",
      body: "{}",
    },
  );
}
