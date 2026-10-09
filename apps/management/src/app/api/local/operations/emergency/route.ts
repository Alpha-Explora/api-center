import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { requireManagementRouteAction } from "@/lib/server/require-management-action";
import { platformAdministratorResponse } from "@/lib/server/organization-access";

export async function GET(request: Request) {
  const denied = await platformAdministratorResponse(request);
  if (denied) return denied;
  return apiCenterAdminRequest("/api/v1/admin/operations/emergency");
}

export async function POST(request: Request) {
  const denied = await platformAdministratorResponse(request);
  if (denied) return denied;
  await requireManagementRouteAction({
    request,
    actionRisk: "destructive",
    actionId: "operations.emergency.apply",
  });

  const body = await request.text();
  return apiCenterAdminRequest("/api/v1/admin/operations/emergency", {
    method: "POST",
    body,
  });
}

export async function DELETE(request: Request) {
  const denied = await platformAdministratorResponse(request);
  if (denied) return denied;
  await requireManagementRouteAction({
    request,
    actionRisk: "destructive",
    actionId: "operations.emergency.clear",
  });

  const url = new URL(request.url);
  const params = new URLSearchParams();
  const targetType = url.searchParams.get("targetType");
  const targetId = url.searchParams.get("targetId");
  if (targetType) params.set("targetType", targetType);
  if (targetId) params.set("targetId", targetId);

  return apiCenterAdminRequest(
    `/api/v1/admin/operations/emergency?${params.toString()}`,
    { method: "DELETE" },
  );
}
