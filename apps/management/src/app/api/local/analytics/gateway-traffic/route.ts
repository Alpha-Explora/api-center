import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const window = url.searchParams.get("window") ?? "24h";

  return apiCenterAdminRequest(
    `/api/v1/analytics/gateway-traffic?window=${encodeURIComponent(window)}`,
  );
}

