import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { managementRouteErrorResponse } from "@/lib/server/management-route-error";
import { requireManagementRouteAction } from "@/lib/server/require-management-action";
import { authorizeProject } from "@/lib/server/organization-access";
import { requireManagementSession } from "@/lib/server/require-management-session";
import {
  registryWriteRiskForEnvironment,
  resolveRegistryWriteEnvironment,
  stripManagementConfirmationFields,
} from "@/lib/server/registry-action-target";

export async function POST(request: Request) {
  try {
    const body = await request.clone().json().catch(() => ({}));
    const session = await requireManagementSession({ authorizationHeader: request.headers.get("authorization") });
    if (!session.platformAdmin && (typeof body.projectId !== "string" || !body.projectId)) {
      throw new Error("Organization scope could not be resolved");
    }
    if (typeof body.projectId === "string" && body.projectId) await authorizeProject(request, body.projectId, "operator");
    const upstreamBody = JSON.stringify(stripManagementConfirmationFields(body));
    const targetEnvironment = resolveRegistryWriteEnvironment(body);
    await requireManagementRouteAction({
      request,
      environment: targetEnvironment,
      actionRisk: registryWriteRiskForEnvironment(targetEnvironment),
      actionId: "registry.register",
    });

    return apiCenterAdminRequest("/api/v1/registry/register", {
      method: "POST",
      body: upstreamBody,
    });
  } catch (error) {
    return managementRouteErrorResponse(error, "Registry registration failed.");
  }
}
