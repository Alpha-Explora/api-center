import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { platformAdministratorResponse } from "@/lib/server/organization-access";

export async function GET(
  request: Request,
  context: { params: Promise<{ serviceId: string }> },
) {
  const denied = await platformAdministratorResponse(request);
  if (denied) return denied;
  const { serviceId } = await context.params;
  const url = new URL(request.url);
  const format = url.searchParams.get("format");
  const suffix = format ? `?format=${encodeURIComponent(format)}` : "";

  return apiCenterAdminRequest(
    `/api/v1/admin/operations/evidence/${encodeURIComponent(serviceId)}${suffix}`,
  );
}
