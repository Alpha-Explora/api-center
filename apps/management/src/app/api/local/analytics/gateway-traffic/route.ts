import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { platformAdministratorResponse } from "@/lib/server/organization-access";

export async function GET(request: Request) {
  const denied = await platformAdministratorResponse(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const window = url.searchParams.get("window") ?? "24h";

  return apiCenterAdminRequest(
    `/api/v1/analytics/gateway-traffic?window=${encodeURIComponent(window)}`,
  );
}

