import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { managementOrganizationFilter, authorizeProject } from "@/lib/server/organization-access";
import { managementRouteErrorResponse } from "@/lib/server/management-route-error";
import { requireManagementSession } from "@/lib/server/require-management-session";
import { requireManagementRouteAction } from "@/lib/server/require-management-action";
import {
  registryWriteRiskForEnvironment,
  resolveRegistryWriteEnvironment,
  stripManagementConfirmationFields,
} from "@/lib/server/registry-action-target";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const params = new URLSearchParams();
    const status = searchParams.get("status");
    if (status) params.set("status", status);
    const organizationId = await managementOrganizationFilter(request);
    if (organizationId) params.set("organizationId", organizationId);
    return apiCenterAdminRequest(`/api/v1/registry/registration-requests${params.size ? `?${params}` : ""}`);
  } catch (error) {
    return managementRouteErrorResponse(error, "Registration request list failed.");
  }
}

export async function POST(request: Request) {
  try {
  const body = await request.clone().json().catch(() => ({}));
  const session = await requireManagementSession({ authorizationHeader: request.headers.get("authorization") });
  const projectId = body?.manifest?.projectId;
  if (!session.platformAdmin && (typeof projectId !== "string" || !projectId)) {
    throw new Error("Organization scope could not be resolved");
  }
  if (typeof projectId === "string" && projectId) await authorizeProject(request, projectId, "operator");
  const upstreamBody = JSON.stringify(stripManagementConfirmationFields(body));
  const targetEnvironment = resolveRegistryWriteEnvironment(body);
  await requireManagementRouteAction({
    request,
    environment: targetEnvironment,
    actionRisk: registryWriteRiskForEnvironment(targetEnvironment),
    actionId: "registry.registration-request.create",
  });

  return apiCenterAdminRequest("/api/v1/registry/registration-requests", {
    method: "POST",
    body: upstreamBody,
  });
  } catch (error) {
    return managementRouteErrorResponse(error, "Registration request failed.");
  }
}
