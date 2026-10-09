import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { platformAdministratorResponse } from "@/lib/server/organization-access";

export async function GET(request: Request) {
  const denied = await platformAdministratorResponse(request);
  if (denied) return denied;
  return apiCenterAdminRequest("/api/v1/admin/operations/lifecycle");
}
