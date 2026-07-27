import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { requireManagementRouteAction } from "@/lib/server/require-management-action";
import {
  registryWriteRiskForEnvironment,
  resolveRegistryWriteEnvironment,
  stripManagementConfirmationFields,
} from "@/lib/server/registry-action-target";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const suffix = status ? `?status=${encodeURIComponent(status)}` : "";

  return apiCenterAdminRequest(
    `/api/v1/registry/registration-requests${suffix}`,
  );
}

export async function POST(request: Request) {
  const body = await request.clone().json().catch(() => ({}));
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
}
